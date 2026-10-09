import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex } from "../../src/lib/crypto.js";

describe("sha256Hex", () => {
  it("is deterministic", () => {
    expect(sha256Hex("GrowMetrics")).toBe(sha256Hex("GrowMetrics"));
  });

  it("produces a 64 character hex digest", () => {
    expect(sha256Hex("GrowMetrics")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different input", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("randomToken", () => {
  it("is unique across calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
  });

  it("honours the requested byte length", () => {
    expect(randomToken(16).length).toBeGreaterThanOrEqual(16);
  });
});
