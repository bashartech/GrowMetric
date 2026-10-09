import { describe, expect, it } from "vitest";
import { computeQuality } from "../../src/lib/quality.js";
import type { ColumnProfile } from "../../src/lib/infer.js";

describe("computeQuality", () => {
  it("computes metrics for clean data", () => {
    const columns: ColumnProfile[] = [
      { name: "id", type: "INTEGER", isNullable: false, mixed: false, sample: ["1", "2", "3"], nullCount: 0 },
      { name: "name", type: "TEXT", isNullable: false, mixed: false, sample: ["Alice", "Bob", "Carol"], nullCount: 0 },
    ];
    const rows = [
      ["1", "Alice"],
      ["2", "Bob"],
      ["3", "Carol"],
    ];

    const quality = computeQuality({ columns, rows });

    expect(quality.totalRows).toBe(3);
    expect(quality.columnCount).toBe(2);
    expect(quality.missingValuePct).toBe(0);
    expect(quality.duplicateRowPct).toBe(0);
    expect(quality.status).toBe("CLEAN");
    expect(quality.warnings).toEqual([]);
  });

  it("detects missing values", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: ["1", "", "3"], nullCount: 2 },
    ];
    // Rows are unique and the table clears the minimum-row floor, so the only
    // signal here is the missing cells. A repeated blank used to make this
    // pass through the duplicate gate instead, which hid the gate under test.
    const rows = [["1"], [""], ["3"], ["5"], ["7"], ["9"], ["11"], ["13"], ["15"], ["17"], ["19"], ["21"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.missingValuePct).toBe(8.33);
    expect(quality.duplicateRowPct).toBe(0);
    expect(quality.status).toBe("WARNINGS");
    expect(quality.warnings).toContainEqual(
      expect.objectContaining({
        column: "value",
        messages: expect.arrayContaining([expect.stringMatching(/empty cells/i)]),
      }),
    );
  });

  it("does not let missing cells downgrade a table below the row floor", () => {
    // One blank in a 4-row table is 25%, which described the sample size rather
    // than the data. The percentage is still reported; it just cannot gate.
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: ["1", "", "3"], nullCount: 1 },
    ];
    const rows = [["1"], [""], ["3"], ["5"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.missingValuePct).toBe(25);
    expect(quality.status).toBe("CLEAN");
    // The gap is still surfaced, not swallowed.
    expect(quality.warnings).toContainEqual(
      expect.objectContaining({
        column: "value",
        messages: expect.arrayContaining([expect.stringMatching(/empty cells/i)]),
      }),
    );
  });

  it("applies the missing-cell gate exactly at the row floor", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: [], nullCount: 0 },
    ];
    // One blank against otherwise unique, valid integers, so the missing gate is
    // the only signal. Repeated blanks would duplicate each other and let the
    // duplicate gate decide the verdict instead.
    const build = (count: number) =>
      Array.from({ length: count }, (_, i) => [i === 1 ? "" : String(i * 10 + 1)]);

    expect(computeQuality({ columns, rows: build(9) }).status).toBe("CLEAN");
    expect(computeQuality({ columns, rows: build(10) }).status).toBe("WARNINGS");
  });

  it("detects duplicate rows", () => {
    const columns: ColumnProfile[] = [
      { name: "id", type: "INTEGER", isNullable: false, mixed: false, sample: ["1", "2"], nullCount: 0 },
    ];
    const rows = [["1"], ["2"], ["1"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.duplicateRowPct).toBeGreaterThan(0);
    expect(quality.status).toBe("WARNINGS");
  });

  it("detects invalid numbers in numeric columns", () => {
    const columns: ColumnProfile[] = [
      { name: "amount", type: "DECIMAL", isNullable: false, mixed: false, sample: ["1.5", "abc", "3.0"], nullCount: 0 },
    ];
    const rows = [["1.5"], ["abc"], ["3.0"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.invalidNumberPct).toBeGreaterThan(0);
    expect(quality.status).toBe("WARNINGS");
  });

  it("detects invalid dates in date columns", () => {
    const columns: ColumnProfile[] = [
      { name: "date", type: "DATE", isNullable: false, mixed: false, sample: ["2024-01-15", "not-a-date"], nullCount: 0 },
    ];
    const rows = [["2024-01-15"], ["not-a-date"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.invalidDatePct).toBeGreaterThan(0);
    expect(quality.status).toBe("WARNINGS");
  });

  /**
   * Outliers are now report-only. A single large value is legitimate business
   * data (a bulk order, a promotional spike), so it must still be counted and
   * surfaced but must no longer downgrade the dataset.
   */
  it("counts numeric outliers but does not downgrade the dataset", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: false, mixed: false, sample: [], nullCount: 0 },
    ];
    // All distinct and fully populated, so the outlier is the only signal here
    // and the assertion isolates it from the duplicate/missing thresholds.
    const rows = [["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["1000"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.numericOutlierCount).toBeGreaterThan(0);
    expect(quality.status).toBe("CLEAN");
    // Still visible, so the signal is not silently lost.
    expect(quality.warnings).toContainEqual(
      expect.objectContaining({
        column: "value",
        messages: expect.arrayContaining([expect.stringMatching(/outlier/i)]),
      }),
    );
  });

  /**
   * Regression for the pooled-IQR defect. Both columns are internally uniform,
   * so neither has an outlier on its own terms. The old implementation pushed
   * every numeric value into one array, which put the low fence above the entire
   * `quantity` column and flagged every row of it.
   */
  it("computes outliers per column instead of pooling unrelated scales", () => {
    const columns: ColumnProfile[] = [
      { name: "quantity", type: "INTEGER", isNullable: false, mixed: false, sample: [], nullCount: 0 },
      { name: "revenue", type: "DECIMAL", isNullable: false, mixed: false, sample: [], nullCount: 0 },
    ];
    const rows = [
      ["1", "1000"],
      ["2", "1100"],
      ["3", "1200"],
      ["2", "1300"],
      ["1", "1400"],
      ["2", "1500"],
      ["3", "1600"],
    ];

    const quality = computeQuality({ columns, rows });

    expect(quality.numericOutlierCount).toBe(0);
    expect(quality.status).toBe("CLEAN");
  });

  it("still detects a genuine outlier inside a single column", () => {
    const columns: ColumnProfile[] = [
      { name: "amount", type: "DECIMAL", isNullable: false, mixed: false, sample: [], nullCount: 0 },
    ];
    const rows = [
      ["10"],
      ["11"],
      ["12"],
      ["13"],
      ["14"],
      ["15"],
      ["100000"],
    ];

    const quality = computeQuality({ columns, rows });

    expect(quality.numericOutlierCount).toBeGreaterThan(0);
  });

  it("tolerates missing cells below the threshold", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: [], nullCount: 2 },
    ];
    // 2 empty cells out of 200 = 1%, comfortably under the 5% tolerance.
    const rows: string[][] = [];
    for (let i = 0; i < 198; i += 1) rows.push([String(i)]);
    rows.push([""]);
    rows.push([""]);

    const quality = computeQuality({ columns, rows });

    expect(quality.missingValuePct).toBeLessThan(5);
    expect(quality.status).toBe("CLEAN");
  });

  it("flags missing cells above the threshold", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: [], nullCount: 20 },
    ];
    // 20 empty cells out of 100 = 20%, above the 5% tolerance.
    const rows: string[][] = [];
    for (let i = 0; i < 80; i += 1) rows.push([String(i)]);
    for (let i = 0; i < 20; i += 1) rows.push([""]);

    const quality = computeQuality({ columns, rows });

    expect(quality.missingValuePct).toBe(20);
    expect(quality.status).toBe("WARNINGS");
  });

  it("tolerates a nullable column with no empty cells in practice", () => {
    const columns: ColumnProfile[] = [
      { name: "note", type: "TEXT", isNullable: true, mixed: false, sample: [], nullCount: 0 },
      { name: "amount", type: "DECIMAL", isNullable: false, mixed: false, sample: [], nullCount: 0 },
    ];
    const rows = [
      ["ok", "10"],
      ["fine", "20"],
      ["ok", "30"],
    ];

    const quality = computeQuality({ columns, rows });

    // A declared-nullable column used to force WARNINGS on its own, which made
    // READY unreachable for almost every real table.
    expect(quality.status).toBe("CLEAN");
  });

  it("handles empty dataset gracefully", () => {
    const quality = computeQuality({ columns: [], rows: [] });

    expect(quality.totalRows).toBe(0);
    expect(quality.columnCount).toBe(0);
    expect(quality.status).toBe("CLEAN");
  });

  it("flags severely missing data as WARNINGS", () => {
    const columns: ColumnProfile[] = [
      { name: "value", type: "INTEGER", isNullable: true, mixed: false, sample: ["", "", ""], nullCount: 5 },
    ];
    const rows = [[""], [""], [""], [""], [""]];

    const quality = computeQuality({ columns, rows });

    expect(quality.missingValuePct).toBe(100);
    expect(quality.status).toBe("WARNINGS");
    expect(quality.warnings.some((w) => w.column === "value")).toBe(true);
  });

  it("includes per-column entry for every nullable column", () => {
    const columns: ColumnProfile[] = [
      { name: "col1", type: "INTEGER", isNullable: true, mixed: false, sample: ["1", ""], nullCount: 1 },
      { name: "col2", type: "DECIMAL", isNullable: true, mixed: false, sample: ["1.5", ""], nullCount: 1 },
    ];
    const rows = [
      ["1", "1.5"],
      ["", ""],
    ];

    const quality = computeQuality({ columns, rows });

    expect(quality.warnings.length).toBeGreaterThan(0);
    expect(quality.warnings.some((w) => w.column === "col1")).toBe(true);
    expect(quality.warnings.some((w) => w.column === "col2")).toBe(true);
  });

  /**
   * A mixed column is still reported, but it no longer downgrades the dataset.
   * Storing it as TEXT is the correct outcome; it is not a reason to refuse
   * analysis.
   */
  it("reports mixed columns without downgrading the dataset", () => {
    const columns: ColumnProfile[] = [
      { name: "notes", type: "TEXT", isNullable: false, mixed: true, sample: ["123", "abc"], nullCount: 0 },
    ];
    const rows = [["123"], ["abc"]];

    const quality = computeQuality({ columns, rows });

    expect(quality.status).toBe("CLEAN");
    expect(quality.warnings).toContainEqual(
      expect.objectContaining({
        column: "notes",
        messages: expect.arrayContaining([expect.stringMatching(/mixed/i)]),
      }),
    );
  });
});