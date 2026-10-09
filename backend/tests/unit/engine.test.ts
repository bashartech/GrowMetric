import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  computeMetric: vi.fn(),
  groupBySemanticKey: vi.fn(),
  listDatasets: vi.fn(),
  getDatasetRows: vi.fn(),
  datasetColumnFindMany: vi.fn(),
  datasetFindUnique: vi.fn(),
  comparePeriods: vi.fn(),
  groupByMetric: vi.fn(),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    dataset: { findUnique: mocks.datasetFindUnique },
    datasetColumn: { findMany: mocks.datasetColumnFindMany },
  },
}));
vi.mock("../../src/modules/analytics/metrics.service.js", () => ({
  computeMetric: mocks.computeMetric,
  groupBySemanticKey: mocks.groupBySemanticKey,
  comparePeriods: mocks.comparePeriods,
  groupByMetric: mocks.groupByMetric,
}));
vi.mock("../../src/modules/datasets/dataset.service.js", () => ({
  listDatasets: mocks.listDatasets,
  getDatasetRows: mocks.getDatasetRows,
}));

import { runAgent, type RecordedToolCall, type RunFinalization, type RunInfo, type RunStore } from "../../src/lib/agent/engine.js";
import { AGENT_TOOL_CATALOG } from "../../src/lib/agent/tools.js";
import {
  extractFigures,
  hasFiguresOutsideToolData,
  type RecordedToolOutput,
} from "../../src/lib/agent/evidence.js";
import { buildExplanation, SIMULATION_MODEL_VERSION } from "../../src/lib/simulation.js";
import { loadScriptedScenario, MockProvider } from "../helpers/provider-mock.js";
import { resolve } from "node:path";

const BASE_PARAMS = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  runType: "ANALYST",
  model: "mock-model-v1",
  promptVersion: "analyst-v1",
  systemPrompt: "You are the analyst.",
  userPrompt: "What was revenue?",
};

class InMemoryRunStore implements RunStore {
  runs = new Map<string, RunInfo>();
  calls: RecordedToolCall[] = [];
  finalized: RunFinalization[] = [];

  async getRunByKey(runKey: string): Promise<RunInfo | null> {
    return this.runs.get(runKey) ?? null;
  }

  async createRun(input: {
    runKey: string;
    organizationId: string;
    workspaceId: string;
    runType: string;
    model: string;
    promptVersion: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<RunInfo> {
    const info: RunInfo = {
      runId: `run-${this.runs.size + 1}`,
      runKey: input.runKey,
      status: "RUNNING",
    };
    this.runs.set(input.runKey, info);
    return info;
  }

  async recordToolCall(runId: string, call: RecordedToolCall): Promise<void> {
    this.calls.push(call);
  }

  async finalize(runId: string, finalization: RunFinalization): Promise<void> {
    this.finalized.push(finalization);
    for (const run of this.runs.values()) {
      if (run.runId === runId) run.status = finalization.status;
    }
  }
}

function deps(store: RunStore, scenarioFile?: string) {
  const scenario = scenarioFile
    ? loadScriptedScenario(resolve(__dirname, "..", "fixtures", "ai", scenarioFile))
    : undefined;
  return {
    provider: new MockProvider(scenario ?? loadScriptedScenario(resolve(__dirname, "..", "fixtures", "ai", "computable.json"))),
    tools: AGENT_TOOL_CATALOG,
    store,
    bounds: {
      maxSteps: 10,
      maxToolCalls: 12,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      timeoutMs: 60_000,
    },
  };
}

function defaultServices() {
  mocks.listDatasets.mockResolvedValue([
    { id: "ds-1", name: "Sales", status: "READY", rowCount: 100 },
  ]);
  mocks.getDatasetRows.mockResolvedValue({ rows: [], limit: 1, offset: 0, hasMore: false });
  mocks.computeMetric.mockResolvedValue({
    metricKind: "REVENUE",
    value: 482100.5,
    unit: "USD",
    available: true,
  });
  mocks.groupBySemanticKey.mockResolvedValue({
    available: true,
    rows: [{ group: "East", value: 220000 }],
  });
  mocks.datasetColumnFindMany.mockResolvedValue([
    { id: "c1", name: "total", type: "DECIMAL", semanticKey: "revenue", businessMeaning: "Revenue" },
  ]);
  mocks.datasetFindUnique.mockResolvedValue({ id: "ds-1", currentVersionId: "v-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  defaultServices();
});

describe("agent engine loop", () => {
  it("completes a computable run executing tools and reporting evidence figures", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent({ ...BASE_PARAMS, runKey: "k-1" }, deps(store, "computable.json"));

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.finalContent).toContain("482100.5");
    expect(outcome.includesForeignFigures).toBe(false);
    expect(store.calls.length).toBeGreaterThanOrEqual(2);
    expect(store.calls.every((call) => call.status === "SUCCESS")).toBe(true);
    expect(store.finalized[0]?.status).toBe("COMPLETED");
  });

  it("never invents figures outside recorded tool outputs (hallucination fixture)", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent(
      { ...BASE_PARAMS, runKey: "k-hallucinate" },
      deps(store, "hallucination-injection.json"),
    );
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.includesForeignFigures).toBe(true);
  });

