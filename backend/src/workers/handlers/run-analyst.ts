import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { GroqEngine, type AgentEngineToolSchema } from "../../lib/agent/provider.js";
import { PrismaRunStore } from "../../lib/agent/run-store.js";
import { runAgent, type EngineOutcome } from "../../lib/agent/engine.js";
import { AGENT_TOOL_CATALOG } from "../../lib/agent/tools.js";
import { ANALYST_SYSTEM, ANALYST_SYSTEM_VERSION } from "../../lib/agent/prompts.js";
import type { BudgetLimits } from "../../lib/agent/budgets.js";
import { extractFigures } from "../../lib/agent/evidence.js";

export interface RunAnalystPayload {
  conversationId: string;
  /**
   * The exact user message this job must answer. Optional only for jobs
   * enqueued before the binding existed; those fall back to the latest user
   * message.
   */
  userMessageId?: string;
}

const ANALYST_BUDGETS: BudgetLimits = {
  maxSteps: env.AI_MAX_STEPS,
  maxToolCalls: env.AI_MAX_TOOL_CALLS,
  maxInputTokens: env.AI_MAX_INPUT_TOKENS ?? env.AI_MAX_TOKENS,
  maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS ?? env.AI_MAX_TOKENS,
  timeoutMs: env.AI_TIMEOUT_MS,
};

const HISTORY_CONTEXT_MESSAGES = 8;

/**
 * Index of the user message this job answers: the message bound in the payload
 * when present, otherwise the latest user message (legacy jobs enqueued before
 * the binding). Returns -1 when there is nothing to answer.
 */
const resolveTargetUserIndex = (
  messages: Array<{ id: string; role: string; content: string | null }>,
  userMessageId?: string,
): number => {
  if (userMessageId) {
    return messages.findIndex(
      (message) => message.id === userMessageId && message.role === "USER",
    );
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "USER") return index;
  }
  return -1;
};

/**
 * RUN_ANALYST end-to-end: claim → load conversation context → analyst engine
 * loop (only sanctioned tools, budgets, evidence guard) → persist an assistant
 * message with evidenceClass + tool traces → complete. Provider-level failures
 * surface as an honest assistant ERROR message (AI_PROVIDER_UNAVAILABLE) with
 * the conversation preserved (FR-004).
 */
export async function processRunAnalystJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as RunAnalystPayload;
  if (!payload.conversationId) {
    await failJob(job.id, "RUN_ANALYST payload is missing conversationId.");
    return;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: payload.conversationId },
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      createdById: true,
    },
  });
  if (!conversation) {
    await failJob(job.id, `RUN_ANALYST conversation ${payload.conversationId} not found.`);
    return;
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      role: { in: ["USER", "ASSISTANT"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, kind: true, content: true },
  });

  const targetIndex = resolveTargetUserIndex(messages, payload.userMessageId);
  if (targetIndex < 0) {
    await failJob(
      job.id,
      payload.userMessageId
        ? `RUN_ANALYST bound message ${payload.userMessageId} not found.`
        : "RUN_ANALYST has no user message to answer.",
    );
    return;
  }
  const targetUser = messages[targetIndex]!;
  if (!targetUser.content) {
    await failJob(job.id, "RUN_ANALYST user message has no content to answer.");
    return;
  }

  const contextLines = messages
    .slice(0, targetIndex)
    .filter(
      (message) =>
        message.role === "USER" ||
        (message.role === "ASSISTANT" && message.kind !== "ERROR"),
    )
    .slice(-HISTORY_CONTEXT_MESSAGES)
    .map((message) => `${message.role}: ${message.content ?? ""}`);
  const userPrompt =
    contextLines.length > 0
      ? `${contextLines.join("\n")}\n\nUser: ${targetUser.content}`
      : targetUser.content;

  const store = new PrismaRunStore();
  const provider = createAnalystProvider();
  const outcome = await runAgent(
    {
      runKey: `analyst:${conversation.id}:${job.id}`,
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId,
      jobId: job.id,
      conversationId: conversation.id,
      userId: conversation.createdById,
      runType: "ANALYST",
      model: provider.model,
      promptVersion: ANALYST_SYSTEM_VERSION,
      systemPrompt: ANALYST_SYSTEM,
      userPrompt,
    },
    {
      provider,
      tools: AGENT_TOOL_CATALOG,
      store,
      bounds: ANALYST_BUDGETS,
    },
  );

  await persistOutcome(job, conversation.id, outcome);
  logger.info(
    {
      jobId: job.id,
      conversationId: conversation.id,
      status: outcome.status,
      steps: outcome.steps,
      toolCalls: outcome.toolCalls,
    },
    "RUN_ANALYST run resolved.",
  );
  await completeJob(job.id);
}

