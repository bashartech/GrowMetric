import { Prisma } from "@prisma/client";
import type { DatasetStatus } from "@prisma/client";
import { AppError, notFound } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { enqueueJob } from "../../jobs/queue.js";
import { record } from "../audit/audit.service.js";
import { recordUsage } from "../entitlements/entitlement.service.js";
import {
  periodsForPreset,
  resolveCanonicalMetric,
  type FindingDefinition,
  type InvestigationPeriod,
  type PeriodPreset,
} from "./pipeline.js";

const READY_STATUSES: DatasetStatus[] = ["READY", "READY_WITH_WARNINGS"];

export interface CreateInvestigationInput {
  title: string;
  question: string;
  topic: string;
  datasetId?: string;
  periodTarget?: InvestigationPeriod;
  periodBaseline?: InvestigationPeriod;
  periodPreset?: PeriodPreset;
  organizationId: string;
  workspaceId: string;
  createdById: string;
}

export interface FindingDTO extends FindingDefinition {
  id: string;
}

export interface InvestigationListItemDTO {
  id: string;
  title: string;
  question: string;
  topic: string;
  status: string;
  findingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvestigationDetailDTO {
  id: string;
  title: string;
  question: string;
  topic: string;
  status: string;
  datasetId: string | null;
  periodTarget: InvestigationPeriod | null;
  periodBaseline: InvestigationPeriod | null;
  error: string | null;
  agentRun: {
    id: string;
    kind: string;
    status: string;
    model: string;
    toolsUsed: string[];
  } | null;
  findings: FindingDTO[];
  createdAt: string;
  updatedAt: string;
}

async function audit(
  organizationId: string,
  workspaceId: string,
  action: string,
  resourceId: string,
  reason: string,
): Promise<void> {
  await record({
    organizationId,
    workspaceId,
    action,
    resourceType: "investigation",
    resourceId,
    metadata: { reason },
  }).catch(() => undefined);
}

export async function assertInvestigationDataset(
  input: {
    datasetId?: string;
    topic: string;
    organizationId: string;
    workspaceId: string;
  },
): Promise<{ datasetId: string; dateColumnId: string }> {
  let datasetId: string | null = input.datasetId ?? null;
  if (!datasetId) {
    const candidate = await prisma.dataset.findFirst({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        status: { in: READY_STATUSES },
        rowCount: { gt: 0 },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    datasetId = candidate?.id ?? null;
  }
  if (!datasetId) {
    throw new AppError(
      "CONFLICT",
      "No analytics-ready dataset is available to investigate.",
      { ready: false },
    );
  }

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId: input.organizationId, workspaceId: input.workspaceId },
    select: { id: true, name: true, currentVersionId: true, status: true },
  });
  if (!dataset || !dataset.currentVersionId) {
    await audit(
      input.organizationId,
      input.workspaceId,
      "AI_INVESTIGATION_CREATE",
      datasetId,
      "foreign-or-unknown",
    );
    throw notFound("Dataset not found");
  }
  if (!READY_STATUSES.includes(dataset.status)) {
    throw new AppError(
      "CONFLICT",
      `Dataset is not analytics-ready (status: ${dataset.status}).`,
      { ready: false },
    );
  }

  const columns = await prisma.datasetColumn.findMany({
    where: { datasetId, datasetVersionId: dataset.currentVersionId },
    select: { id: true, name: true, type: true, semanticKey: true },
  });

  if (!resolveCanonicalMetric(columns, input.topic)) {
    throw new AppError(
      "CONFLICT",
      `No business metric (revenue, orders, profit, expenses, customers, inventory) is mapped in dataset "${dataset.name}". Map one in Data Hub and try again.`,
      { ready: true },
    );
  }

  const dateColumn = columns.find(
    (column) => column.semanticKey?.toLowerCase() === "order_date",
  ) ?? columns.find((column) => column.type === "DATE" || column.type === "TIMESTAMP");
  if (!dateColumn) {
    throw new AppError(
      "CONFLICT",
      "This dataset has no date column, so periods cannot be compared.",
      { ready: true },
    );
  }

  const extrema = await prisma.datasetDatetimeValue.aggregate({
    where: { columnId: dateColumn.id },
    _min: { value: true },
    _max: { value: true },
  });
  const min = extrema._min.value;
  const max = extrema._max.value;
  if (!min || !max || min.getTime() === max.getTime()) {
    throw new AppError(
      "CONFLICT",
      "This dataset has insufficient date history to compare a target period against a baseline. Import data spanning at least two dates.",
      { ready: true },
    );
  }

  return { datasetId, dateColumnId: dateColumn.id };
}

