"use client";

import { AlertTriangle, FlaskConical, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loading } from "@/components/signals/loading";
import type { ScenarioDetailDTO } from "@/lib/types";

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export interface SimulationResultProps {
  scenario: ScenarioDetailDTO;
  onExplain?: (scenarioId: string) => void;
  explaining?: boolean;
}

export function SimulationResult({ scenario, onExplain, explaining }: SimulationResultProps) {
  if (scenario.status === "RUNNING") {
    return (
      <Card className="p-6">
        <Loading label="Projection in progress…" />
      </Card>
    );
  }

  if (scenario.status === "FAILED") {
    return (
      <Card className="p-6" data-testid="simulation-result">
        <div className="rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] p-3 text-sm text-[#F87171]">
          {scenario.error ?? "The scenario failed."}
        </div>
      </Card>
    );
  }

  if (scenario.status === "INSUFFICIENT_DATA") {
    return (
      <Card className="p-6" data-testid="simulation-result">
        <div data-testid="sensitivity-alternative" className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#FDE047]" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-[#FDE047]">
              {scenario.sensitivityAlternative?.title ?? "Insufficient data"}
            </p>
            <p className="text-[#FDE047]">
              {scenario.sensitivityAlternative?.reason ?? scenario.error}
            </p>
            {scenario.sensitivityAlternative?.suggestion ? (
              <p className="text-[#FDE047]">{scenario.sensitivityAlternative.suggestion}</p>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  const results = scenario.results ?? [];
  return (
    <Card className="p-6 space-y-4" data-testid="simulation-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="font-semibold">{scenario.name}</h3>
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium">
            {scenario.type}
          </span>
        </div>
        <span
          data-testid="simulation-estimate-badge"
          className="rounded-full border border-[rgba(250,204,21,0.4)] bg-[rgba(250,204,21,0.14)] px-2 py-0.5 text-xs font-medium text-[#FDE047]"
        >
          Estimate
        </span>
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This scenario completed but produced no projection figures.
        </p>
      ) : (
        <ul className="space-y-2">
          {results.map((result) => {
            const rising = result.changePct >= 0;
            return (
              <li
                key={`${result.metricKey}-${result.projectedValue}`}
                data-testid="simulation-result-row"
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border p-3 text-sm"
              >
                <span className="font-medium capitalize">{result.metricKey}</span>
                <span className="text-muted-foreground">{formatNumber(result.currentValue)}</span>
                {rising ? (
                  <TrendingUp className="h-4 w-4 text-[#4ADE80]" aria-hidden />
                ) : (
                  <TrendingDown className="h-4 w-4 text-[#F87171]" aria-hidden />
                )}
                <span className="font-semibold">{formatNumber(result.projectedValue)}</span>
                <span
                  className={
                    rising ? "text-[#4ADE80]" : "text-[#F87171]"
                  }
                >
                  {result.changePct >= 0 ? "+" : ""}
                  {formatNumber(result.changePct)}%
                </span>
                {result.confidence !== null ? (
                  <span className="text-xs text-muted-foreground">
                    confidence {Math.round(result.confidence * 100)}%
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {scenario.assumptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {scenario.assumptions.map((assumption) => (
            <span
              key={assumption.key}
              className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground"
            >
              {assumption.key} = {formatNumber(assumption.value)} (user)
            </span>
          ))}
        </div>
      ) : null}

      <div
        data-testid="simulation-disclaimer"
        className="flex items-start gap-2 rounded-md border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.15)] p-3 text-xs text-[#60A5FA]"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{scenario.disclaimer}</span>
      </div>

      {onExplain ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExplain(scenario.id)}
            disabled={explaining}
            data-testid="simulation-explain-button"
          >
            {explaining ? "Building explanation…" : "Explain"}
          </Button>
        </div>
      ) : null}

      {scenario.explanation ? (
        <div
          data-testid="explanation-content"
          className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          {scenario.explanation.content}
        </div>
      ) : null}
    </Card>
  );
}