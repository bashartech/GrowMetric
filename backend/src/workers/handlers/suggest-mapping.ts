import { Prisma } from "@prisma/client";
import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { getMappingProvider } from "../../lib/agent/mapping-provider.js";
import {
  buildSuggestMappingContext,
  parseMappingSuggestionOutput,
} from "../../lib/agent/mapping-suggest.js";
import { mapColumn } from "../../lib/mapping-rules.js";
import { recordUsage } from "../../modules/entitlements/entitlement.service.js";

export interface SuggestMappingPayload {
  importJobId: string;
  columnId: string;
}

interface ResolvedColumn {
  id: string;
  name: string;
  type: string;
  datasetId: string;
}

interface ResolvedTenant {
  organizationId: string;
  workspaceId: string;
}

/**
 * SUGGEST_MAPPING end-to-end: resolve the target column, run the mapping
 * provider once, validate candidates against the canonical vocabulary, and
 * persist PENDING AI suggestions (FR-012/SC-007). Provider faults or empty
 * outputs are recorded as a SKIPPED AI suggestion so the failure is visible —
 * the import itself already completed via the rules path and nothing is ever
 * auto-applied.
 */
export async function processSuggestMappingJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as SuggestMappingPayload;
  if (!payload.importJobId || !payload.columnId) {
    await failJob(job.id, "SUGGEST_MAPPING payload is missing importJobId/columnId.");
    return;
  }

  const column = await resolveColumn(payload.columnId);
  if (!column) {
    await failJob(job.id, `SUGGEST_MAPPING column ${payload.columnId} not found.`);
    return;
  }

  const dataset = await prisma.dataset.findUnique({
    where: { id: column.datasetId },
    select: { organizationId: true, workspaceId: true },
  });
  if (!dataset) {
    await failJob(job.id, `SUGGEST_MAPPING dataset ${column.datasetId} not found.`);
    return;
  }
  const tenant: ResolvedTenant = dataset;

  const provider = getMappingProvider();
  const prompt = buildSuggestMappingContext(column.name);
  const startedAt = Date.now();

  const agentRun = await prisma.agentRun.create({
    data: {
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      kind: "MAPPING",
      jobId: job.id,
      model: provider.model,
      promptVersion: prompt.promptVersion,
      status: "RUNNING",
      runKey: `mapping-suggestion:${column.id}:${job.id}`,
      startedAt: new Date(),
      toolsUsed: [],
    },
  });

  try {
    const completion = await provider.complete({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });

    const candidates = parseMappingSuggestionOutput(completion.content);

    if (candidates.length > 0) {
      await prisma.mappingSuggestion.createMany({
        data: candidates.map((candidate) => ({
          organizationId: tenant.organizationId,
          workspaceId: tenant.workspaceId,
          importJobId: payload.importJobId,
          datasetId: column.datasetId,
          columnId: column.id,
          semanticKey: candidate.semanticKey,
          businessMeaning: candidate.businessMeaning,
          source: "AI",
          status: "PENDING",
          confidence: new Prisma.Decimal(candidate.confidence),
          agentRunId: agentRun.id,
        })),
      });
    } else {
      await persistSkippedSuggestion(column, payload.importJobId, tenant, agentRun.id);
    }

    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        steps: 1,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        toolsUsed: ["suggest_mapping"],
      },
    });

    await recordUsage(tenant.organizationId, "ai_runs", 1).catch((error) =>
      logger.warn(
        { organizationId: tenant.organizationId, error },
        "Usage recording for ai_runs skipped.",
      ),
    );

    logger.info(
      { jobId: job.id, columnId: column.id, suggestions: candidates.length },
      "SUGGEST_MAPPING run resolved.",
    );
    await completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mapping suggestion failure.";
    await persistSkippedSuggestion(column, payload.importJobId, tenant, agentRun.id);
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "FAILED",
        error: message.slice(0, 500),
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
      },
    });
    logger.error({ jobId: job.id, columnId: column.id, error }, "SUGGEST_MAPPING job failed.");
    await completeJob(job.id);
  }
}

/**
 * Surfaces a SKIPPED AI suggestion whenever the provider produced nothing
 * usable: fail-visible, never auto-applied (FR-013/SC-007). Falls back to the
 * deterministic rules candidate so the row always carries a valid vocabulary
 * key; columns that have no rules candidate at all simply get no SKIPPED row.
 */
async function persistSkippedSuggestion(
  column: ResolvedColumn,
  importJobId: string,
  tenant: ResolvedTenant,
  agentRunId: string,
): Promise<void> {
  const fallback = mapColumn(column.name, column.type).best;
  if (!fallback) return;
  await prisma.mappingSuggestion.create({
    data: {
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      importJobId,
      datasetId: column.datasetId,
      columnId: column.id,
      semanticKey: fallback.semanticKey,
      businessMeaning: fallback.businessMeaning,
      source: "AI",
      status: "SKIPPED",
      confidence: new Prisma.Decimal(fallback.confidence),
      agentRunId,
    },
  });
}

async function resolveColumn(columnId: string): Promise<ResolvedColumn | null> {
  const row = await prisma.datasetColumn.findUnique({
    where: { id: columnId },
    select: { id: true, name: true, type: true, datasetId: true },
  });
  if (!row) return null;
  return { id: row.id, name: row.name, type: row.type, datasetId: row.datasetId };
}