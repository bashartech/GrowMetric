import { describe, expect, it } from "vitest";
import {
  assembleFindings,
  detectShareAnomalies,
  hasCausalClaim,
  runInvestigation,
  type PipelineDataSource,
  type InvestigationScope,
  type InvestigationPeriod,
} from "../../src/modules/investigations/pipeline.js";

const TARGET: InvestigationPeriod = { from: "2026-02-01T00:00:00.000Z", to: "2026-02-09T23:59:59.999Z" };
const BASELINE: InvestigationPeriod = { from: "2026-01-24T00:00:00.000Z", to: "2026-02-01T23:59:59.999Z" };

const SCOPE: InvestigationScope = {
  datasetId: "11111111-1111-1111-1111-111111111111",
  organizationId: "22222222-2222-2222-2222-222222222222",
  workspaceId: "33333333-3333-3333-3333-333333333333",
  metricKey: "revenue",
  metricColumnName: "total",
  dateColumnId: "44444444-4444-4444-4444-444444444444",
  dimensionKeys: ["region"],
  periodTarget: TARGET,
  periodBaseline: BASELINE,
};

class FixedDataSource implements PipelineDataSource {
  constructor(
    private readonly value: number,
    private readonly baselineValue: number,
    private readonly rows: Array<{ group: string; value: number }>,
    private readonly baselineRows: Array<{ group: string; value: number }>,
  ) {}
  async resolveScope() {
    return SCOPE;
  }
  async aggregate(_scope: InvestigationScope, period: InvestigationPeriod) {
    return period === BASELINE ? this.baselineValue : this.value;
  }
  async breakdown(_scope: InvestigationScope, period: InvestigationPeriod) {
    return period === BASELINE ? this.baselineRows : this.rows;
  }
}

async function runWithFixture(value: number, baselineValue: number) {
  const rows = [
    { group: "East", value: 350 },
    { group: "North", value: 250 },
    { group: "West", value: 400 },
  ];
  const baselineRows = [
    { group: "East", value: 200 },
    { group: "North", value: 100 },
    { group: "West", value: 500 },
  ];
  const source = new FixedDataSource(value, baselineValue, rows, baselineRows);
  return runInvestigation(
    {
      datasetId: SCOPE.datasetId,
      topic: "sales revenue",
      periodTarget: null,
      periodBaseline: null,
      organizationId: SCOPE.organizationId,
      workspaceId: SCOPE.workspaceId,
    },
    source,
  );
}

describe("investigation pipeline (T035)", () => {
  it("assembles a MAIN result with metricChange and recorded evidence", async () => {
    const findings = await runWithFixture(1000, 800);

    const main = findings.find((finding) => finding.level === "MAIN");
    expect(main).toBeDefined();
    expect(main?.kind).toBe("DRIVER");
    expect(main?.metricChange).toMatchObject({
      metricKey: "revenue",
      value: 1000,
      baselineValue: 800,
      changePct: 25,
    });
    expect(main?.evidence).toMatchObject({
      datasetId: SCOPE.datasetId,
      metric: "revenue",
    });
    expect(main?.isCausalClaim).toBe(false);
    expect(main?.confidence).toBe(0.85);
  });

  it("ranks supporting contributors by |delta| and labels them non-causal", async () => {
    const findings = await runWithFixture(1000, 800);

    const supporting = findings.filter((finding) => finding.level === "SUPPORTING");
    expect(supporting.length).toBe(3);
    expect(supporting[0]?.kind).toBe("CONTRIBUTOR");
    expect(supporting[0]?.summary).toContain("East");
    for (const entry of supporting) {
      expect(entry.metricChange).not.toBeNull();
      expect(entry.isCausalClaim).toBe(false);
      expect(entry.evidence).toMatchObject({ dimension: "region" });
    }
  });

  it("flags drastic share-shift anomalies as CORRELATION, never causal", async () => {
    const findings = await runWithFixture(1000, 800);

    const correlations = findings.filter((finding) => finding.level === "CORRELATION");
    expect(correlations.length).toBeGreaterThan(0);
    for (const entry of correlations) {
      expect(entry.kind).toBe("ANOMALY");
      expect(entry.metricChange).toBeNull();
      expect(entry.isCausalClaim).toBe(false);
      expect(entry.confidence).toBe(0.5);
      expect(Math.abs(entry.evidence.shiftPct as number)).toBeGreaterThanOrEqual(30);
    }
    expect(hasCausalClaim(findings)).toBe(false);
  });

  it("reports an honest unanswerable MAIN when target context is missing", async () => {
    const findings = await runWithFixture(0, 0);

    const main = findings[0];
    expect(main?.level).toBe("MAIN");
    expect(main?.title).toMatch(/could not be completed/);
    expect(main?.metricChange?.value).toBe(0);
    expect(main?.metricChange?.changePct).toBeNull();
    expect(main?.isCausalClaim).toBe(false);
  });

  it("detectShareAnomalies ignores small shifts and sorts by magnitude", () => {
    const anomalies = detectShareAnomalies(
      "channel",
      [
        { group: "A", value: 60 },
        { group: "B", value: 40 },
        { group: "C", value: 5 },
      ],
      [
        { group: "A", value: 90 },
        { group: "B", value: 10 },
        { group: "C", value: 5 },
      ],
    );

    expect(anomalies.length).toBe(2);
    expect(anomalies[0]?.dimension).toBe("channel");
    expect(anomalies[0]?.group).toBe("B");
    expect(anomalies[0]?.shiftPct).toBeGreaterThan(30);
    expect(anomalies.some((anomaly) => anomaly.group === "C")).toBe(false);
  });

  it("deterministic assembly records exact numbers from comparisons (no invented figures)", async () => {
    const derived = {
      datasetId: SCOPE.datasetId,
      metricKey: "revenue",
      periodTarget: TARGET,
      periodBaseline: BASELINE,
      comparisons: {
        value: 1234.56,
        baselineValue: 1000,
        changePct: 23.456,
      },
      breakdowns: [],
      anomalies: [],
    };

    const [main, ...rest] = assembleFindings(derived);
    expect(main?.level).toBe("MAIN");
    expect(main?.metricChange).toMatchObject({
      value: 1234.56,
      changePct: 23.456,
    });
    expect(main?.summary).toContain("1,234.56");
    expect(rest.length).toBe(0);
  });
});