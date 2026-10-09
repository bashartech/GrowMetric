import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";
import { logger } from "../../lib/logger.js";
import { record } from "../audit/audit.service.js";
import { mapDatasetStatus } from "../datasets/dataset.repo.js";
import { ensureDefaultDashboard } from "../dashboards/dashboard.service.js";
import type {
  BatchSuggestionsInput,
  ListMappingSuggestionsInput,
} from "./mapping.schema.js";

const DEFAULT_STATUS = "PENDING" as const;

export interface MappingSuggestionListItem {
  id: string;
  importJobId: string;
  datasetId: string | null;
  column: {
    id: string;
    name: string;
    type: string;
    representativeSample: unknown;
  };
  semanticKey: string;
  businessMeaning: string;
  source: "RULES" | "AI";
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "SKIPPED";
  confidence: number;
  agentRunId: string | null;
  createdAt: string;
}

export interface MappingSuggestionListResult {
  items: MappingSuggestionListItem[];
  meta: { page: number; perPage: number; total: number };
}

export interface MappingResolveResult {
  id: string;
  status: "CONFIRMED" | "REJECTED";
  columnId?: string;
  semanticKey?: string;
  analyticsReady: boolean;
}

export interface MappingBatchResult {
  suggestionId: string;
  action: "CONFIRM" | "REJECT";
  success: boolean;
  status: "CONFIRMED" | "REJECTED" | "FAILED";
  error?: { code: string; message: string };
}

