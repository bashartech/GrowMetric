import { describe, expect, it } from "vitest";
import {
  buildSuggestMappingContext,
  parseMappingSuggestionOutput,
  MAPPING_SUGGESTION_MIN_CONFIDENCE,
} from "../../src/lib/agent/mapping-suggest.js";

describe("mapping-suggest", () => {
  it("builds a context that only admits the canonical vocabulary", () => {
    const context = buildSuggestMappingContext("total_amount");
    expect(context.systemPrompt.length).toBeGreaterThan(20);
    expect(context.promptVersion).toBe("mapping-assist-v1");
    expect(context.userPrompt).toContain("revenue");
    expect(context.userPrompt).toContain("order_date");
  });

  it("accepts in-vocabulary candidates with high confidence", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({ semanticKey: "revenue", businessMeaning: "Revenue", confidence: 0.93 }),
    );
    expect(candidates).toEqual([
      { semanticKey: "revenue", businessMeaning: "Revenue", confidence: 0.93 },
    ]);
  });

  it("skips out-of-vocabulary keys safely (FR-012)", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({ semanticKey: "moon_revenue", businessMeaning: "Moon Revenue", confidence: 0.9 }),
    );
    expect(candidates).toEqual([]);
  });

  it("skips low-confidence candidates", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        semanticKey: "revenue",
        businessMeaning: "Revenue",
        confidence: MAPPING_SUGGESTION_MIN_CONFIDENCE - 0.01,
      }),
    );
    expect(candidates).toEqual([]);
  });

  it("tolerates markdown-wrapped JSON", () => {
    const candidates = parseMappingSuggestionOutput(
      '```json\n{"semanticKey":"orders","businessMeaning":"Orders","confidence":0.88}\n```',
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.semanticKey).toBe("orders");
  });

  it("returns empty when output is not JSON at all", () => {
    expect(parseMappingSuggestionOutput("I cannot confidently map this column.")).toEqual([]);
  });

  it("strips duplicate semantic keys and caps candidate count", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        candidates: [
          { semanticKey: "revenue", businessMeaning: "Revenue", confidence: 0.95 },
          { semanticKey: "revenue", businessMeaning: "Revenue again", confidence: 0.9 },
          { semanticKey: "orders", businessMeaning: "Orders", confidence: 0.94 },
          { semanticKey: "quantity", businessMeaning: "Quantity", confidence: 0.91 },
        ],
      }),
    );
    expect(candidates.map((candidate) => candidate.semanticKey)).toEqual([
      "revenue",
      "orders",
    ]);
  });

  it("returns empty when the model reports a null output", () => {
    expect(parseMappingSuggestionOutput("null")).toEqual([]);
  });

  it("skips malformed candidates that lack a business meaning", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        candidates: [
          { semanticKey: "revenue", confidence: 0.94 },
          { semanticKey: "orders", businessMeaning: "Orders", confidence: 0.93 },
        ],
      }),
    );
    expect(candidates.map((candidate) => candidate.semanticKey)).toEqual(["orders"]);
  });

  it("rejects confidence values outside the 0..1 domain", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        candidates: [
          { semanticKey: "revenue", businessMeaning: "Revenue", confidence: 1.5 },
          { semanticKey: "quantity", businessMeaning: "Quantity", confidence: 0.0 },
        ],
      }),
    );
    expect(candidates).toEqual([]);
  });

  it("rejects non-finite confidence values", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        semanticKey: "revenue",
        businessMeaning: "Revenue",
        confidence: "NaN",
      }),
    );
    expect(candidates).toEqual([]);
  });

  it("skips out-of-range candidates but keeps valid ones from the same payload", () => {
    const candidates = parseMappingSuggestionOutput(
      JSON.stringify({
        candidates: [
          { semanticKey: "revenue", businessMeaning: "Revenue", confidence: 1.2 },
          { semanticKey: "orders", businessMeaning: "Orders", confidence: 0.9 },
          { semanticKey: "not_a_key", businessMeaning: "Nope", confidence: 0.9 },
        ],
      }),
    );
    expect(candidates.map((candidate) => candidate.semanticKey)).toEqual(["orders"]);
  });
});