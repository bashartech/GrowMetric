import { describe, expect, it } from "vitest";
import { inferColumnType, parseValue, profileColumns } from "../../src/lib/infer.js";

describe("inferColumnType", () => {
  it("infers INTEGER", () => {
    const result = inferColumnType(["1", "2", "100", "999"]);
    expect(result.type).toBe("INTEGER");
  });

  it("infers DECIMAL for decimal values", () => {
    const result = inferColumnType(["1.5", "2.99", "100.01", "0.5"]);
    expect(result.type).toBe("DECIMAL");
  });

  it("infers BOOLEAN when values are yes/no/true/false", () => {
    const result = inferColumnType(["yes", "no", "true", "false", "YES"]);
    expect(result.type).toBe("BOOLEAN");
  });

  it("infers DATE for date-like strings", () => {
    const result = inferColumnType(["2024-01-15", "2024-12-31", "2023-06-01"]);
    expect(result.type).toBe("DATE");
  });

  it("infers TIMESTAMP for datetime strings", () => {
    const result = inferColumnType([
      "2024-01-15 10:30:00",
      "2024-12-31T23:59:59",
    ]);
    expect(result.type).toBe("TIMESTAMP");
  });

  it("falls back to TEXT and flags mixed values below 95% confidence", () => {
    const result = inferColumnType(["123", "456", "abc", "def", "789"]);
    expect(result.type).toBe("TEXT");
    expect(result.mixed).toBe(true);
  });

  it("infers TEXT for plain strings without flagging", () => {
    const result = inferColumnType(["apple", "banana", "cherry"]);
    expect(result.type).toBe("TEXT");
    expect(result.mixed).toBe(false);
  });

  it("handles empty sample array", () => {
    const result = inferColumnType([]);
    expect(result.type).toBe("TEXT");
  });

  it("ignores empty strings during inference", () => {
    const result = inferColumnType(["123", "", "456", "", "789"]);
    expect(result.type).toBe("INTEGER");
  });
});

describe("parseValue", () => {
  it("parses INTEGER correctly", () => {
    const result = parseValue("123", "INTEGER");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(123);
  });

  it("parses DECIMAL correctly", () => {
    const result = parseValue("123.45", "DECIMAL");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(123.45);
  });

  it("parses BOOLEAN true values", () => {
    expect(parseValue("true", "BOOLEAN").value).toBe(true);
    expect(parseValue("yes", "BOOLEAN").value).toBe(true);
    expect(parseValue("1", "BOOLEAN").value).toBe(true);
  });

  it("parses BOOLEAN false values", () => {
    expect(parseValue("false", "BOOLEAN").value).toBe(false);
    expect(parseValue("no", "BOOLEAN").value).toBe(false);
    expect(parseValue("0", "BOOLEAN").value).toBe(false);
  });

  it("parses DATE correctly", () => {
    const result = parseValue("2024-01-15", "DATE");
    expect(result.ok).toBe(true);
    expect(result.value).toBeInstanceOf(Date);
  });

  it("parses TIMESTAMP correctly", () => {
    const result = parseValue("2024-01-15T10:30:00Z", "TIMESTAMP");
    expect(result.ok).toBe(true);
    expect(result.value).toBeInstanceOf(Date);
  });

  it("returns TEXT as-is", () => {
    const result = parseValue("hello world", "TEXT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("hello world");
  });

  it("handles parse failures gracefully", () => {
    const result = parseValue("not-a-number", "INTEGER");
    expect(result.ok).toBe(false);
  });

  it("parses empty strings to null", () => {
    const result = parseValue("", "INTEGER");
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });
});

describe("profileColumns", () => {
  it("profiles columns from rows", () => {
    const headers = ["id", "name", "price"];
    const rows = [
      ["1", "Apple", "1.99"],
      ["2", "Banana", "0.99"],
      ["3", "Cherry", "2.49"],
    ];

    const profiles = profileColumns(headers, rows);

    expect(profiles).toHaveLength(3);
    expect(profiles[0]?.name).toBe("id");
    expect(profiles[0]?.type).toBe("INTEGER");
    expect(profiles[1]?.name).toBe("name");
    expect(profiles[1]?.type).toBe("TEXT");
    expect(profiles[2]?.name).toBe("price");
    expect(profiles[2]?.type).toBe("DECIMAL");
  });

  it("exposes nullCount and mixed flags", () => {
    const profiles = profileColumns(["id"], [["1"], [""], ["3"]]);
    expect(profiles[0]?.nullCount).toBe(1);
    expect(profiles[0]?.isNullable).toBe(true);
  });

  it("detects nullable columns", () => {
    const profiles = profileColumns(["value"], [["123"], [""], ["456"]]);
    expect(profiles[0]?.isNullable).toBe(true);
  });

  it("samples up to 200 rows for inference", () => {
    const rows = Array.from({ length: 500 }, (_, i) => [String(i)]);
    const profiles = profileColumns(["num"], rows);

    expect(profiles[0]?.type).toBe("INTEGER");
    expect(profiles[0]?.sample).toBeDefined();
  });

  it("handles empty column names gracefully", () => {
    const headers = ["", "name"];
    const rows = [["1", "test"]];

    const profiles = profileColumns(headers, rows);

    expect(profiles[0]?.name).toMatch(/^column_\d+$/);
    expect(profiles[1]?.name).toBe("name");
  });
});