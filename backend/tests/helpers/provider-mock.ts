import { readFileSync } from "node:fs";
import type {
  AgentContext,
  AgentEngine,
  AgentEngineResult,
  ToolCallRequest,
} from "../../src/lib/agent/provider.js";

/**
 * MockProvider implements the AgentEngine contract for tests. It never talks
 * to a live model. Scenarios are scriptable so unit/integration tests can
 * exercise the engine loop, budgets, tool execution, honest-failure paths,
 * and non-compliant provider output deterministically (FR-020).
 */

export interface ScriptedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ScriptedFinalTurn {
  content: string;
  /** Nudge the engine's figures-outside-tool-data guard. */
  includesForeignFigures?: boolean;
}

export interface ScriptedProviderTurn {
  toolCalls?: ScriptedToolCall[];
  final?: ScriptedFinalTurn;
  /** Simulate provider timeout/error. */
  failWith?: string;
}

export interface MockProviderScenario {
  turns: ScriptedProviderTurn[];
  /** Override token/usage stubs. */
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

const DEFAULT_MODEL = "mock-model-v1";

export class MockProvider implements AgentEngine {
  readonly model: string;
  private readonly scenario: MockProviderScenario;
  private turnIndex = 0;
  public toolRequests: ToolCallRequest[] = [];

  constructor(scenario: MockProviderScenario) {
    const firstTurn = scenario.turns[0] ?? {};
    this.model = scenario.model ?? DEFAULT_MODEL;
    this.scenario = scenario;
    if (firstTurn.failWith !== undefined && scenario.turns.length > 1) {
      throw new Error(
        "MockProvider: a failing first turn must be the only turn in the scenario.",
      );
    }
  }

  get remainingSteps(): number {
    return this.scenario.turns.length - this.turnIndex;
  }

  async runOnce(context: AgentContext): Promise<AgentEngineResult> {
    this.toolRequests = context.toolInteractions.map((interaction) => interaction.call);
    if (this.turnIndex >= this.scenario.turns.length) {
      return {
        kind: "final",
        content: "[mock] No more scripted turns; finished.",
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const turn = this.scenario.turns[this.turnIndex]!;
    this.turnIndex += 1;

    if (turn.failWith) {
      throw new Error(turn.failWith);
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      return {
        kind: "tool-calls",
        calls: turn.toolCalls.map((call, index) => ({
          id: `mock_call_${this.turnIndex - 1}_${index}`,
          name: call.name,
          arguments: call.arguments,
        })),
        inputTokens: this.scenario.inputTokens ?? 10,
        outputTokens: this.scenario.outputTokens ?? 5,
      };
    }

    return {
      kind: "final",
      content: turn.final?.content ?? "[mock] completed.",
      includesForeignFigures: turn.final?.includesForeignFigures ?? false,
      inputTokens: this.scenario.inputTokens ?? 10,
      outputTokens: this.scenario.outputTokens ?? 5,
    };
  }

  get name(): string {
    return "mock";
  }
}

export const VALID_TOOL_NAMES = [
  "get_workspace_datasets",
  "get_dataset_schema",
  "get_dataset_sample",
  "run_readonly_sql",
  "calculate_metric",
  "compare_periods",
  "group_by_dimension",
  "find_top_entities",
  "find_anomalies",
  "generate_chart_spec",
  "get_business_context",
] as const;

export function scriptedToolCallScenario(): MockProviderScenario {
  return {
    model: DEFAULT_MODEL,
    inputTokens: 12,
    outputTokens: 7,
    turns: [
      {
        toolCalls: [
          { name: "get_workspace_datasets", arguments: {} },
          { name: "calculate_metric", arguments: { metricKey: "revenue" } },
        ],
      },
      {
        final: {
          content:
            "Revenue was 482100.50 USD, computed from the sum of the total column (CALCULATED).",
        },
      },
    ],
  };
}

export function scriptedHallucinationScenario(): MockProviderScenario {
  return {
    turns: [
      {
        toolCalls: [{ name: "get_workspace_datasets", arguments: {} }],
      },
      {
        final: {
          content: "Revenue was 999999.99 USD and profit margin was 42%.",
          includesForeignFigures: true,
        },
      },
    ],
  };
}

export function scriptedBudgetScenario(): MockProviderScenario {
  return {
    turns: [
      {
        toolCalls: [{ name: "get_workspace_datasets", arguments: {} }],
      },
      {
        toolCalls: [{ name: "calculate_metric", arguments: { metricKey: "revenue" } }],
      },
      {
        toolCalls: [{ name: "group_by_dimension", arguments: { metricKey: "revenue" } }],
      },
      {
        toolCalls: [{ name: "find_anomalies", arguments: { metricKey: "revenue" } }],
      },
      {
        toolCalls: [{ name: "compare_periods", arguments: { metricKey: "revenue" } }],
      },
      {
        toolCalls: [{ name: "calculate_metric", arguments: { metricKey: "orders" } }],
      },
    ],
  };
}

export function scriptedSingleFinalScenario(content = "Done.", failed = false): MockProviderScenario {
  return {
    turns: [
      failed
        ? { final: { content }, failWith: "provider unavailable" }
        : { final: { content } },
    ],
  };
}

/** Loads a scripted scenario from one of tests/fixtures/ai/*.json (T005). */
export function loadScriptedScenario(jsonPath: string): MockProviderScenario {
  const raw = readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as MockProviderScenario;
  if (!Array.isArray(parsed.turns)) {
    throw new Error(`MockProvider fixture ${jsonPath} is missing "turns".`);
  }
  return parsed;
}