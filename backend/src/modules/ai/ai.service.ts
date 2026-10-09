import { Prisma } from "@prisma/client";
import { AppError, notFound } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { enqueueJob, cancelJob } from "../../jobs/queue.js";
import { record } from "../audit/audit.service.js";
import { recordUsage } from "../entitlements/entitlement.service.js";

const READY_DATASET_STATUSES: Prisma.EnumDatasetStatusFilter["in"] = ["READY", "READY_WITH_WARNINGS"];

export interface ConversationDTO {
  id: string;
  workspaceId: string;
  title: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListItemDTO {
  id: string;
  title: string;
  status: string;
  messageCount: number;
  updatedAt: string;
}

export interface MessageAgentRunDTO {
  id: string;
  model: string;
  status: string;
  latencyMs: number | null;
  steps: number;
  toolsUsed: string[];
}

export interface MessageDTO {
  id: string;
  role: string;
  kind: string;
  content: string | null;
  evidenceClass: string | null;
  agentRun: MessageAgentRunDTO | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationDetailDTO {
  id: string;
  title: string;
  kind: string;
  status: string;
  messages: MessageDTO[];
  nextRun: { runId: string; status: string; startedAt: string | null } | null;
  activeJob: { id: string; status: string; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

function toConversationDTO(row: { id: string; workspaceId: string; title: string; kind: string; status: string; createdAt: Date; updatedAt: Date }): ConversationDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireOwnedConversation(
  conversationId: string,
  organizationId: string,
  workspaceId: string,
  action: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      kind: true,
      status: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!conversation) {
    await record({
      organizationId,
      workspaceId,
      action,
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: { reason: "foreign-or-unknown" },
    }).catch(() => undefined);
    throw notFound("Conversation not found");
  }
  return conversation;
}

export async function listReadyDatasets(organizationId: string, workspaceId: string) {
  return prisma.dataset.findMany({
    where: {
      organizationId,
      workspaceId,
      status: { in: READY_DATASET_STATUSES },
      rowCount: { gt: 0 },
    },
    select: { id: true, name: true, rowCount: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
}

export async function createConversation(input: {
  title?: string;
  organizationId: string;
  workspaceId: string;
  createdById: string;
}): Promise<ConversationDTO> {
  // The plan's `aiConversations` allowance is billed per conversation, not per
  // message. Recording it at message time (where `ai_runs` is already billed)
  // would let a single 10-message thread exhaust a 5-conversation allowance.
  await recordUsage(input.organizationId, "ai_conversations", 1);

  const row = await prisma.conversation.create({
    data: {
      title: input.title ?? "New conversation",
      kind: "ANALYST",
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdById: input.createdById,
    },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      kind: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return toConversationDTO(row);
}

export async function listConversations(organizationId: string, workspaceId: string) {
  const [rows, total] = await prisma.$transaction([
    prisma.conversation.findMany({
      where: { organizationId, workspaceId, kind: "ANALYST" },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    }),
    prisma.conversation.count({ where: { organizationId, workspaceId, kind: "ANALYST" } }),
  ]);

  const items: ConversationListItemDTO[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    messageCount: row._count.messages,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return {
    items,
    meta: { page: 1, perPage: 20, total },
  };
}

export async function getConversation(conversationId: string, organizationId: string, workspaceId: string): Promise<ConversationDetailDTO> {
  const conversation = await requireOwnedConversation(
    conversationId,
    organizationId,
    workspaceId,
    "AI_CONVERSATION_READ",
  );

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: {
      agentRun: {
        select: { id: true, model: true, status: true, latencyMs: true, steps: true, toolsUsed: true },
      },
    },
  });

  // A run abandoned by a dead worker stays RUNNING forever; past the run
  // budget (+ grace) it can no longer produce an answer, so it must not pin
  // the conversation in a "working" state. `reclaimStaleJobs` re-queues the
  // job itself, which takes over the run (see the engine's runKey handling).
  const runCutoff = new Date(Date.now() - (env.AI_TIMEOUT_MS + 5 * 60_000));
  const pendingRun = await prisma.agentRun.findFirst({
    where: {
      conversationId,
      status: { in: ["PENDING", "RUNNING"] },
      createdAt: { gte: runCutoff },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, startedAt: true },
  });

  // The job exists from message creation onward, before any AgentRun does.
  // Exposing it closes the queued-but-not-started window where the conversation
  // previously reported "no active work" and the client had to guess.
  const activeJob = await prisma.job.findFirst({
    where: {
      type: "RUN_ANALYST",
      status: { in: ["PENDING", "RUNNING"] },
      payload: { path: ["conversationId"], equals: conversationId },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true },
  });

  const messageDTOs: MessageDTO[] = messages.map((message) => ({
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content,
    evidenceClass: message.evidenceClass,
    agentRun: message.agentRun
      ? {
          id: message.agentRun.id,
          model: message.agentRun.model,
          status: message.agentRun.status,
          latencyMs: message.agentRun.latencyMs,
          steps: message.agentRun.steps,
          toolsUsed: (message.agentRun.toolsUsed as unknown as string[]) ?? [],
        }
      : null,
    payload: (message.payload as Record<string, unknown>) ?? null,
    createdAt: message.createdAt.toISOString(),
  }));

  return {
    id: conversation.id,
    title: conversation.title,
    kind: conversation.kind,
    status: conversation.status,
    messages: messageDTOs,
    nextRun: pendingRun
      ? {
          runId: pendingRun.id,
          status: pendingRun.status,
          startedAt: pendingRun.startedAt?.toISOString() ?? null,
        }
      : null,
    activeJob: activeJob
      ? {
          id: activeJob.id,
          status: activeJob.status,
          createdAt: activeJob.createdAt.toISOString(),
        }
      : null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export async function createMessage(input: {
  conversationId: string;
  content: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
}) {
  await requireOwnedConversation(
    input.conversationId,
    input.organizationId,
    input.workspaceId,
    "AI_MESSAGE_CREATE",
  );

  const readyDatasets = await listReadyDatasets(input.organizationId, input.workspaceId);
  if (readyDatasets.length === 0) {
    throw new AppError(
      "CONFLICT",
      "No analytics-ready datasets in this workspace yet. Import data before asking the AI Analyst.",
      { ready: false, datasetCount: 0 },
    );
  }

  // Enforce the per-period run cap at the API layer; the cap is billed when the
  // job is accepted so the worker never needs entitlement logic (T022).
  await recordUsage(input.organizationId, "ai_runs", 1);

  const userMessage = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: "USER",
      kind: "CHAT",
      content: input.content,
    },
    select: { id: true },
  });

  const job = await enqueueJob({
    type: "RUN_ANALYST",
    organizationId: input.organizationId,
    // The job answers exactly this message. Without the binding the worker
    // falls back to "the last user message at processing time", which answers
    // the wrong question whenever a second message lands before the first job
    // is claimed.
    payload: { conversationId: input.conversationId, userMessageId: userMessage.id },
  });

  return {
    messageId: userMessage.id,
    status: "QUEUED",
    agentRunId: null,
    runStatus: "PENDING",
    conversationId: input.conversationId,
    jobId: job.id,
  };
}

export async function cancelRun(conversationId: string, organizationId: string, workspaceId: string) {
  await requireOwnedConversation(conversationId, organizationId, workspaceId, "AI_RUN_CANCEL");

  const run = await prisma.agentRun.findFirst({
    where: { conversationId, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (run) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "STOPPED", completedAt: new Date(), error: "Cancelled by user." },
    });
  }

  const job = await prisma.job.findFirst({
    where: {
      type: "RUN_ANALYST",
      status: "PENDING",
      payload: { path: ["conversationId"], equals: conversationId },
    },
    select: { id: true },
  });
  if (job) {
    await cancelJob(job.id, "Cancelled by user.");
  }

  return { runId: run?.id ?? null, status: "STOPPED" };
}

// US5 Evidence & Transparency

export interface AgentRunDTO {
  id: string;
  kind: string;
  model: string;
  promptVersion: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  toolsUsed: string[];
  conversationId: string | null;
  investigationId: string | null;
  error: string | null;
  toolCalls?: ToolCallDTO[];
}

export interface ToolCallDTO {
  id: string;
  name: string;
  sequence: number;
  arguments: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface EvidenceChainDTO {
  messageId: string;
  evidenceClass: string | null;
  run: {
    id: string;
    status: string;
    model: string;
  } | null;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    output: Record<string, unknown> | null;
  }>;
  dataRefs: Array<{
    kind: string;
    id: string;
    name: string;
  }>;
}

async function requireOwnedRun(runId: string, organizationId: string, workspaceId: string, action: string) {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, organizationId, workspaceId },
  });
  if (!run) {
    await record({
      organizationId,
      workspaceId,
      action,
      resourceType: "agent_run",
      resourceId: runId,
      metadata: { reason: "foreign-or-unknown" },
    }).catch(() => undefined);
    throw notFound("Agent run not found");
  }
  return run;
}

export async function listAgentRuns(
  organizationId: string,
  workspaceId: string,
  filters: {
    kind?: string;
    status?: string;
    model?: string;
    from?: string;
    to?: string;
    page?: number;
    perPage?: number;
  },
) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.perPage ?? 20, 100);
  const skip = (page - 1) * perPage;