export async function listMappingSuggestions(
  organizationId: string,
  workspaceId: string,
  filters: Omit<ListMappingSuggestionsInput, "page" | "perPage"> & {
    page: number;
    perPage: number;
  },
): Promise<MappingSuggestionListResult> {
  const where = {
    organizationId,
    workspaceId,
    ...(filters.status ? { status: filters.status } : { status: DEFAULT_STATUS }),
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.importJobId ? { importJobId: filters.importJobId } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.mappingSuggestion.count({ where }),
    prisma.mappingSuggestion.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (filters.page - 1) * filters.perPage,
      take: filters.perPage,
      include: {
        column: { select: { id: true, name: true, type: true, representativeSample: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      importJobId: row.importJobId,
      datasetId: row.datasetId,
      column: {
        id: row.column.id,
        name: row.column.name,
        type: row.column.type,
        representativeSample: row.column.representativeSample,
      },
      semanticKey: row.semanticKey,
      businessMeaning: row.businessMeaning,
      source: row.source,
      status: row.status,
      confidence: Number(row.confidence),
      agentRunId: row.agentRunId,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: { page: filters.page, perPage: filters.perPage, total },
  };
}

export async function confirmSuggestion(
  organizationId: string,
  workspaceId: string,
  suggestionId: string,
): Promise<MappingResolveResult> {
  return resolveSuggestion({
    organizationId,
    workspaceId,
    suggestionId,
    action: "CONFIRM",
  });
}

export async function rejectSuggestion(
  organizationId: string,
  workspaceId: string,
  suggestionId: string,
): Promise<MappingResolveResult> {
  return resolveSuggestion({
    organizationId,
    workspaceId,
    suggestionId,
    action: "REJECT",
  });
}

export async function batchResolve(
  organizationId: string,
  workspaceId: string,
  input: BatchSuggestionsInput,
): Promise<MappingBatchResult[]> {
  const importJob = await prisma.importJob.findFirst({
    where: { id: input.importJobId, organizationId, workspaceId },
    select: { id: true },
  });
  if (!importJob) {
    throw new AppError("NOT_FOUND", "Import job not found");
  }

  const results: MappingBatchResult[] = [];
  for (const decision of input.decisions) {
    try {
      const resolved = await resolveSuggestion({
        organizationId,
        workspaceId,
        suggestionId: decision.suggestionId,
        action: decision.action,
        importJobId: input.importJobId,
      });
      results.push({
        suggestionId: decision.suggestionId,
        action: decision.action,
        success: true,
        status: resolved.status,
      });
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError("INTERNAL_ERROR", errorMessage(error));
      results.push({
        suggestionId: decision.suggestionId,
        action: decision.action,
        success: false,
        status: "FAILED",
        error: { code: appError.code, message: appError.message },
      });
    }
  }
  return results;
}

interface ResolveOptions {
  organizationId: string;
  workspaceId: string;
  suggestionId: string;
  action: "CONFIRM" | "REJECT";
  importJobId?: string;
}

async function resolveSuggestion(options: ResolveOptions): Promise<MappingResolveResult> {
  const { organizationId, workspaceId, suggestionId, action } = options;
  const scope = {
    id: suggestionId,
    organizationId,
    workspaceId,
    ...(options.importJobId ? { importJobId: options.importJobId } : {}),
  };

  const existing = await prisma.mappingSuggestion.findFirst({
    where: scope,
    select: { status: true, datasetId: true },
  });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Mapping suggestion not found");
  }
  if (existing.status !== "PENDING") {
    throw new AppError("NOT_FOUND", "Mapping suggestion already resolved");
  }

  const datasetId = existing.datasetId;
  let columnId: string | undefined;
  let semanticKey: string | undefined;

  await prisma.$transaction(async (tx) => {
    const claim = await tx.mappingSuggestion.updateMany({
      where: { id: suggestionId, status: "PENDING" },
      data: { status: action === "CONFIRM" ? "CONFIRMED" : "REJECTED", updatedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new AppError("CONFLICT", "Mapping suggestion raced with another update");
    }

    if (action === "CONFIRM") {
      const suggestion = await tx.mappingSuggestion.findUnique({
        where: { id: suggestionId },
        select: {
          semanticKey: true,
          businessMeaning: true,
          columnId: true,
        },
      });
      if (!suggestion) {
        throw new AppError("NOT_FOUND", "Mapping suggestion not found");
      }
      const column = await tx.datasetColumn.findUnique({
        where: { id: suggestion.columnId },
        select: { id: true },
      });
      if (!column) {
        throw new AppError("NOT_FOUND", "Dataset column not found");
      }
      await tx.datasetColumn.update({
        where: { id: column.id },
        data: {
          semanticKey: suggestion.semanticKey,
          businessMeaning: suggestion.businessMeaning,
        },
      });
      columnId = column.id;
      semanticKey = suggestion.semanticKey;
    }
  });

  await record({
    organizationId,
    workspaceId,
    action:
      action === "CONFIRM" ? "data-source.mapping.confirm" : "data-source.mapping.reject",
    resourceType: "MappingSuggestion",
    resourceId: suggestionId,
    metadata: datasetId ? { datasetId } : undefined,
  });

  if (datasetId) {
    await maybeCompleteDataset(organizationId, workspaceId, datasetId);
  }

  return {
    id: suggestionId,
    status: action === "CONFIRM" ? "CONFIRMED" : "REJECTED",
    ...(action === "CONFIRM"
      ? { columnId, semanticKey, analyticsReady: true }
      : { analyticsReady: false }),
  };
}

/**
 * Folds a confirmed suggestion into dataset readiness (FR-013): once no PENDING
 * suggestion remains for a DRAFT dataset, the paused import completes and the
 * dataset becomes analytics-ready so dashboards can be created.
 */
async function maybeCompleteDataset(
  organizationId: string,
  workspaceId: string,
  datasetId: string,
): Promise<void> {
  const pending = await prisma.mappingSuggestion.count({
    where: { organizationId, workspaceId, datasetId, status: "PENDING" },
  });
  if (pending > 0) return;

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId, workspaceId },
    select: { id: true, status: true, currentVersionId: true },
  });
  if (!dataset || dataset.status !== "DRAFT" || !dataset.currentVersionId) return;

  const pendingImport = await prisma.importJob.findFirst({
    where: { datasetId, status: "REQUESTING_MAPPING" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!pendingImport) return;

  const report = await prisma.dataQualityReport.findFirst({
    where: { datasetId, datasetVersionId: dataset.currentVersionId },
    select: { status: true },
  });
  const nextStatus = mapDatasetStatus(report?.status ?? "CLEAN");

  await prisma.$transaction([
    prisma.importJob.update({
      where: { id: pendingImport.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.datasetVersion.update({
      where: { id: dataset.currentVersionId },
      data: { summary: {} as Prisma.InputJsonValue },
    }),
    prisma.dataset.update({ where: { id: datasetId }, data: { status: nextStatus } }),
  ]);

  if (nextStatus === "READY" || nextStatus === "READY_WITH_WARNINGS") {
    await ensureDefaultDashboard(organizationId, workspaceId, datasetId).catch((error) =>
      logger.warn(
        { datasetId, error },
        "Default dashboard creation after mapping confirm skipped.",
      ),
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}