import type {
  AgentContext,
  AgentEngine,
  AgentEngineResult,
  AgentToolCall,
  ProviderMessageHistoryItem,
  ToolCallRequest,
} from "./provider.js";
import { hasFiguresOutsideToolData, type RecordedToolOutput } from "./evidence.js";
import { toolFor, sanitizedToolOutput, type AgentTool } from "./tools.js";
import {
  createBudget,
  recordStep,
  recordToolCall,
  recordUsage,
  assertWithinWallClock,
  toRunStatus,
  type BudgetLimits,
} from "./budgets.js";
import { redactSensitiveStrings } from "../logger.js";

export type EngineRunStatus = "COMPLETED" | "STOPPED" | "FAILED" | "RUNNING";

export interface EngineRunParams {
  runKey: string;
  organizationId: string;
  workspaceId: string;
  jobId?: string;
  conversationId?: string;
  userId?: string;
  runType: string;
  model: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface RunInfo {
  runId: string;
  runKey: string;
  status: EngineRunStatus;
  /** When the run row was last started; null when the store cannot say. */
  startedAt?: Date | null;
}

export interface RecordedToolCall {
  seq: number;
  toolName: string;
  argumentsJson: string;
  status: "SUCCESS" | "ERROR";
  outputJson: string;
  error?: string;
  latencyMs: number;
}

export interface RunFinalization {
  status: EngineRunStatus;
  error?: string;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  includesForeignFigures?: boolean;
}

/**
 * RunStore is the persistence seam the engine drives. Implementations write
 * AgentRun + ToolCallRecord rows (PrismaRunStore); tests use the in-memory
 * store so the engine has no database dependency (FR-020).
 */
export interface RunStore {
  getRunByKey(runKey: string): Promise<RunInfo | null>;
  createRun(input: EngineRunParams): Promise<RunInfo>;
  recordToolCall(runId: string, call: RecordedToolCall): Promise<void>;
  finalize(runId: string, finalization: RunFinalization): Promise<void>;
}

export interface EngineOutcome {
  status: EngineRunStatus;
  runId?: string;
  finalContent?: string;
  includesForeignFigures?: boolean;
  steps: number;
  toolCalls: number;
  error?: string;
}

export interface EngineDependencies {
  provider: AgentEngine;
  tools: AgentTool[];
  store: RunStore;
  bounds: BudgetLimits;
}

/**
 * Last-resort backstop on the prompt size. A run that stays inside its budgets
 * adds at most one assistant message per step plus one tool result per tool
 * call. Sizing this from the budgets keeps the backstop from preempting the
 * budget itself: a budget-exceeded run has to report STOPPED, not FAILED with a
 * misleading "conversation grew too long" error.
 */
function maxHistoryItems(bounds: BudgetLimits): number {
  return 2 + bounds.maxSteps + bounds.maxToolCalls;
}
const MAX_TOOL_MESSAGE_CHARS = 1400;
const TRUNCATION_MARKER = "\n…[truncated]";

function idempotentOutcome(existing: RunInfo): EngineOutcome {
  return {
    status: existing.status,
    runId: existing.runId,
    finalContent: undefined,
    steps: 0,
    toolCalls: 0,
    error: "Run already exists for this runKey.",
  };
}

/**
 * A run left RUNNING by a dead worker never finishes on its own: the retried
 * job hits the runKey idempotency check, gets the frozen RUNNING row back and
 * would otherwise end as a non-answer while the row stays pinned forever (the
 * conversation then shows "Analyzing" indefinitely). Past the run budget the
 * previous attempt is provably dead, so the retry takes the row over and runs
 * for real. Only evidence of staleness (a known start time) triggers this —
 * a store that cannot report startedAt keeps the old idempotent behaviour.
 */
const STALE_RUN_GRACE_MS = 60_000;

const isStaleRunning = (existing: RunInfo, timeoutMs: number): boolean => {
  if (existing.status !== "RUNNING" || !existing.startedAt) return false;
  return Date.now() - new Date(existing.startedAt).getTime() > timeoutMs + STALE_RUN_GRACE_MS;
};

export async function runAgent(
  params: EngineRunParams,
  deps: EngineDependencies,
): Promise<EngineOutcome> {
  const existing = await deps.store.getRunByKey(params.runKey);
  if (existing && !isStaleRunning(existing, deps.bounds.timeoutMs)) {
    return idempotentOutcome(existing);
  }

  const startedAt = Date.now();
  const budget = createBudget(deps.bounds);
  const run = await deps.store.createRun(params);

  const history: ProviderMessageHistoryItem[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: params.userPrompt },
  ];
  const recorded: RecordedToolOutput[] = [];
  let finalContent: string | null = null;
  let includesForeignFigures: boolean | null = null;
  let turnCount = 0;
  let toolCallsRun = 0;
  let seqCounter = 0;
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;
  let recoveredFromParseFailure = false;

