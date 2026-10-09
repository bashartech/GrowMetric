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
  searchDatasetRows: vi.fn(),
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
  searchDatasetRows: mocks.searchDatasetRows,
}));
vi.mock("../../src/modules/datasets/dataset.service.js", () => ({
  listDatasets: mocks.listDatasets,
  getDatasetRows: mocks.getDatasetRows,
}));

import {
  AGENT_TOOL_CATALOG,
  isApprovedTool,
  toolFor,
} from "../../src/lib/agent/tools.js";

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("agent tool catalog", () => {
  it("exposes exactly the approved 12-tool closed catalog (FR-002)", () => {
    const names = AGENT_TOOL_CATALOG.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
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
        "search_dataset",
      ].sort(),
    );
  });

  it("gates tools by the approved list only", () => {
    expect(isApprovedTool("calculate_metric")).toBe(true);
    expect(isApprovedTool("send_email")).toBe(false);
    expect(isApprovedTool("functions.exec")).toBe(false);
  });

  it("resolves a tool by name", () => {
    expect(toolFor("get_workspace_datasets")?.name).toBe("get_workspace_datasets");
    expect(toolFor("not_there")).toBeNull();
  });
});

describe("get_workspace_datasets", () => {
  it("lists datasets with a sanitized summary", async () => {
    const tool = toolFor("get_workspace_datasets")!;
    const output = await tool.run({}, { organizationId: "org-1", workspaceId: "ws-1" }, () => {});
    expect(output.ok).toBe(true);
    expect(output.content).toEqual({
      datasets: [{ id: "ds-1", name: "Sales", status: "READY", rowCount: 100 }],
    });
  });
});

describe("calculate_metric", () => {
  it("computes a metric and reports its figures for evidence", async () => {
    const tool = toolFor("calculate_metric")!;
    const datasetId = "00000000-0000-0000-0000-000000000001";
    const output = await tool.run(
      { datasetId, metricKey: "revenue" },
      { organizationId: "org-1", workspaceId: "ws-1" },
      () => {},
    );
    expect(output.ok).toBe(true);
    expect(output.figures).toEqual([{ value: 482100.5, label: "REVENUE" }]);
    expect(mocks.computeMetric).toHaveBeenCalledWith(
      { datasetId, metricKind: "REVENUE" },
      "org-1",
      "ws-1",
    );
  });

  it("rejects unknown metric keys", async () => {
    const tool = toolFor("calculate_metric")!;
    await expect(
      tool.run(
        { datasetId: "00000000-0000-0000-0000-000000000001", metricKey: "profit_margin" },
        { organizationId: "org-1", workspaceId: "ws-1" },
        () => {},
      ),
    ).rejects.toThrow();
  });
});

describe("get_dataset_schema", () => {
  it("returns only the current version's columns", async () => {
    const tool = toolFor("get_dataset_schema")!;
    const output = await tool.run(
      { datasetId: "00000000-0000-0000-0000-000000000001" },
      { organizationId: "org-1", workspaceId: "ws-1" },
      () => {},
    );
    expect(output.ok).toBe(true);
    expect(mocks.datasetFindUnique).toHaveBeenCalledWith({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      select: { currentVersionId: true },
    });
    expect(mocks.datasetColumnFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          datasetId: "00000000-0000-0000-0000-000000000001",
          datasetVersionId: "v-1",
        },
      }),
    );
    expect(output.content).toEqual({
      columns: [{ id: "c1", name: "total", type: "DECIMAL", semanticKey: "revenue", businessMeaning: "Revenue" }],
    });
  });
});

describe("search_dataset", () => {
  it("looks up rows by a bound column value and cites evidence", async () => {
    mocks.searchDatasetRows.mockResolvedValue({
      available: true,
      rows: [
        { order_id: "ORD-10056", order_date: "2026-03-05T00:00:00Z", total: 320.75 },
      ],
    });
    const tool = toolFor("search_dataset")!;
    const output = await tool.run(
      {
        datasetId: "00000000-0000-0000-0000-000000000001",
        column: "order_id",
        value: "ORD-10056",
      },
      { organizationId: "org-1", workspaceId: "ws-1" },
      () => {},
    );
    expect(output.ok).toBe(true);
    expect(output.content).toEqual({
      available: true,
      rows: [{ order_id: "ORD-10056", order_date: "2026-03-05T00:00:00Z", total: 320.75 }],
    });
    expect(mocks.searchDatasetRows).toHaveBeenCalledWith(
      {
        datasetId: "00000000-0000-0000-0000-000000000001",
        column: "order_id",
        value: "ORD-10056",
      },
      "org-1",
      "ws-1",
    );
  });
});