  it("records an ERROR tool call honestly when a tool cannot compute", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent(
      { ...BASE_PARAMS, runKey: "k-cannot-compute" },
      deps(store, "cannot-compute.json"),
    );
    expect(outcome.status).toBe("COMPLETED");
    const errored = store.calls.find((call) => call.status === "ERROR");
    expect(errored).toBeDefined();
    expect(errored?.toolName).toBe("calculate_metric");
  });

  it("rejects SQL abuse without executing it", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent(
      { ...BASE_PARAMS, runKey: "k-sql-abuse" },
      deps(store, "sql-abuse.json"),
    );
    expect(outcome.status).toBe("COMPLETED");
    const errored = store.calls.filter((call) => call.toolName === "run_readonly_sql");
    expect(errored.length).toBeGreaterThan(0);
    for (const call of errored) {
      expect(call.status).toBe("ERROR");
      expect(call.error).toBeTruthy();
    }
  });

  it("stops safely when the step budget is exhausted and persists gathered calls", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent(
      { ...BASE_PARAMS, runKey: "k-budget" },
      {
        provider: new MockProvider(loadScriptedScenario(resolve(__dirname, "..", "fixtures", "ai", "budget-exceeded.json"))),
        tools: AGENT_TOOL_CATALOG,
        store,
        bounds: { maxSteps: 1, maxToolCalls: 12, maxInputTokens: 100_000, maxOutputTokens: 100_000, timeoutMs: 60_000 },
      },
    );
    expect(outcome.status).toBe("STOPPED");
    expect(store.calls.length).toBeGreaterThan(0);
    expect(store.finalized[0]?.status).toBe("STOPPED");
  });

  it("is idempotent for a repeated runKey", async () => {
    const store = new InMemoryRunStore();
    const first = await runAgent({ ...BASE_PARAMS, runKey: "k-idem" }, deps(store));
    const recordedAfterFirst = store.calls.length;
    expect(recordedAfterFirst).toBeGreaterThan(0);
    const second = await runAgent({ ...BASE_PARAMS, runKey: "k-idem" }, deps(store));
    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe(first.status);
    expect(store.calls.length).toBe(recordedAfterFirst);
  });

  it("fails cleanly when the provider is unavailable", async () => {
    const store = new InMemoryRunStore();
    const outcome = await runAgent(
      { ...BASE_PARAMS, runKey: "k-provider-down" },
      {
        provider: new MockProvider({
          turns: [{ final: { content: "" }, failWith: "provider unavailable" }],
        }),
        tools: AGENT_TOOL_CATALOG,
        store,
        bounds: deps(store).bounds,
      },
    );
    expect(outcome.status).toBe("FAILED");
    expect(store.finalized[0]?.status).toBe("FAILED");
  });

  it("redacts credential-like strings from recorded tool output", async () => {
    mocks.listDatasets.mockResolvedValue([
      { id: "ds-1", name: "Sales sk-secretcredentialvalue", status: "READY", rowCount: 100 },
    ]);
    const store = new InMemoryRunStore();
    await runAgent({ ...BASE_PARAMS, runKey: "k-redact" }, deps(store, "computable.json"));
    const output = store.calls.find((call) => call.toolName === "get_workspace_datasets")?.outputJson;
    expect(output).not.toContain("sk-secretcredentialvalue");
  });
});

describe("simulation explanation adversarial guard (T047)", () => {
  it("a deterministic explanation introduces zero figures outside the recorded result and assumptions", () => {
    const recorded: RecordedToolOutput[] = [
      {
        toolName: "calculate_metric",
        output: JSON.stringify({ value: 1000, unit: "USD" }),
        figures: [{ value: 1000, label: "revenue baseline" }],
      },
      {
        toolName: "simulate_scenario",
        output: JSON.stringify({ currentValue: 1000, projectedValue: 990, changePct: -1, confidence: 0.5 }),
        figures: [
          { value: 1000, label: "current" },
          { value: 990, label: "projected" },
          { value: -1, label: "change %" },
          { value: 0.5, label: "confidence" },
        ],
      },
    ];

    const content = buildExplanation(
      { name: "Price +10%", type: "PRICE_CHANGE", modelVersion: SIMULATION_MODEL_VERSION },
      { metricKey: "revenue", currentValue: 1000, projectedValue: 990, changePct: -1, confidence: 0.5 },
      [{ key: "elasticity", value: -1 }],
    );

    expect(extractFigures(content).length).toBeGreaterThan(0);
    expect(hasFiguresOutsideToolData(content, recorded)).toBe(false);
  });

  it("flags an explanation that smuggles a figure outside the recorded outputs (adversarial)", () => {
    const recorded: RecordedToolOutput[] = [
      {
        toolName: "calculate_metric",
        output: JSON.stringify({ value: 1000 }),
        figures: [{ value: 1000, label: "revenue" }],
      },
    ];
    const tampered =
      buildExplanation(
        { name: "Price +10%", type: "PRICE_CHANGE", modelVersion: SIMULATION_MODEL_VERSION },
        { metricKey: "revenue", currentValue: 1000, projectedValue: 990, changePct: -1, confidence: 0.5 },
        [],
      ) + " Actual profit exceeded 1,234,567 USD this quarter.";

    expect(hasFiguresOutsideToolData(tampered, recorded)).toBe(true);
  });
});