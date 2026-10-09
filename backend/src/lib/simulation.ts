import type { SimulationType } from "@prisma/client";

export const SIMULATION_MODEL_VERSION = "simulation-v1";

export type ScenarioOutcome =
  | { status: "COMPLETED"; metricKey: string; currentValue: number; projectedValue: number; changePct: number; confidence: number; isEstimate: boolean; steps: Array<{ metricKey: string; currentValue: number; projectedValue: number; changePct: number; confidence: number }> }
  | { status: "INSUFFICIENT_DATA"; metricKey: string; reason: string }
  | { status: "FAILED"; metricKey: string; reason: string };

export interface SimulationInput {
  type: SimulationType;
  metricKey: string;
  /** Baseline figure for the target metric (must come from the dataset, never invented). */
  currentValue: number | null;
  /** Assumption inputs already aggregated from the dataset (aggregations, counts, calendar). */
  assumptions: Record<string, number>;
  parameters: Record<string, number>;
}

export interface SensitivityAlternative {
  param: string;
  projectedValue: number;
  changePct: number;
  confidence: number;
}

export interface InsufficientAlternative {
  title: string;
  reason: string;
  suggestion: string;
}

/** Parameter keys a scenario type needs before the model can project (source of truth = lib math). */
export function requiredParametersFor(type: SimulationType): string[] {
  return modelMath(type).requiredParams;
}

/** Honest stand-in produced when history is too sparse to project — never invents figures. */
export function insufficientAlternative(metricKey: string, reason: string): InsufficientAlternative {
  return {
    title: `Insufficient data to model ${metricKey}`,
    reason,
    suggestion:
      "Provide an explicit baseline (for example a CUSTOM assumption) or connect a dataset with enough history so the model can project.",
  };
}

/**
 * Deterministic explanation for a scenario, built ONLY from recorded figures
 * (result values) and recorded assumptions — by construction introduces no new
 * numbers (FR-020/SC-005). `result` must be a COMPLETED scenario outcome.
 */
export function buildExplanation(
  scenario: { name: string; type: SimulationType; modelVersion: string },
  result: { metricKey: string; currentValue: number; projectedValue: number; changePct: number; confidence: number },
  assumptions: Array<{ key: string; value: number }>,
): string {
  const assumed = assumptions.map((entry) => `${entry.key} = ${entry.value}`).join(", ");
  const suffix = assumed ? ` using ${assumed}` : "";
  return (
    `Scenario "${scenario.name}" (${scenario.type.toLowerCase().replace("_", " ")})` +
    ` with ${scenario.modelVersion} projects ${result.metricKey} from ${result.currentValue} to ${result.projectedValue}` +
    ` (a ${result.changePct}% change) with ${result.confidence} confidence.` +
    " Projection is an estimate, not a guarantee." +
    (suffix ? ` Assumption order: ${suffix}.` : "")
  );
}

export function simulateScenario(input: SimulationInput): ScenarioOutcome {
  if (input.currentValue === null || !Number.isFinite(input.currentValue)) {
    return disqualified(input.metricKey, "No baseline value is available for the target metric.");
  }
  if (input.currentValue <= 0) {
    return disqualified(input.metricKey, "Baseline value must be positive to project a change.");
  }

  const math = modelMath(input.type);
  const required = math.requiredParams;
  for (const key of required) {
    const value = input.parameters[key];
    if (value === undefined || !Number.isFinite(value)) {
      return disqualified(
        input.metricKey,
        `Parameter "${key}" is missing for the ${input.type.toLowerCase().replace("_", " ")} model.`,
      );
    }
  }

  const projectedValue = math.compute(input);
  if (!Number.isFinite(projectedValue) || projectedValue < 0) {
    return disqualified(input.metricKey, "Model produced an invalid projection.");
  }

  const changePct = projectedValue === input.currentValue ? 0 : ((projectedValue - input.currentValue) / input.currentValue) * 100;
  const confidence = math.confidence(input);

  return {
    status: "COMPLETED",
    metricKey: input.metricKey,
    currentValue: round(input.currentValue),
    projectedValue: round(projectedValue),
    changePct: round(changePct),
    confidence: round(confidence),
    isEstimate: true,
    steps: [{ metricKey: input.metricKey, currentValue: round(input.currentValue), projectedValue: round(projectedValue), changePct: round(changePct), confidence: round(confidence) }],
  };
}

