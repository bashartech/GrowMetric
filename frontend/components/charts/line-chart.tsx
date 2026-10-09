"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/signals/empty-state";
import type { DashboardWidgetDataDTO } from "@/lib/types";
import { formatCompact, formatValue } from "./format";
import { useChartTokens } from "./use-chart-tokens";
import { useECharts } from "./use-echarts";

interface LineChartProps {
  data: DashboardWidgetDataDTO["data"];
  title: string;
  className?: string;
  /** Override for the plot area height (the hero chart sits taller). */
  chartClassName?: string;
}

export const LineChart = ({ data, title, className, chartClassName }: LineChartProps) => {
  const { available, rows } = data;
  const hasData = Boolean(available && rows && rows.length > 0);
  const tokens = useChartTokens();

  const option = useMemo<EChartsOption>(() => {
    if (!hasData || !rows) return {};
    const names = rows.map((row) => row.group);
    const values = rows.map((row) => row.value);
    return {
      grid: { top: 16, right: 16, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderRadius: 10,
        padding: [8, 12],
        textStyle: { color: tokens.tooltipText, fontSize: 12 },
        axisPointer: {
          type: "line",
          lineStyle: { color: tokens.grid, width: 1 },
        },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? formatValue(value) : String(value ?? ""),
      },
      xAxis: {
        type: "category",
        data: names,
        boundaryGap: false,
        axisLine: { lineStyle: { color: tokens.grid } },
        axisTick: { show: false },
        axisLabel: { color: tokens.axis, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tokens.muted, fontSize: 11, formatter: formatCompact },
        splitLine: { lineStyle: { color: tokens.grid } },
      },
      series: [
        {
          type: "line",
          data: values,
          smooth: true,
          showSymbol: false,
          symbol: "circle",
          lineStyle: { color: tokens.primary, width: 2.5 },
          itemStyle: {
            color: tokens.primary,
            borderColor: tokens.tooltipBg,
            borderWidth: 2,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${tokens.primary}59` },
                { offset: 1, color: `${tokens.primary}00` },
              ],
            },
          },
          emphasis: { focus: "series" },
          animationDuration: 900,
          animationEasing: "cubicOut",
        },
      ],
    };
  }, [hasData, rows, tokens]);

  const chartRef = useECharts(option, hasData);

  if (!hasData) {
    return (
      <Card className={cn("p-5", className)}>
        <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <EmptyState
          title="No data available"
          description="This chart requires a dataset with time-series data"
        />
      </Card>
    );
  }

  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span
            className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"
            aria-hidden
          />
          live
        </span>
      </div>
      <div
        ref={chartRef}
        className={cn("h-64 w-full", chartClassName)}
        role="img"
        aria-label={`${title} chart`}
      />
    </Card>
  );
};
