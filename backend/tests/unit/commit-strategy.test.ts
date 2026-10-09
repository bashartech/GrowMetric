import { describe, expect, it } from "vitest";
import { mergeRows } from "../../src/lib/commit-strategy.js";

const prior = [
  { key: "a", label: "A1" },
  { key: "b", label: "B1" },
  { key: null, label: "Unkeyed" },
];

const incoming = [
  { key: "b", label: "B2" },
  { key: "c", label: "C1" },
];

describe("mergeRows", () => {
  it("appends incoming rows to prior rows", () => {
    const result = mergeRows({ prior, incoming, commit: "APPEND" });

    expect(result.added).toBe(2);
    expect(result.replaced).toBe(0);
    expect(result.kept).toBe(3);
    expect(result.rows.length).toBe(5);
    expect(result.rows[0]).toEqual({ key: "a", label: "A1" });
    expect(result.rows[3]).toEqual({ key: "b", label: "B2" });
    expect(result.rows[4]).toEqual({ key: "c", label: "C1" });
  });

  it("replaces the current rows entirely", () => {
    const result = mergeRows({ prior, incoming, commit: "REPLACE" });

    expect(result.rows).toEqual(incoming);
    expect(result.added).toBe(2);
    expect(result.replaced).toBe(3);
    expect(result.kept).toBe(0);
  });

  it("upserts by key: replaces collisions and keeps unique prior rows", () => {
    const result = mergeRows({ prior, incoming, commit: "UPSERT" });

    expect(result.rows).toEqual([
      { key: "b", label: "B2" },
      { key: "c", label: "C1" },
      { key: "a", label: "A1" },
      { key: null, label: "Unkeyed" },
    ]);
    expect(result.added).toBe(2);
    expect(result.replaced).toBe(1);
    expect(result.kept).toBe(2);
  });

  it("keeps unkeyed prior rows on upsert when no key collision", () => {
    const result = mergeRows({
      prior: [{ key: null, label: "X" }],
      incoming: [{ key: "new", label: "N" }],
      commit: "UPSERT",
    });

    expect(result.rows).toEqual([
      { key: "new", label: "N" },
      { key: null, label: "X" },
    ]);
    expect(result.replaced).toBe(0);
    expect(result.kept).toBe(1);
  });

  it("treats empty-string keys as unkeyed", () => {
    const result = mergeRows({
      prior: [{ key: "", label: "Empty" }],
      incoming: [{ key: "1", label: "One" }],
      commit: "UPSERT",
    });

    expect(result.rows).toEqual([
      { key: "1", label: "One" },
      { key: "", label: "Empty" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(mergeRows({ prior: [], incoming: [], commit: "APPEND" }).rows).toEqual([]);
    expect(mergeRows({ prior, incoming: [], commit: "REPLACE" }).rows).toEqual([]);
    expect(mergeRows({ prior: [], incoming, commit: "UPSERT" }).rows).toEqual(incoming);
  });
});