  try {
    for (;;) {
      recordStep(budget, deps.bounds);
      assertWithinWallClock(budget, deps.bounds);

      const context = buildContext(history, params.model, turnCount, toolCallsRun);
      let result: AgentEngineResult;
      try {
        result = await deps.provider.runOnce(context);
      } catch (error) {
        if (!recoveredFromParseFailure && isParseFailure(error)) {
          recoveredFromParseFailure = true;
          dropLargestToolMessage(history);
          continue;
        }
        throw error;
      }
      inputTokensTotal += result.inputTokens;
      outputTokensTotal += result.outputTokens;
      recordUsage(budget, deps.bounds, result.inputTokens, result.outputTokens);

      if (result.kind === "final") {
        finalContent = result.content;
        includesForeignFigures =
          result.includesForeignFigures ?? hasFiguresOutsideToolData(finalContent, recorded);
        history.push({ role: "assistant", content: finalContent });
        break;
      }

      const assistantTurn: ProviderMessageHistoryItem = {
        role: "assistant",
        content: null,
        toolCalls: result.calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
      history.push(assistantTurn);

      for (const call of result.calls) {
        seqCounter += 1;
        history.push(
          await executeToolCall(
            call,
            seqCounter,
            deps,
            run.runId,
            history,
            recorded,
            {
              organizationId: params.organizationId,
              workspaceId: params.workspaceId,
            },
            () => {
              toolCallsRun += 1;
              recordToolCall(budget, deps.bounds);
            },
          ),
        );
      }

      turnCount += 1;
      if (history.length > maxHistoryItems(deps.bounds)) {
        throw new Error(
          "Conversation grew too long for this run. Refine the question and try again.",
        );
      }
    }

    await deps.store.finalize(run.runId, {
      status: "COMPLETED",
      steps: turnCount,
      toolCalls: toolCallsRun,
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      latencyMs: Date.now() - startedAt,
      includesForeignFigures: includesForeignFigures ?? false,
    });

    return {
      status: "COMPLETED",
      runId: run.runId,
      finalContent: finalContent ?? undefined,
      includesForeignFigures: includesForeignFigures ?? false,
      steps: turnCount,
      toolCalls: toolCallsRun,
    };
  } catch (error) {
    const status = toRunStatus(error);
    const message = redactSensitiveStrings(errorMessage(error)).slice(0, 500);
    await deps.store.finalize(run.runId, {
      status,
      error: message,
      steps: turnCount,
      toolCalls: toolCallsRun,
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      latencyMs: Date.now() - startedAt,
    });
    return {
      status,
      runId: run.runId,
      finalContent: undefined,
      steps: turnCount,
      toolCalls: toolCallsRun,
      error: message,
    };
  }
}

function buildContext(
  history: ProviderMessageHistoryItem[],
  model: string,
  turnCount: number,
  toolCallCount: number,
): AgentContext {
  void model;
  const toolInteractions = toInteractions(history);
  return {
    messageHistory: history,
    toolInteractions,
    turnCount,
    toolCallCount,
  };
}

function toInteractions(
  history: ProviderMessageHistoryItem[],
): Array<{
  call: ToolCallRequest;
  result: { ok: boolean; content: string; error?: string };
}> {
  const interactions: Array<{
    call: ToolCallRequest;
    result: { ok: boolean; content: string; error?: string };
  }> = [];
  let pendingCall: ToolCallRequest | null = null;
  for (const item of history) {
    const firstCall = item.toolCalls?.[0];
    if (item.role === "assistant" && firstCall) {
      pendingCall = {
        id: firstCall.id,
        name: firstCall.function.name,
        arguments: firstCall.function.arguments,
      };
    } else if (item.role === "tool" && pendingCall) {
      interactions.push({
        call: pendingCall,
        result: { ok: true, content: item.content ?? "" },
      });
      pendingCall = null;
    }
  }
  return interactions;
}

async function executeToolCall(
  call: AgentToolCall,
  seq: number,
  deps: EngineDependencies,
  runId: string,
  history: ProviderMessageHistoryItem[],
  recorded: RecordedToolOutput[],
  tenant: { organizationId: string; workspaceId: string },
  countCall: () => void,
): Promise<ProviderMessageHistoryItem> {
  const tool = toolFor(call.name);
  const startedAt = Date.now();
  countCall();

  try {
    if (!tool) {
      throw new Error(`Tool "${call.name}" is not in the approved catalog.`);
    }
    const parsedArgs = tool.argsSchema.parse(call.arguments);
    const runTool = deps.tools.find((candidate) => candidate.name === call.name) ?? tool;
    const output = await runTool.run(parsedArgs, tenant, () => undefined);
    const sanitized = await sanitizedToolOutput(runTool, output);
    const outputJson = JSON.stringify(sanitized.content);

    recorded.push({
      toolName: tool.name,
      output: outputJson,
      figures: sanitized.figures,
    });

    await deps.store.recordToolCall(runId, {
      seq,
      toolName: tool.name,
      argumentsJson: JSON.stringify(call.arguments),
      status: sanitized.ok ? "SUCCESS" : "ERROR",
      outputJson,
      error: sanitized.error,
      latencyMs: Date.now() - startedAt,
    });

    return {
      role: "tool",
      toolCallId: call.id,
      name: tool.name,
      content: truncateForModel(
        sanitized.ok ? outputJson : JSON.stringify({ error: sanitized.error }),
      ),
    };
  } catch (error) {
    const message = redactSensitiveStrings(errorMessage(error)).slice(0, 500);
    await deps.store.recordToolCall(runId, {
      seq,
      toolName: tool?.name ?? call.name,
      argumentsJson: JSON.stringify(call.arguments),
      status: "ERROR",
      outputJson: "{}",
      error: message,
      latencyMs: Date.now() - startedAt,
    });
    return {
      role: "tool",
      toolCallId: call.id,
      name: tool?.name ?? call.name,
      content: truncateForModel(JSON.stringify({ error: message })),
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Keeps the copy of a tool result that is fed back to the model small: the
 * persisted ToolCallRecord row and the evidence buffer keep the FULL output,
 * so trimming this preview never weakens the figure-verification guard.
 */
function truncateForModel(content: string): string {
  if (content.length <= MAX_TOOL_MESSAGE_CHARS) return content;
  return content.slice(0, MAX_TOOL_MESSAGE_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * Groq/OpenRouter occasionally return a 400 "Parsing failed" when the model's
 * tool-call output does not parse against a very large context. Recovery:
 * drop the noisiest assistant+tool turn once and let the loop continue.
 */
function isParseFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bparsing failed\b|could not be parsed/i.test(message);
}

function dropLargestToolMessage(history: ProviderMessageHistoryItem[]): void {
  let largestIndex = -1;
  let largestLength = -1;
  history.forEach((item, index) => {
    const size = item.role === "tool" ? (item.content?.length ?? 0) : 0;
    if (size > largestLength) {
      largestIndex = index;
      largestLength = size;
    }
  });
  if (largestIndex < 0) return;

  let start = largestIndex - 1;
  while (start >= 0 && history[start]?.role !== "assistant") start -= 1;
  if (start >= 0 && history[start]?.role === "assistant") {
    let end = start + 1;
    while (end < history.length && history[end]?.role === "tool") end += 1;
    history.splice(start, end - start);
    return;
  }
  history.splice(largestIndex, 1);
}

// Export for tests using tools directly.
export { toolFor };