function createAnalystProvider(): GroqEngine {
  return new GroqEngine({
    apiKey: env.OPENROUTER_API_KEY ?? "",
    // apiKey: env.OPENROUTER_API_KEY ?? "",
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS ?? env.AI_MAX_TOKENS,
    timeoutMs: env.AI_TIMEOUT_MS,
    tools: AGENT_TOOL_CATALOG.map(
      (tool): AgentEngineToolSchema => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }),
    ),
    systemPrompt: ANALYST_SYSTEM,
  });
}

async function persistOutcome(
  job: Job,
  conversationId: string,
  outcome: EngineOutcome,
): Promise<void> {
  if (outcome.status === "COMPLETED" && outcome.finalContent) {
    await persistAnswer(job, conversationId, outcome);
    return;
  }
  await persistNonAnswer(job, conversationId, outcome);
}

async function persistAnswer(
  job: Job,
  conversationId: string,
  outcome: EngineOutcome,
): Promise<void> {
  const finalContent = outcome.finalContent ?? "";
  const toolCalls = await prisma.toolCallRecord.findMany({
    where: { agentRunId: outcome.runId },
    orderBy: { sequence: "asc" },
    select: { id: true, name: true },
  });

  if (outcome.includesForeignFigures) {
    const toolOutputs = await prisma.toolCallRecord.findMany({
      where: { agentRunId: outcome.runId },
      orderBy: { sequence: "asc" },
      select: { outputJson: true },
    });
    const unsupportedFigures = extractFigures(finalContent)
      .map((figure) => figure.value)
      .filter((value) =>
        toolOutputs.every((row) => {
          const raw =
            typeof row.outputJson === "string"
              ? row.outputJson
              : JSON.stringify(row.outputJson ?? "");
          return !raw.includes(String(value));
        }),
      );
    await prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        kind: "ERROR",
        content:
          "I could not verify the numbers the analyst produced against the data, so I am not showing them. Ask me again with a clearer question.",
        agentRunId: outcome.runId,
        payload: {
          status: "UNVERIFIED",
          error: "Answer contained figures outside recorded tool outputs.",
          unsupportedFigures,
          jobId: job.id,
        },
      },
    });
    return;
  }

  const figures = extractFigures(finalContent);
  const evidenceClass =
    figures.length > 0
      ? ((outcome.includesForeignFigures ? "INFERRED" : "CALCULATED") as "CALCULATED" | "INFERRED")
      : null;

  const kind = toolCalls.some((tool) => tool.name === "generate_chart_spec") ? "CHART" : "CHAT";
  const evidenceRefs = [
    `evidence:conversations/${conversationId}`,
    ...toolCalls.map((tool) => `toolCalls/${tool.id}`),
  ];

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        kind,
        content: finalContent,
        evidenceClass,
        agentRunId: outcome.runId,
        // jobId lets the client match the answer to the exact question it sent
        // instead of trusting message arrival order.
        payload: { evidenceRefs, jobId: job.id },
      },
    }),
    ...toolCalls.map((tool) =>
      prisma.message.create({
        data: {
          conversationId,
          role: "TOOL",
          kind: "CHAT",
          agentRunId: outcome.runId,
          toolCallId: tool.id,
          payload: { evidenceRefs: [`toolCalls/${tool.id}`] },
        },
      }),
    ),
  ]);
}

/**
 * Provider failures surface verbatim (including raw HTTP status text).
 * A 429 is the common case with a metered model, so it gets copy the user can
 * act on instead of an upstream error string.
 */
const friendlyFailureMessage = (error: string | undefined): string => {
  const message = (error ?? "").trim();
  if (/\b429\b|rate[- ]?limit/i.test(message)) {
    return "The model provider is rate-limiting requests right now, so the analyst could not answer. Wait a moment and ask again.";
  }
  return message || "The analyst could not answer.";
};

async function persistNonAnswer(
  job: Job,
  conversationId: string,
  outcome: EngineOutcome,
): Promise<void> {
  const content =
    outcome.status === "STOPPED"
      ? `The analyst run stopped before answering. ${outcome.error ?? ""}`.trim()
      : outcome.status === "FAILED"
        ? friendlyFailureMessage(outcome.error)
        : "The analyst run ended without a completed answer.";

  await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      kind: "ERROR",
      content,
      agentRunId: outcome.runId,
      payload: {
        status: outcome.status,
        error: outcome.error ?? null,
        steps: outcome.steps,
        toolCalls: outcome.toolCalls,
        jobId: job.id,
      },
    },
  });
}