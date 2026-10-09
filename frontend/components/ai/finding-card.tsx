"use client";

import { AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import type { FindingLevel, InvestigationFindingDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_META: Record<
  FindingLevel,
  { label: string; className: string }
> = {
  MAIN: { label: "Main", className: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]" },
  SUPPORTING: { label: "Supporting", className: "bg-muted text-muted-foreground" },
  CORRELATION: { label: "Correlation", className: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]" },
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

const formatPct = (value: number): string => `${value.toFixed(1)}%`;

interface FindingCardProps {
  finding: InvestigationFindingDTO;
}

export const FindingCard = ({ finding }: FindingCardProps) => {
  const level = LEVEL_META[finding.level];
  const change = finding.metricChange;
  const isUp = change?.changePct !== null && change?.changePct !== undefined && change.changePct > 0;

  return (
    <article
      className="rounded-lg border border-border bg-card p-4 space-y-2"
      data-testid={`finding-card-${finding.level.toLowerCase()}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            level?.className,
          )}
          data-testid={`finding-level-${finding.level.toLowerCase()}`}
        >
          {level?.label ?? finding.level}
        </span>
        {finding.level === "CORRELATION" ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            data-testid="non-causal-label"
          >
            <AlertCircle className="h-3 w-3" aria-hidden />
            Correlation, not causation
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          confidence {(finding.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <h3 className="text-sm font-semibold">{finding.title}</h3>
      <p className="text-sm text-muted-foreground">{finding.summary}</p>

      {change ? (
        <div className="flex flex-wrap gap-3 text-sm" data-testid="metric-change">
          <span className="inline-flex items-center gap-1 font-medium">
            {isUp ? (
              <TrendingUp className="h-4 w-4 text-[#4ADE80]" aria-hidden />
            ) : (
              <TrendingDown className="h-4 w-4 text-[#F87171]" aria-hidden />
            )}
            {change.value !== null ? formatNumber(change.value) : "—"}
          </span>
          <span className="text-muted-foreground">
            vs {change.baselineValue !== null ? formatNumber(change.baselineValue) : "—"}
          </span>
          {change.changePct !== null ? (
            <span
              className={cn(
                "font-medium",
                isUp ? "text-[#4ADE80]" : "text-[#F87171]",
              )}
            >
              {isUp ? "+" : ""}
              {formatPct(change.changePct)}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {change.periodA} vs {change.periodB}
          </span>
        </div>
      ) : null}

      <div
        className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground space-y-1"
        data-testid="finding-evidence"
      >
        {typeof finding.evidence.calculation === "string" ? (
          <p>{finding.evidence.calculation}</p>
        ) : null}
        {typeof finding.evidence.datasetId === "string" ? (
          <p className="font-mono">dataset {finding.evidence.datasetId}</p>
        ) : null}
        {typeof finding.evidence.dimension === "string" ? (
          <p>dimension: {finding.evidence.dimension}</p>
        ) : null}
      </div>
    </article>
  );
};