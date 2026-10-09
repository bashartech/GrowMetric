"use client";

import type { DatasetDTO, SimulationType } from "@/lib/types";

export const SIMULATION_TYPES: SimulationType[] = [
  "PRICE_CHANGE",
  "MARKETING_SPEND",
  "EXPENSE_REDUCTION",
  "INVENTORY_CHANGE",
  "CUSTOM",
];

const TYPE_LABELS: Record<SimulationType, string> = {
  PRICE_CHANGE: "Price change",
  MARKETING_SPEND: "Marketing spend",
  EXPENSE_REDUCTION: "Expense reduction",
  INVENTORY_CHANGE: "Inventory change",
  CUSTOM: "Custom assumption",
};

const PARAM_FIELDS: Record<SimulationType, Array<{ key: string; label: string; placeholder: string }>> = {
  PRICE_CHANGE: [
    { key: "priceChangePct", label: "Price change (%)", placeholder: "10" },
    { key: "elasticity", label: "Elasticity (optional)", placeholder: "-1.3" },
  ],
  MARKETING_SPEND: [
    { key: "spendChangePct", label: "Spend change (%)", placeholder: "50" },
    { key: "k", label: "Saturation k", placeholder: "0.3" },
  ],
  EXPENSE_REDUCTION: [
    { key: "expenseReductionPct", label: "Reduction (%)", placeholder: "20" },
  ],
  INVENTORY_CHANGE: [
    { key: "stockChangePct", label: "Stock change (%)", placeholder: "10" },
    { key: "days", label: "Horizon (days)", placeholder: "30" },
  ],
  CUSTOM: [{ key: "pctChange", label: "Assumed change (%)", placeholder: "5" }],
};

export interface SimulationFormProps {
  scenarioName: string;
  type: SimulationType;
  parameters: Record<string, number>;
  datasets: DatasetDTO[];
  datasetId: string | null;
  onScenarioNameChange: (value: string) => void;
  onTypeChange: (value: SimulationType) => void;
  onParametersChange: (value: Record<string, number>) => void;
  onDatasetIdChange: (value: string) => void;
}

export function SimulationForm({
  scenarioName,
  type,
  parameters,
  datasets,
  datasetId,
  onScenarioNameChange,
  onTypeChange,
  onParametersChange,
  onDatasetIdChange,
}: SimulationFormProps) {
  const updateParam = (key: string, raw: string) => {
    const next: Record<string, number> = { ...parameters };
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onParametersChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1">
          <label htmlFor="sim-name" className="text-sm font-medium">
            Scenario name
          </label>
          <input
            id="sim-name"
            data-testid="simulation-name"
            value={scenarioName}
            onChange={(event) => onScenarioNameChange(event.target.value)}
            placeholder="Price +10%"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sim-type" className="text-sm font-medium">
            Model
          </label>
          <select
            id="sim-type"
            data-testid="simulation-type"
            value={type}
            onChange={(event) => onTypeChange(event.target.value as SimulationType)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {SIMULATION_TYPES.map((simType) => (
              <option key={simType} value={simType}>
                {TYPE_LABELS[simType]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="sim-dataset" className="text-sm font-medium">
          Dataset
        </label>
          <select
            id="sim-dataset"
            data-testid="simulation-dataset"
            value={datasetId ?? ""}
            onChange={(event) => onDatasetIdChange(event.target.value)}
            disabled={datasets.length === 0}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {datasets.length === 0 ? (
              <option value="">No analytics-ready dataset</option>
            ) : (
              <>
                {datasetId === null ? (
                  <option value="">Select a dataset…</option>
                ) : null}
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} · {dataset.rowCount.toLocaleString()} rows
                  </option>
                ))}
              </>
            )}
          </select>
          <p className="text-xs text-muted-foreground">
            {datasets.length === 0
              ? "Import data and wait for a READY dataset before running scenarios — the projection uses your data as the baseline."
              : "The model projects this metric from the selected dataset's current value."}
          </p>
        </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PARAM_FIELDS[type].map((field) => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={`sim-param-${field.key}`} className="text-sm font-medium">
              {field.label}
            </label>
            <input
              id={`sim-param-${field.key}`}
              data-testid={`simulation-param-${field.key}`}
              type="number"
              step="any"
              value={parameters[field.key] ?? ""}
              onChange={(event) => updateParam(field.key, event.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
      </div>
    </div>
  );
}