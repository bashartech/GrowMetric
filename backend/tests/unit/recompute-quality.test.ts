import { describe, expect, it } from "vitest";
import { computeQuality } from "../../src/lib/quality.js";
import { fromStoredDatetime } from "../../scripts/recompute-quality.js";

/**
 * `scripts/recompute-quality.ts` rebuilds rows from the per-type value tables so
 * already-stored data can be re-scored. Datetimes therefore make a round trip:
 * imported text -> DateTime column -> reconstructed text.
 *
 * The reconstruction has to be type-aware. A `TIME` value is persisted pinned
 * to the epoch, so returning the raw ISO string makes `TIME_RE` reject a cell
 * that was perfectly valid on import and flips the report to WARNINGS.
 */
describe("fromStoredDatetime", () => {
  it("renders a DATE column as YYYY-MM-DD", () => {
    expect(fromStoredDatetime(new Date("2024-03-09T00:00:00.000Z"), "DATE")).toBe(
      "2024-03-09",
    );
  });

  it("renders a TIME column as HH:MM:SS, not a full ISO string", () => {
    const rendered = fromStoredDatetime(
      new Date("1970-01-01T09:30:00.000Z"),
      "TIME",
    );
    expect(rendered).toBe("09:30:00");
  });

  it("keeps the full ISO string for TIMESTAMP columns", () => {
    expect(
      fromStoredDatetime(new Date("2026-07-30T21:11:29.520Z"), "TIMESTAMP"),
    ).toBe("2026-07-30T21:11:29.520Z");
  });

  it("falls back to the ISO string for an unknown type", () => {
    expect(fromStoredDatetime(new Date("2024-01-02T03:04:05.000Z"), undefined)).toBe(
      "2024-01-02T03:04:05.000Z",
    );
  });

  it("round-trips every datetime type back to a CLEAN report", () => {
    // The regression: reconstructing TIME as a full ISO string produced
    // 66.67% unparseable dates on an otherwise clean dataset.
    const columns = [
      { name: "start_time", type: "TIME", isNullable: false, mixed: false, sample: [], nullCount: 0 },
      { name: "end_time", type: "TIME", isNullable: false, mixed: false, sample: [], nullCount: 0 },
      { name: "created_at", type: "TIMESTAMP", isNullable: false, mixed: false, sample: [], nullCount: 0 },
      { name: "hired_on", type: "DATE", isNullable: false, mixed: false, sample: [], nullCount: 0 },
    ] as never;

    const stored = [
      { type: "TIME", value: new Date("1970-01-01T09:00:00.000Z") },
      { type: "TIME", value: new Date("1970-01-01T10:00:00.000Z") },
      { type: "TIMESTAMP", value: new Date("2026-07-30T21:11:29.520Z") },
      { type: "DATE", value: new Date("2026-07-30T00:00:00.000Z") },
    ];
    // Second row is shifted by an hour so the pair is not a duplicate --
    // identical rows would trip the duplicate threshold and mask the point.
    const later = [
      { type: "TIME", value: new Date("1970-01-01T11:00:00.000Z") },
      { type: "TIME", value: new Date("1970-01-01T12:00:00.000Z") },
      { type: "TIMESTAMP", value: new Date("2026-07-31T09:00:00.000Z") },
      { type: "DATE", value: new Date("2026-07-31T00:00:00.000Z") },
    ];
    const rows = [stored, later].map((r) =>
      r.map((c) => fromStoredDatetime(c.value, c.type)),
    );

    const quality = computeQuality({ rows, columns });
    expect(quality.invalidDatePct).toBe(0);
    expect(quality.status).toBe("CLEAN");
  });
});