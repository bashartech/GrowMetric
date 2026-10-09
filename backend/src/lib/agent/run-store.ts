import { Prisma } from "@prisma/client";
import type {
  EngineRunParams,
  EngineRunStatus,
  RecordedToolCall,
  RunFinalization,
  RunInfo,
  RunStore,
} from "./engine.js";
import { prisma } from "../prisma.js";

const KIND_FOR_RUN_TYPE: Record<string, "ANALYST" | "INVESTIGATION" | "SIMULATION" | "MAPPING"> = {
  ANALYST: "ANALYST",
  INVESTIGATION: "INVESTIGATION",
  SIMULATION: "SIMULATION",
  MAPPING: "MAPPING",
};

/**
 * Production RunStore persisted via Prisma. AgentRun rows are the system of
 * record for every analyst/investigation run; ToolCallRecord rows capture each
 * executed tool call with its sanitized output (FR-020, SC-001).
 */
export class PrismaRunStore implements RunStore {
  async getRunByKey(runKey: string): Promise<RunInfo | null> {
    const run = await prisma.agentRun.findUnique({
      where: { runKey },
      select: { id: true, runKey: true, status: true, startedAt: true },
    });
    if (!run) return null;
    return {
      runId: run.id,
      runKey: run.runKey,
      status: run.status as EngineRunStatus,
      startedAt: run.startedAt,
    };
  }

  async createRun(input: EngineRunParams): Promise<RunInfo> {
    const kind = KIND_FOR_RUN_TYPE[input.runType] ?? "ANALYST";
    const run = await prisma.agentRun.upsert({
      where: { runKey: input.runKey },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        kind,
        jobId: input.jobId,
        conversationId: input.conversationId,
        model: input.model,
        promptVersion: input.promptVersion,
        status: "RUNNING",
        runKey: input.runKey,
        toolsUsed: [],
        startedAt: new Date(),
      },
      // A stale RUNNING row reaches this only after the engine decided to take
      // it over; reset it so the new attempt owns a fresh start time.
      update: { status: "RUNNING", startedAt: new Date(), error: null },
      select: { id: true, runKey: true, status: true },
    });
    return {
      runId: run.id,
      runKey: run.runKey,
      status: run.status as EngineRunStatus,
    };
  }

  async recordToolCall(runId: string, call: RecordedToolCall): Promise<void> {
    await prisma.toolCallRecord.create({
      data: {
        agentRunId: runId,
        name: call.toolName,
        argumentsJson: call.argumentsJson as Prisma.InputJsonValue,
        outputJson: (call.outputJson as Prisma.InputJsonValue) ?? undefined,
        status: call.status,
        error: call.error,
        latencyMs: call.latencyMs,
        sequence: call.seq,
      },
    });
  }

  async finalize(runId: string, finalization: RunFinalization): Promise<void> {
    const records = await prisma.toolCallRecord.findMany({
      where: { agentRunId: runId },
      select: { name: true },
      orderBy: { sequence: "asc" },
    });
    const toolsUsed = Array.from(new Set(records.map((record) => record.name))) as Prisma.InputJsonValue;
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: finalization.status,
        completedAt: new Date(),
        latencyMs: finalization.latencyMs,
        steps: finalization.steps,
        inputTokens: finalization.inputTokens,
        outputTokens: finalization.outputTokens,
        toolsUsed,
        ...(finalization.error ? { error: finalization.error } : {}),
      },
    });
  }
}