import { describe, expect, it } from "vitest";
import { isAutoApplicable, mapColumns } from "../../src/lib/mapping-rules.js";

describe("mapColumns", () => {
  it("maps revenue column with high confidence", () => {
    const headers = ["total_revenue", "orders", "date"];
    const types = ["DECIMAL", "INTEGER", "DATE"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("revenue");
    expect(mappings[0]?.best?.confidence).toBeGreaterThan(0.9);
    expect(mappings[0]?.requiresConfirmation).toBe(false);
  });

  it("maps orders column with high confidence", () => {
    const headers = ["order_count", "revenue", "date"];
    const types = ["INTEGER", "DECIMAL", "DATE"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("orders");
    expect(mappings[0]?.best?.confidence).toBeGreaterThan(0.9);
  });

  it("maps customer-related columns", () => {
    const headers = ["customer_name", "customer_id"];
    const types = ["TEXT", "INTEGER"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("customers");
    expect(mappings[1]?.best?.semanticKey).toBe("customers");
  });

  it("maps product columns", () => {
    const headers = ["product_name", "sku"];
    const types = ["TEXT", "TEXT"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("products");
    expect(mappings[1]?.best?.semanticKey).toBe("products");
  });

  it("maps expense columns", () => {
    const headers = ["total_expenses", "cost"];
    const types = ["DECIMAL", "DECIMAL"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("expenses");
  });

  it("maps inventory columns", () => {
    const headers = ["stock_level", "quantity_on_hand"];
    const types = ["INTEGER", "INTEGER"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("inventory");
  });

  it("maps date columns", () => {
    const headers = ["order_date", "purchase_date"];
    const types = ["DATE", "DATE"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("order_date");
    expect(mappings[1]?.best?.semanticKey).toBe("order_date");
  });

  it("maps region/category columns", () => {
    const headers = ["region", "category", "product_category"];
    const types = ["TEXT", "TEXT", "TEXT"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("region");
    expect(mappings[1]?.best?.semanticKey).toBe("category");
    expect(mappings[2]?.best?.semanticKey).toBe("category");
  });

  it("requires confirmation when confidence is low", () => {
    const headers = ["amt", "count"];
    const types = ["DECIMAL", "INTEGER"];

    const mappings = mapColumns(headers, types);

    // "amt" could be revenue or expenses
    const amtMapping = mappings[0];
    if (amtMapping && amtMapping.candidates.length > 1) {
      expect(amtMapping.requiresConfirmation).toBe(true);
    }
  });

  it("provides multiple candidates for ambiguous columns", () => {
    const headers = ["total"];
    const types = ["DECIMAL"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.candidates.length).toBeGreaterThan(0);
  });

  it("handles columns with no semantic match", () => {
    const headers = ["random_column", "xyz_123"];
    const types = ["TEXT", "TEXT"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best).toBeNull();
    expect(mappings[0]?.requiresConfirmation).toBe(false);
  });

  it("is case-insensitive", () => {
    const headers = ["REVENUE", "Revenue", "revenue"];
    const types = ["DECIMAL", "DECIMAL", "DECIMAL"];

    const mappings = mapColumns(headers, types);

    expect(mappings[0]?.best?.semanticKey).toBe("revenue");
    expect(mappings[1]?.best?.semanticKey).toBe("revenue");
    expect(mappings[2]?.best?.semanticKey).toBe("revenue");
  });

  it("handles empty headers array", () => {
    const mappings = mapColumns([], []);
    expect(mappings).toEqual([]);
  });
});

describe("mapping candidates and confidence (US3)", () => {
  it("emits ordered candidates with confidence for an ambiguous column", () => {
    const mappings = mapColumns(["customer_revenue"], ["DECIMAL"]);
    const mapping = mappings[0]!;

    expect(mapping.candidates.length).toBeGreaterThanOrEqual(2);
    expect(mapping.candidates.map((c) => c.semanticKey)).toEqual(
      expect.arrayContaining(["revenue", "customers"]),
    );
    for (const candidate of mapping.candidates) {
      expect(candidate).toHaveProperty("semanticKey");
      expect(candidate).toHaveProperty("businessMeaning");
      expect(typeof candidate.confidence).toBe("number");
      expect(candidate.confidence).toBeGreaterThan(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);
    }
    // Best candidate is the highest-confidence one and the list is sorted desc.
    const confidences = mapping.candidates.map((c) => c.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    expect(mapping.best?.confidence).toBe(Math.max(...confidences));
  });

  it("flags ambiguous columns for confirmation when best confidence is below threshold", () => {
    const mappings = mapColumns(["customer_revenue"], ["DECIMAL"]);
    const mapping = mappings[0]!;

    expect(mapping.candidates.length).toBeGreaterThan(1);
    expect(mapping.best).not.toBeNull();
    expect(mapping.best!.confidence).toBeLessThan(0.85);
    expect(mapping.requiresConfirmation).toBe(true);
  });

  it("does not flag high-confidence mappings for confirmation", () => {
    const mappings = mapColumns(["total_revenue"], ["DECIMAL"]);
    expect(mappings[0]?.best?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(mappings[0]?.requiresConfirmation).toBe(false);
  });

  it("returns an empty candidate list for unmapped columns", () => {
    const mappings = mapColumns(["some_opaque_value"], ["TEXT"]);
    expect(mappings[0]?.candidates).toEqual([]);
    expect(mappings[0]?.best).toBeNull();
    expect(mappings[0]?.requiresConfirmation).toBe(false);
  });

  it("demotes a numeric semantic key on a non-numeric column", () => {
    // "amount" looks like revenue but the column holds text → confidence demoted.
    const mappings = mapColumns(["amount"], ["TEXT"]);
    expect(mappings[0]?.best?.semanticKey).toBe("revenue");
    expect(mappings[0]?.best?.confidence).toBeLessThanOrEqual(0.8);
  });
});

describe("isAutoApplicable (mapping gating)", () => {
  it("auto-applies exact high-confidence synonyms only", () => {
    const exact = mapColumns(["total_revenue"], ["DECIMAL"]);
    const salesAmount = mapColumns(["total"], ["DECIMAL"]);
    expect(isAutoApplicable(exact[0]!)).toBe(true);
    expect(isAutoApplicable(salesAmount[0]!)).toBe(true);
  });

  it("keeps low-confidence substring matches unmapped (name -> customers)", () => {
    const name = mapColumns(["name"], ["TEXT"]);
    expect(name[0]?.best?.semanticKey).toBe("customers");
    expect(isAutoApplicable(name[0]!)).toBe(false);
  });

  it("keeps low-confidence substring matches unmapped (total_jobs -> revenue)", () => {
    const totalJobs = mapColumns(["total_jobs"], ["INTEGER"]);
    expect(totalJobs[0]?.best?.semanticKey).toBe("revenue");
    expect(isAutoApplicable(totalJobs[0]!)).toBe(false);
  });

  it("keeps type-conflict exact synonyms unmapped (text revenue column)", () => {
    const textRevenue = mapColumns(["revenue"], ["TEXT"]);
    expect(textRevenue[0]?.best?.semanticKey).toBe("revenue");
    expect(isAutoApplicable(textRevenue[0]!)).toBe(false);
  });
});