/**
 * Charges the two budgets one investigation consumes: the `aiInvestigations`
 * allowance the route gate checks, and the shared `ai_runs` pool. Billing only
 * `ai_runs` left `aiInvestigations: 5` on the free plan permanently at zero, so
 * that limit could never be reached.
 *
 * The job is already queued by the time this runs, so a metering failure must
 * not reject the request and strand the investigation in `RUNNING`. It is
 * logged instead - silently swallowing it made unbounded usage invisible.
 */
async function billInvestigationRun(organizationId: string, jobId: string): Promise<void> {
  for (const feature of ["ai_investigations", "ai_runs"] as const) {
    try {
      await recordUsage(organizationId, feature, 1);
    } catch (error) {
      logger.error(
        { organizationId, jobId, feature, error },
        "Investigation metering exceeded the plan quota after enqueue.",
      );
    }
  }
}

export async function createInvestigation(input: CreateInvestigationInput) {
  const { datasetId, dateColumnId } = await assertInvestigationDataset(input);

  let periodTarget = input.periodTarget;
  let periodBaseline = input.periodBaseline;
  if ((!periodTarget || !periodBaseline) && input.periodPreset) {
    const derived = await periodsForPreset(dateColumnId, input.periodPreset);
    periodTarget = periodTarget ?? derived.target;
    periodBaseline = periodBaseline ?? derived.baseline;
  }

  const investigation = await prisma.investigation.create({
    data: {
      title: input.title,
      question: input.question,
      topic: input.topic,
      datasetId,
      periodTarget: (periodTarget ?? undefined) as Prisma.InputJsonValue | undefined,
      periodBaseline: (periodBaseline ?? undefined) as Prisma.InputJsonValue | undefined,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdById: input.createdById,
    },
    select: {
      id: true,
      status: true,
      periodTarget: true,
      periodBaseline: true,
    },
  });

  const job = await enqueueJob({
      type: "RUN_INVESTIGATION",
      organizationId: input.organizationId,
      payload: { investigationId: investigation.id },
    });

    await billInvestigationRun(input.organizationId, job.id);

  return {
    id: investigation.id,
    status: "RUNNING",
    jobId: job.id,
    periodTarget: (investigation.periodTarget as InvestigationPeriod | null) ?? null,
    periodBaseline: (investigation.periodBaseline as InvestigationPeriod | null) ?? null,
  };
}

export async function listInvestigations(organizationId: string, workspaceId: string) {
  const [rows, total] = await prisma.$transaction([
    prisma.investigation.findMany({
      where: { organizationId, workspaceId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { findings: true } } },
      take: 100,
    }),
    prisma.investigation.count({ where: { organizationId, workspaceId } }),
  ]);

  const items: InvestigationListItemDTO[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    question: row.question,
    topic: row.topic,
    status: row.status,
    findingCount: row._count.findings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return { items, meta: { page: 1, perPage: 20, total } };
}

export async function getInvestigation(
  investigationId: string,
  organizationId: string,
  workspaceId: string,
): Promise<InvestigationDetailDTO> {
  const investigation = await prisma.investigation.findFirst({
    where: { id: investigationId, organizationId, workspaceId },
    include: {
      findings: { orderBy: [{ level: "asc" }, { createdAt: "asc" }] },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, kind: true, status: true, model: true, toolsUsed: true },
      },
    },
  });
  if (!investigation) {
    await audit(organizationId, workspaceId, "AI_INVESTIGATION_READ", investigationId, "foreign-or-unknown");
    throw notFound("Investigation not found");
  }

  const run = investigation.runs[0];
  return {
    id: investigation.id,
    title: investigation.title,
    question: investigation.question,
    topic: investigation.topic,
    status: investigation.status,
    datasetId: investigation.datasetId,
    periodTarget: (investigation.periodTarget as InvestigationPeriod | null) ?? null,
    periodBaseline: (investigation.periodBaseline as InvestigationPeriod | null) ?? null,
    error: investigation.error,
agentRun: run
        ? {
            id: run.id,
            kind: run.kind,
            status: run.status,
            model: run.model,
            toolsUsed: (run.toolsUsed as unknown as string[]) ?? [],
          }
        : null,
    findings: investigation.findings.map((finding) => ({
      id: finding.id,
      level: finding.level,
      kind: finding.kind as FindingDefinition["kind"],
      title: finding.title,
      summary: finding.summary,
      metricChange: (finding.metricChange as FindingDefinition["metricChange"]) ?? null,
      evidence: (finding.evidence as Record<string, unknown>) ?? {},
      confidence: Number(finding.confidence ?? 0),
      isCausalClaim: finding.isCausalClaim,
    })),
    createdAt: investigation.createdAt.toISOString(),
    updatedAt: investigation.updatedAt.toISOString(),
  };
}