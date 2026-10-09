import { Prisma } from "@prisma/client";
import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { recordUsage } from "../../modules/entitlements/entitlement.service.js";
import {
  DatabasePipelineDataSource,
  INVESTIGATION_PIPELINE_VERSION,
  runInvestigation,
  type InvestigationPeriod,
} from "../../modules/investigations/pipeline.js";

export interface RunInvestigationPayload {
  investigationId: string;
}

/**
 * RUN_INVESTIGATION end-to-end: claim → run the deterministic pipeline
 * (scope → compare → break down → rank → anomalies → assemble) → persist
 * findings + AgentRun → complete. Every figure comes from aggregation over the
 * mapped value column; correlations are labeled non-causal (FR-008/FR-009).
 */
export async function processRunInvestigationJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as RunInvestigationPayload;
  if (!payload.investigationId) {
    await failJob(job.id, "RUN_INVESTIGATION payload is missing investigationId.");
    return;
  }

  const investigation = await prisma.investigation.findUnique({
    where: { id: payload.investigationId },
  });
  if (!investigation) {
    await failJob(job.id, `RUN_INVESTIGATION investigation ${payload.investigationId} not found.`);
    return;
  }

  if (investigation.status !== "RUNNING") {
    await completeJob(job.id);
    return;
  }

  const agentRun = await prisma.agentRun.create({
    data: {
      organizationId: investigation.organizationId,
      workspaceId: investigation.workspaceId,
      kind: "INVESTIGATION",
      jobId: job.id,
      model: INVESTIGATION_PIPELINE_VERSION,
      promptVersion: INVESTIGATION_PIPELINE_VERSION,
      status: "RUNNING",
      runKey: `investigation:${investigation.id}:${job.id}`,
      investigationId: investigation.id,
      startedAt: new Date(),
      toolsUsed: [],
    },
  });

  try {
    const dataSource = new DatabasePipelineDataSource();
    const findings = await runInvestigation(
      {
        datasetId: investigation.datasetId,
        topic: investigation.topic,
        periodTarget: (investigation.periodTarget as InvestigationPeriod | null) ?? null,
        periodBaseline: (investigation.periodBaseline as InvestigationPeriod | null) ?? null,
        organizationId: investigation.organizationId,
        workspaceId: investigation.workspaceId,
      },
      dataSource,
    );

    await prisma.$transaction([
      ...findings.map((finding) =>
        prisma.investigationFinding.create({
          data: {
            investigationId: investigation.id,
            level: finding.level,
            kind: finding.kind,
            title: finding.title,
            summary: finding.summary,
            metricChange: finding.metricChange as unknown as Prisma.InputJsonValue | undefined,
            evidence: finding.evidence as unknown as Prisma.InputJsonValue,
            confidence: finding.confidence,
            isCausalClaim: finding.isCausalClaim,
          },
        }),
      ),
      prisma.investigation.update({
        where: { id: investigation.id },
        data: { status: "COMPLETED" },
      }),
      prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          latencyMs: 0,
          steps: 1,
          toolsUsed: ["run_investigation"],
        },
      }),
    ]);
    await recordUsage(investigation.organizationId, "ai_runs", 1).catch(
      (error) =>
        logger.warn(
          { organizationId: investigation.organizationId, error },
          "Usage recording for ai_runs skipped.",
        ),
    );

    logger.info(
      { jobId: job.id, investigationId: investigation.id, findings: findings.length },
      "RUN_INVESTIGATION run resolved.",
    );
    await completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown investigation failure.";
    await prisma.investigation.update({
      where: { id: investigation.id },
      data: { status: "FAILED", error: message },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    logger.error(
      {
        investigationId: investigation.id,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Investigation job failed.",
    );
    await failJob(job.id, message);
  }
}