  const where: Prisma.AgentRunWhereInput = {
    organizationId,
    workspaceId,
    ...(filters.kind && { kind: filters.kind as Prisma.EnumAgentKindFilter }),
    ...(filters.status && { status: filters.status as Prisma.EnumAgentRunStatusFilter }),
    ...(filters.model && { model: { contains: filters.model } }),
    ...(filters.from && { createdAt: { gte: new Date(filters.from) } }),
    ...(filters.to && { createdAt: { lte: new Date(filters.to) } }),
  };

  const [runs, total] = await prisma.$transaction([
    prisma.agentRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
      select: {
        id: true,
        kind: true,
        model: true,
        status: true,
        startedAt: true,
        completedAt: true,
        latencyMs: true,
        steps: true,
        conversationId: true,
        investigationId: true,
        createdAt: true,
      },
    }),
    prisma.agentRun.count({ where }),
  ]);

  const items = runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    latencyMs: run.latencyMs,
    steps: run.steps,
    conversationId: run.conversationId,
    investigationId: run.investigationId,
    createdAt: run.createdAt.toISOString(),
  }));

  return {
    items,
    meta: { page, perPage, total },
  };
}

export async function getAgentRun(
  runId: string,
  organizationId: string,
  workspaceId: string,
): Promise<AgentRunDTO> {
  await requireOwnedRun(runId, organizationId, workspaceId, "AI_RUN_READ");

  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      toolCalls: {
        orderBy: { sequence: "asc" },
      },
    },
  });

  return {
    id: run.id,
    kind: run.kind,
    model: run.model,
    promptVersion: run.promptVersion,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    latencyMs: run.latencyMs,
    steps: run.steps,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    toolsUsed: (run.toolsUsed as string[]) ?? [],
    conversationId: run.conversationId,
    investigationId: run.investigationId,
    error: run.error,
    toolCalls: run.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      sequence: tc.sequence,
      arguments: typeof tc.argumentsJson === 'string'
        ? JSON.parse(tc.argumentsJson)
        : (tc.argumentsJson as Record<string, unknown>) ?? {},
      output: typeof tc.outputJson === 'string'
        ? JSON.parse(tc.outputJson)
        : (tc.outputJson as Record<string, unknown>) ?? null,
      status: tc.status,
      latencyMs: tc.latencyMs,
      error: tc.error,
      createdAt: tc.createdAt.toISOString(),
    })),
  };
}