export function sensitivityAlternative(
  input: SimulationInput,
  param: string,
  override: number,
): SensitivityAlternative | null {
  const base = simulateScenario(input);
  if (base.status !== "COMPLETED") return null;
  const varied: SimulationInput = {
    ...input,
    parameters: { ...input.parameters, [param]: override },
  };
  const alt = simulateScenario(varied);
  if (alt.status !== "COMPLETED") return null;
  return {
    param,
    projectedValue: alt.projectedValue,
    changePct: alt.changePct,
    confidence: alt.confidence,
  };
}

export function simulateWithSensitivity(
  input: SimulationInput,
  alternatives: Array<{ param: string; value: number }>,
): { outcome: ScenarioOutcome; alternatives: SensitivityAlternative[] } {
  const outcome = simulateScenario(input);
  const alts = outcome.status === "COMPLETED"
    ? alternatives.map((alt) => sensitivityAlternative(input, alt.param, alt.value)).filter((x): x is SensitivityAlternative => x !== null)
    : [];
  return { outcome, alternatives: alts };
}

function disqualified(metricKey: string, reason: string): ScenarioOutcome {
  return { status: "INSUFFICIENT_DATA", metricKey, reason };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface ModelMath {
  requiredParams: string[];
  compute: (input: SimulationInput) => number;
  confidence: (input: SimulationInput) => number;
}

function modelMath(type: SimulationType): ModelMath {
  switch (type) {
    case "PRICE_CHANGE":
      return priceChangeMath;
    case "MARKETING_SPEND":
      return marketingSpendMath;
    case "EXPENSE_REDUCTION":
      return expenseReductionMath;
    case "INVENTORY_CHANGE":
      return inventoryMath;
    case "CUSTOM":
      return customAssumptionsMath;
  }
}

/** Revenue baseline scaled by elasticity, defaulting to -1.0 (unit elasticity) when nothing is recorded. */
const priceChangeMath: ModelMath = {
  requiredParams: ["priceChangePct"],
  compute: (input) =>
    applyElasticity(
      input.currentValue!,
      input.parameters.priceChangePct!,
      input.assumptions.elasticity ?? input.parameters.elasticity ?? -1.0,
    ),
  confidence: () => 0.5,
};

/** Marketing spend contribution via a saturating response: delta = baseline * k * spendPct / (k + spendPct). */
const marketingSpendMath: ModelMath = {
  requiredParams: ["spendChangePct", "k"],
  compute: (input) => {
    const base = input.currentValue!;
    const spendPct = input.parameters.spendChangePct!;
    const k = input.parameters.k! > 0 ? input.parameters.k! : 0.3;
    const effect = (k * spendPct) / (k + Math.abs(spendPct));
    return base * (1 + effect);
  },
  confidence: () => 0.6,
};

/** Expense reduction flows to profit one-for-one within the margin share (assumptions.marginShare default 0.25). */
const expenseReductionMath: ModelMath = {
  requiredParams: ["expenseReductionPct"],
  compute: (input) => {
    const base = input.currentValue!;
    const marginShare = input.assumptions.marginShare ?? 0.25;
    const capped = Math.min(input.parameters.expenseReductionPct!, 100);
    return base * (1 + (capped / 100) * marginShare);
  },
  confidence: () => 0.55,
};

/** Inventory run-rate: projected value = baseline adjusted by stockChangePct while honoring runOutOf within horizon days. */
const inventoryMath: ModelMath = {
  requiredParams: ["stockChangePct", "days"],
  compute: (input) => {
    const base = input.currentValue!;
    const stockChangePct = input.parameters.stockChangePct!;
    const days = input.parameters.days! > 0 ? input.parameters.days! : 30;
    const dailyUsage = input.assumptions.dailyUsage ?? base / 30;
    const runRate = dailyUsage * days;
    const horizonAvailable = base * (1 + stockChangePct / 100);
    if (horizonAvailable < runRate) {
      return stockChangePct < 0 ? 0 : horizonAvailable;
    }
    return horizonAvailable;
  },
  confidence: () => 0.45,
};

/** Custom assumptions: projected = baseline * (1 + assumptions.pctChange / 100) from user-supplied figures. */
const customAssumptionsMath: ModelMath = {
  requiredParams: [],
  compute: (input) => {
    const pct = input.assumptions.pctChange ?? input.parameters.pctChange ?? 0;
    return input.currentValue! * (1 + pct / 100);
  },
  confidence: () => 0.7,
};

/** Unit-elastic revenue response to a price change (elasticity defaults to -1.0):
 * %ΔQ = elasticity × %ΔP, so R' = R × (1+δ) × (1+elasticity×δ). */
function applyElasticity(base: number, changePct: number, elasticity: number): number {
  const delta = changePct / 100;
  const qtyFactor = 1 + elasticity * delta;
  if (qtyFactor < 0) return 0;
  return base * (1 + delta) * qtyFactor;
}