import { describe, expect, it } from "vitest";
import {
  evaluateUsageLimit,
  resolveFeatureKey,
} from "../../src/modules/entitlements/entitlement.service.js";

describe("resolveFeatureKey", () => {
  it("maps usage metric names to plan feature keys", () => {
    expect(resolveFeatureKey("ai_investigations")).toBe("aiInvestigations");
    expect(resolveFeatureKey("anomaly_detection")).toBe("anomalyDetection");
  });

  it("passes through unknown metrics unchanged", () => {
    expect(resolveFeatureKey("custom_metric")).toBe("custom_metric");
  });
});

describe("evaluateUsageLimit", () => {
  it("allows usage within a numeric limit", () => {
    const result = evaluateUsageLimit({ aiInvestigations: 5 }, "ai_investigations", 3, 1);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5);
  });

  it("blocks usage that would exceed a numeric limit", () => {
    const result = evaluateUsageLimit({ aiInvestigations: 5 }, "ai_investigations", 5, 1);
    expect(result.allowed).toBe(false);
  });

  it("treats a negative limit as unlimited", () => {
    const result = evaluateUsageLimit({ aiInvestigations: -1 }, "ai_investigations", 9999, 1);
    expect(result.allowed).toBe(true);
  });

  it("honours boolean feature flags", () => {
    expect(evaluateUsageLimit({ reports: false }, "reports", 0, 1).allowed).toBe(
      false,
    );
    expect(evaluateUsageLimit({ reports: true }, "reports", 0, 1).allowed).toBe(
      true,
    );
  });

  it("allows metrics with no configured limit", () => {
    expect(evaluateUsageLimit({}, "unknown", 0, 1).allowed).toBe(true);
  });
});
