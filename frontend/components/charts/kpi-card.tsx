"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardWidgetDataDTO } from "@/lib/types";
import { formatChange, formatValue } from "./format";
import { Sparkline, type SparklineTone } from "./sparkline";
import { useCountUp } from "./use-count-up";

interface KPICardProps {
  data: DashboardWidgetDataDTO["data"];
  title: string;
  className?: string;
}

const toneForChange = (
  change: number | null | undefined,
  available: boolean | undefined,
): SparklineTone => {
  if (!available || change === null || change === undefined) return "neutral";
  if (change > 0) return "positive";
  if (change < 0) return "negative";
  return "neutral";
};

export const KPICard = ({ data, title, className }: KPICardProps) => {
  const { available, value, unit, change, changePct, changeAvailable, spark } =
    data;
  const hasChange =
    changeAvailable &&
    change !== null &&
    change !== undefined &&
    changePct !== null &&
    changePct !== undefined;

  const animatedValue = useCountUp(
    available && typeof value === "number" ? value : 0,
  );
  const displayValue = available
    ? formatValue(
        typeof value === "number" ? animatedValue : value,
        unit,
      )
    : "—";

  const tone = toneForChange(change, hasChange);

  return (
    <Card
      className={cn(
        "group relative overflow-hidden p-5 transition-colors hover:border-[var(--border-hover)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {hasChange ? (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
              tone === "positive" &&
                "bg-[rgba(34,197,94,0.12)] text-[var(--success)]",
              tone === "negative" &&
                "bg-[rgba(239,68,68,0.12)] text-[var(--destructive)]",
              tone === "neutral" && "bg-muted text-muted-foreground",
            )}
          >
            {change! > 0 ? (
              <TrendingUp className="h-3 w-3" aria-hidden />
            ) : change! < 0 ? (
              <TrendingDown className="h-3 w-3" aria-hidden />
            ) : (
              <Minus className="h-3 w-3" aria-hidden />
            )}
            {formatChange(change!, changePct!)}
          </span>
        ) : null}
      </div>

      <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground animate-slide-in-up">
        {displayValue}
      </div>

      {spark && spark.length >= 2 ? (
        <Sparkline points={spark} tone={tone} className="mt-3" />
      ) : (
        <div className="mt-3 h-9" />
      )}

      {!available ? (
        <p className="mt-1 text-xs text-muted-foreground">
          No data available for this metric
        </p>
      ) : null}
    </Card>
  );
};