export async function getToolCall(
  runId: string,
  toolCallId: string,
  organizationId: string,
  workspaceId: string,
): Promise<ToolCallDTO> {
  await requireOwnedRun(runId, organizationId, workspaceId, "AI_TOOL_CALL_READ");

  const toolCall = await prisma.toolCallRecord.findFirst({
    where: { id: toolCallId, agentRunId: runId },
  });

  if (!toolCall) {
    throw notFound("Tool call not found");
  }

  return {
    id: toolCall.id,
    name: toolCall.name,
    sequence: toolCall.sequence,
    arguments: typeof toolCall.argumentsJson === 'string'
      ? JSON.parse(toolCall.argumentsJson)
      : (toolCall.argumentsJson as Record<string, unknown>) ?? {},
    output: typeof toolCall.outputJson === 'string'
      ? JSON.parse(toolCall.outputJson)
      : (toolCall.outputJson as Record<string, unknown>) ?? null,
    status: toolCall.status,
    latencyMs: toolCall.latencyMs,
    error: toolCall.error,
    createdAt: toolCall.createdAt.toISOString(),
  };
}

export async function getEvidence(
  messageId: string,
  organizationId: string,
  workspaceId: string,
): Promise<EvidenceChainDTO> {
  const message = await prisma.message.findFirst({
    where: { id: messageId },
    include: {
      agentRun: {
        include: {
          toolCalls: {
            orderBy: { sequence: "asc" },
          },
        },
      },
      conversation: {
        select: { organizationId: true, workspaceId: true },
      },
    },
  });

  if (!message || message.conversation.organizationId !== organizationId || message.conversation.workspaceId !== workspaceId) {
    await record({
      organizationId,
      workspaceId,
      action: "AI_EVIDENCE_READ",
      resourceType: "message",
      resourceId: messageId,
      metadata: { reason: "foreign-or-unknown" },
    }).catch(() => undefined);
    throw notFound("Message not found");
  }

  const dataRefs: Array<{ kind: string; id: string; name: string }> = [];

  // Extract dataset references from tool calls
  if (message.agentRun) {
    for (const tc of message.agentRun.toolCalls) {
      const args = typeof tc.argumentsJson === 'string'
        ? JSON.parse(tc.argumentsJson)
        : (tc.argumentsJson as Record<string, unknown>) ?? {};
      if (args.datasetId && typeof args.datasetId === "string") {
        try {
          const dataset = await prisma.dataset.findUnique({
            where: { id: args.datasetId },
            select: { id: true, name: true },
          });
          if (dataset && !dataRefs.some((ref) => ref.id === dataset.id)) {
            dataRefs.push({
              kind: "dataset",
              id: dataset.id,
              name: dataset.name,
            });
          }
        } catch {
          // Invalid UUID or dataset not found - skip this reference
        }
      }
    }
  }

  return {
    messageId: message.id,
    evidenceClass: message.evidenceClass,
    run: message.agentRun
      ? {
          id: message.agentRun.id,
          status: message.agentRun.status,
          model: message.agentRun.model,
        }
      : null,
    toolCalls: message.agentRun?.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: typeof tc.argumentsJson === 'string'
        ? JSON.parse(tc.argumentsJson)
        : (tc.argumentsJson as Record<string, unknown>) ?? {},
      output: typeof tc.outputJson === 'string'
        ? JSON.parse(tc.outputJson)
        : (tc.outputJson as Record<string, unknown>) ?? null,
    })) ?? [],
    dataRefs,
  };
}