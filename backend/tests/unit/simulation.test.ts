import { describe, expect, it } from "vitest";
import {
  buildExplanation,
  insufficientAlternative,
  requiredParametersFor,
  simulateScenario,
  simulateWithSensitivity,
  SIMULATION_MODEL_VERSION,
} from "../../src/lib/simulation.js";

describe("simulation math goldens", () => {
  it("PRICE_CHANGE with unit elasticity keeps revenue near-invariant for small changes", () => {
    const outcome = simulateScenario({
      type: "PRICE_CHANGE",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: {},
      parameters: { priceChangePct: 10 },
    });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.projectedValue).toBe(990);
      expect(outcome.changePct).toBe(-1);
    }
  });

  it("MARKETING_SPEND saturates: doubling spend less than doubles the effect", () => {
    const small = simulateScenario({
      type: "MARKETING_SPEND",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: {},
      parameters: { spendChangePct: 50, k: 0.3 },
    });
    const large = simulateScenario({
      type: "MARKETING_SPEND",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: {},
      parameters: { spendChangePct: 100, k: 0.3 },
    });
    if (small.status === "COMPLETED" && large.status === "COMPLETED") {
      expect(large.projectedValue).toBeLessThan(1000 * (1 + 2 * (small.projectedValue / 1000 - 1)));
    }
  });

  it("EXPENSE_REDUCTION flows to profit by the margin share", () => {
    const outcome = simulateScenario({
      type: "EXPENSE_REDUCTION",
      metricKey: "profit",
      currentValue: 400,
      assumptions: { marginShare: 0.25 },
      parameters: { expenseReductionPct: 20 },
    });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.projectedValue).toBe(420);
    }
  });

  it("INVENTORY_CHANGE applies the stock change within the horizon", () => {
    const outcome = simulateScenario({
      type: "INVENTORY_CHANGE",
      metricKey: "inventory",
      currentValue: 500,
      assumptions: { dailyUsage: 10 },
      parameters: { stockChangePct: 10, days: 30 },
    });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.projectedValue).toBe(550);
    }
  });

  it("CUSTOM applies a user-supplied assumption as the projection", () => {
    const outcome = simulateScenario({
      type: "CUSTOM",
      metricKey: "revenue",
      currentValue: 2000,
      assumptions: { pctChange: 5 },
      parameters: {},
    });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status === "COMPLETED") {
      expect(outcome.projectedValue).toBe(2100);
    }
  });
});

describe("simulation sufficiency gate", () => {
  it("disqualifies when there is no baseline value", () => {
    const outcome = simulateScenario({
      type: "PRICE_CHANGE",
      metricKey: "revenue",
      currentValue: null,
      assumptions: {},
      parameters: { priceChangePct: 10 },
    });
    expect(outcome.status).toBe("INSUFFICIENT_DATA");
  });

  it("disqualifies when a required parameter is missing", () => {
    const outcome = simulateScenario({
      type: "MARKETING_SPEND",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: {},
      parameters: { spendChangePct: 50 },
    });
    expect(outcome.status).toBe("INSUFFICIENT_DATA");
  });

  it("produces sensitivity alternatives alongside the base outcome", () => {
    const { outcome, alternatives } = simulateWithSensitivity(
      {
        type: "PRICE_CHANGE",
        metricKey: "revenue",
        currentValue: 1000,
        assumptions: {},
        parameters: { priceChangePct: 10 },
      },
      [{ param: "priceChangePct", value: 20 }],
    );
    expect(outcome.status).toBe("COMPLETED");
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]?.param).toBe("priceChangePct");
  });

  it("asserts the golden model version constant", () => {
    expect(SIMULATION_MODEL_VERSION).toBe("simulation-v1");
  });
});

describe("simulation sufficiency gate contract (T046)", () => {
  it("requiredParametersFor mirrors exactly what each model needs (SC-005)", () => {
    expect(requiredParametersFor("PRICE_CHANGE")).toEqual(["priceChangePct"]);
    expect(requiredParametersFor("MARKETING_SPEND")).toEqual(["spendChangePct", "k"]);
    expect(requiredParametersFor("EXPENSE_REDUCTION")).toEqual(["expenseReductionPct"]);
    expect(requiredParametersFor("INVENTORY_CHANGE")).toEqual(["stockChangePct", "days"]);
    expect(requiredParametersFor("CUSTOM")).toEqual([]);
  });

  it("sparse input yields INSUFFICIENT_DATA plus an honest sensitivityAlternative with no invented figures", () => {
    const outcome = simulateScenario({
      type: "PRICE_CHANGE",
      metricKey: "revenue",
      currentValue: null,
      assumptions: {},
      parameters: { priceChangePct: 10 },
    });
    expect(outcome.status).toBe("INSUFFICIENT_DATA");
    if (outcome.status === "INSUFFICIENT_DATA") {
      const alternative = insufficientAlternative(outcome.metricKey, outcome.reason);
      expect(alternative.title).toContain("Insufficient data");
      expect(alternative.reason).toBe(outcome.reason);
      expect(alternative.suggestion.length).toBeGreaterThan(0);
    }
  });

  it("elasticity flows through assumptions when the user records it", () => {
    const elastic = simulateScenario({
      type: "PRICE_CHANGE",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: { elasticity: -2 },
      parameters: { priceChangePct: 10 },
    });
    const unit = simulateScenario({
      type: "PRICE_CHANGE",
      metricKey: "revenue",
      currentValue: 1000,
      assumptions: {},
      parameters: { priceChangePct: 10 },
    });
    expect(unit.status).toBe("COMPLETED");
    expect(elastic.status).toBe("COMPLETED");
    if (unit.status === "COMPLETED" && elastic.status === "COMPLETED") {
      expect(elastic.projectedValue).toBeLessThan(unit.projectedValue);
    }
  });
});

describe("simulation explanation figures guard (SC-005)", () => {
  it("buildExplanation only ever restates numbers from the recorded result and assumptions", () => {
    const content = buildExplanation(
      { name: "Price +10%", type: "PRICE_CHANGE", modelVersion: SIMULATION_MODEL_VERSION },
      { metricKey: "revenue", currentValue: 1000, projectedValue: 990, changePct: -1, confidence: 0.5 },
      [{ key: "elasticity", value: -1 }],
    );
    expect(content).toContain("1000");
    expect(content).toContain("990");
    expect(content).toContain("estimate");
  });
});