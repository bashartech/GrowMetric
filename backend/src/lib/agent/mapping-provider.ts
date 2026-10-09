import { env } from "../../config/env.js";
import { GroqEngine } from "./provider.js";
import type { AgentContext, AgentEngine } from "./provider.js";

/**
 * MappingProvider is the seam between SUGGEST_MAPPING jobs and the model
 * provider. The default implementation is a single-shot Groq completion with
 * no tools (the mapping prompt is answered with a plain JSON payload); tests
 * inject a scripted provider so no live model runs under CI (FR-020).
 */

export interface MappingCompletion {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface MappingPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface MappingProvider {
  readonly model: string;
  complete(prompt: MappingPrompt): Promise<MappingCompletion>;
}

export class GroqMappingProvider implements MappingProvider {
  readonly model: string;
  private readonly engine: AgentEngine;

  constructor() {
    this.engine = new GroqEngine({
      apiKey: env.OPENROUTER_API_KEY ?? "",
      // apiKey: env.OPENROUTER_API_KEY ?? "",
      baseUrl: env.AI_BASE_URL,
      model: env.AI_MODEL,
      maxTokens: env.AI_MAX_OUTPUT_TOKENS ?? env.AI_MAX_TOKENS,
      timeoutMs: env.AI_TIMEOUT_MS,
      tools: [],
      systemPrompt: "",
    });
    this.model = env.AI_MODEL;
  }

  async complete(prompt: MappingPrompt): Promise<MappingCompletion> {
    const context: AgentContext = {
      messageHistory: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ],
      toolInteractions: [],
      turnCount: 1,
      toolCallCount: 0,
    };
    const result = await this.engine.runOnce(context);
    if (result.kind !== "final") {
      throw new Error("Mapping provider returned an unexpected tool call.");
    }
    return {
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }
}

let activeProvider: MappingProvider | null = null;
let defaultProvider: MappingProvider | null = null;

export function setMappingProvider(provider: MappingProvider | null): void {
  activeProvider = provider;
}

export function getMappingProvider(): MappingProvider {
  const fallback = defaultProvider ?? new GroqMappingProvider();
  defaultProvider = fallback;
  return activeProvider ?? defaultProvider;
}