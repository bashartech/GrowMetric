import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  createBudget,
  recordStep,
  recordToolCall,
  recordUsage,
  assertWithinWallClock,
  toRunStatus,
  type BudgetLimits,
} from "../../src/lib/agent/budgets.js";

const limits: BudgetLimits = {
  maxSteps: 3,
  maxToolCalls: 5,
  maxInputTokens: 500,
  maxOutputTokens: 500,
  timeoutMs: 60_000,
};

describe("budgets", () => {
  it("records steps up to the budget then throws STOPPED-safe", () => {
    const budget = createBudget(limits);
    for (let index = 0; index < limits.maxSteps; index++) {
      recordStep(budget, limits);
    }
    expect(() => recordStep(budget, limits)).toThrow(BudgetExceededError);
  });

  it("records tool calls up to the budget then throws STOPPED-safe", () => {
    const budget = createBudget(limits);
    for (let index = 0; index < limits.maxToolCalls; index++) {
      recordToolCall(budget, limits);
    }
    expect(() => recordToolCall(budget, limits)).toThrow(BudgetExceededError);
  });

  it("records combined token usage against the total budget", () => {
    const budget = createBudget(limits);
    recordUsage(budget, limits, 500, 500);
    expect(budget.inputTokens + budget.outputTokens).toBe(1000);
    expect(() => recordUsage(budget, limits, 0, 1)).toThrow(BudgetExceededError);
  });

  it("enforces the wall-clock budget", () => {
    const budget = createBudget(limits);
    budget.startedAt = Date.now() - limits.timeoutMs - 1;
    expect(() => assertWithinWallClock(budget, limits)).toThrow(
      BudgetExceededError,
    );
  });

  it("toRunStatus maps budget errors to STOPPED and provider errors to FAILED", () => {
    expect(toRunStatus(new BudgetExceededError("x"))).toBe("STOPPED");
    expect(toRunStatus(new Error("provider 500"))).toBe("FAILED");
  });
});