import { describe, expect, it } from "vitest";
import {
  classifyFiguresFor,
  extractFigures,
  hasFiguresOutsideToolData,
  type RecordedToolOutput,
} from "../../src/lib/agent/evidence.js";
import {
  assembleFindings,
  detectShareAnomalies,
  hasCausalClaim,
  type InvestigationPeriod,
} from "../../src/modules/investigations/pipeline.js";

const recorded: RecordedToolOutput[] = [
  {
    toolName: "calculate_metric",
    output: JSON.stringify({ value: 482100.5, unit: "USD" }),
    figures: [{ value: 482100.5, label: "revenue" }],
  },
  {
    toolName: "compare_periods",
    output: JSON.stringify({ changePct: 8.2 }),
    figures: [
      { value: 8.2, label: "revenue change %" },
      { value: 445750, label: "revenue (previous)" },
    ],
  },
];

describe("evidence", () => {
  it("extracts plain numbers from prose", () => {
    const figures = extractFigures("Revenue grew 8.2% to 482100.5 USD this period.");
    expect(figures.map((figure) => figure.value)).toContain(8.2);
    expect(figures.map((figure) => figure.value)).toContain(482100.5);
  });

  it("normalizes thousands separators", () => {
    const [figure] = extractFigures("Total reached 1,234,567 units.");
    expect(figure?.value).toBe(1234567);
  });

  it("labels CALCULATED when every figure traces to a tool output", () => {
    const { evidenceClass } = classifyFiguresFor(
      "Revenue this period was 482100.5 USD, up 8.2%.",
      recorded,
    );
    expect(evidenceClass).toBe("CALCULATED");
  });

  it("flags figures outside recorded tool data", () => {
    expect(
      hasFiguresOutsideToolData("Profit margin was 42.0% and revenue 482100.5.", recorded),
    ).toBe(true);
    expect(
      hasFiguresOutsideToolData("Revenue was 482100.5 USD, up 8.2%.", recorded),
    ).toBe(false);
  });

  it("does not treat short reference tokens as figures", () => {
    expect(extractFigures("ID 42 matches; version v2 released")).toEqual([]);
  });

  it("classifies share-shift anomalies as CORRELATION, never causal (T036)", () => {
    const anomalies = detectShareAnomalies(
      "region",
      [
        { group: "East", value: 60 },
        { group: "North", value: 40 },
      ],
      [
        { group: "East", value: 90 },
        { group: "North", value: 10 },
      ],
    );

    const torch: InvestigationPeriod = { from: "2026-02-01T00:00:00.000Z", to: "2026-02-09T23:59:59.999Z" };
    const previous: InvestigationPeriod = { from: "2026-01-24T00:00:00.000Z", to: "2026-02-01T23:59:59.999Z" };

    const findings = assembleFindings({
      datasetId: "11111111-1111-1111-1111-111111111111",
      metricKey: "revenue",
      periodTarget: torch,
      periodBaseline: previous,
      comparisons: { value: 100, baselineValue: 100, changePct: 0 },
      breakdowns: [],
      anomalies,
    });

    const correlation = findings.find((finding) => finding.level === "CORRELATION");
    expect(correlation).toBeDefined();
    expect(correlation?.kind).toBe("ANOMALY");
    expect(correlation?.isCausalClaim).toBe(false);
    expect(correlation?.metricChange).toBeNull();
    expect(correlation?.summary).toMatch(/not evidence of cause/i);
    expect(hasCausalClaim(findings)).toBe(false);
  });
});