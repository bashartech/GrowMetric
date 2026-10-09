export interface BudgetLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface BudgetState {
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
}

export class BudgetExceededError extends Error {
  readonly cancelReason = "STOPPED";

  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export function createBudget(_limits: BudgetLimits): BudgetState {
  return {
    steps: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    startedAt: Date.now(),
  };
}

export function recordStep(budget: BudgetState, limits: BudgetLimits): void {
  budget.steps += 1;
  if (budget.steps > limits.maxSteps) {
    throw new BudgetExceededError("Step budget exceeded.");
  }
}

export function recordToolCall(budget: BudgetState, limits: BudgetLimits): void {
  budget.toolCalls += 1;
  if (budget.toolCalls > limits.maxToolCalls) {
    throw new BudgetExceededError("Tool-call budget exceeded.");
  }
}

export function recordUsage(
  budget: BudgetState,
  limits: BudgetLimits,
  inputTokens: number,
  outputTokens: number,
): void {
  budget.inputTokens += inputTokens;
  budget.outputTokens += outputTokens;
  if (budget.inputTokens + budget.outputTokens > limits.maxInputTokens + limits.maxOutputTokens) {
    throw new BudgetExceededError("Token budget exceeded.");
  }
}

export function assertWithinWallClock(budget: BudgetState, limits: BudgetLimits): void {
  if (Date.now() - budget.startedAt > limits.timeoutMs) {
    throw new BudgetExceededError("Wall-clock budget exceeded.");
  }
}

export function toRunStatus(error: unknown): "FAILED" | "STOPPED" {
  return error instanceof BudgetExceededError ? "STOPPED" : "FAILED";
}