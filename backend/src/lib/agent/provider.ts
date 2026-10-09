import OpenAI from "openai";

const PROVIDER_MAX_ATTEMPTS = 4;
const PROVIDER_BACKOFF_BASE_MS = 1_000;
const PROVIDER_BACKOFF_MAX_MS = 8_000;

const isRetryableProviderError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  return true;
};

const retryAfterMs = (error: unknown): number | null => {
  const headers = (error as { headers?: { get?: (name: string) => string | null } }).headers;
  const raw = headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, PROVIDER_BACKOFF_MAX_MS);
  }
  const retryAt = new Date(raw).getTime();
  if (!Number.isNaN(retryAt)) {
    return Math.min(Math.max(retryAt - Date.now(), 0), PROVIDER_BACKOFF_MAX_MS);
  }
  return null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * AgentEngine is the seam between GrowMetrics and the model provider.
 * The only concrete implementation this phase supports is Groq through the
 * OpenAI-compatible chat-completions API (research R1); a mock provider is
 * used in tests so no live model is ever invoked under CI (FR-020).
 */

export interface ToolCallRequest {
  id: string;
  name: string;
  /** JSON string of the sanitized tool arguments the model asked to run. */
  arguments: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  /** Parsed, sanitized arguments. */
  arguments: Record<string, unknown>;
}

export interface AgentEngineFinal {
  kind: "final";
  content: string;
  /**
   * True when the final answer cites figures that cannot be traced back to
   * tool results (see engine guard). Storage keeps the answer flag.
   */
  includesForeignFigures?: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentEngineToolCalls {
  kind: "tool-calls";
  calls: AgentToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export type AgentEngineResult = AgentEngineFinal | AgentEngineToolCalls;

export interface AgentContext {
  /** Full provider-neutral message history produced so far. */
  messageHistory: ProviderMessageHistoryItem[];
  /** Tool call/result pairs in payload order. */
  toolInteractions: Array<{
    call: ToolCallRequest;
    result: { ok: boolean; content: string; error?: string };
  }>;
  /** Turns already consumed (tool cycles + final completions). */
  turnCount: number;
  /** Total tool calls executed so far. */
  toolCallCount: number;
}

export interface AgentEngine {
  readonly model: string;
  readonly name: string;
  /**
   * Produce the next assistant turn given accumulated context.
   * Throws to signal provider-level failures (timeouts, network, 429/5xx).
   */
  runOnce(context: AgentContext): Promise<AgentEngineResult>;
}

export interface AgentEngineToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GroqEngineOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  tools: AgentEngineToolSchema[];
  systemPrompt: string;
}

export interface ProviderMessageHistoryItem {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  toolCallId?: string;
  name?: string | null;
}

export type ProviderMessageMapper = (
  context: AgentContext,
) => { messages: ProviderMessageHistoryItem[] };

/**
 * GroqEngine speaks the OpenAI-compatible chat-completions protocol against
 * AI_BASE_URL. It never persists keys, never echoes credentials into the
 * history, and reports usage/latency upward for the AgentRun (T009).
 */
export class GroqEngine implements AgentEngine {
  readonly model: string;
  readonly name = "groq";

  private readonly client: OpenAI;
  private readonly options: GroqEngineOptions;

  constructor(options: GroqEngineOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      maxRetries: 0,
    });
    this.model = options.model;
    this.options = options;
  }

  async runOnce(context: AgentContext): Promise<AgentEngineResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < PROVIDER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const completion = await this.requestCompletion(context);

        const usage = completion.usage;
        const inputTokens = usage?.prompt_tokens ?? 0;
        const outputTokens = usage?.completion_tokens ?? 0;
        const message = completion.choices[0]?.message;

        if (message?.tool_calls && message.tool_calls.length > 0) {
          return {
            kind: "tool-calls",
            calls: message.tool_calls.map((call) => ({
              id: call.id,
              name: call.function?.name ?? "",
              arguments: parseToolArguments(call.function?.arguments),
            })),
            inputTokens,
            outputTokens,
          };
        }

        return {
          kind: "final",
          content: message?.content ?? "",
          inputTokens,
          outputTokens,
        };
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderError(error)) throw error;
        if (attempt + 1 >= PROVIDER_MAX_ATTEMPTS) break;
        const delayMs =
          retryAfterMs(error) ??
          Math.min(
            PROVIDER_BACKOFF_BASE_MS * 2 ** attempt,
            PROVIDER_BACKOFF_MAX_MS,
          );
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  private async requestCompletion(
    context: AgentContext,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.client.chat.completions.create(
      {
        model: this.model,
        messages: toChatMessages(context.messageHistory),
        tools: this.options.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        max_tokens: this.options.maxTokens,
      },
      { signal: abortControllerFor(this.options.timeoutMs) },
    );
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toChatMessages(
  items: ProviderMessageHistoryItem[],
): Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  return items.map((item) => {
    switch (item.role) {
      case "system":
        return { role: "system", content: item.content ?? "" };
      case "user":
        return { role: "user", content: item.content ?? "" };
      case "assistant":
        return {
          role: "assistant",
          content: item.content ?? null,
          ...(item.toolCalls ? { tool_calls: item.toolCalls } : {}),
        };
      case "tool":
        return {
          role: "tool",
          tool_call_id: item.toolCallId ?? "",
          content: item.content ?? "",
        };
    }
  }) as Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>;
}

function abortControllerFor(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}