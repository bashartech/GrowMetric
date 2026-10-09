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

interface BarChartProps {
  data: DashboardWidgetDataDTO["data"];
  title: string;
  className?: string;
}

export const BarChart = ({ data, title, className }: BarChartProps) => {
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
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.06)" } },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? formatValue(value) : String(value ?? ""),
      },
      xAxis: {
        type: "category",
        data: names,
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
          type: "bar",
          data: values,
          barMaxWidth: 44,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: tokens.primary },
                { offset: 1, color: `${tokens.primary}66` },
              ],
            },
          },
          emphasis: {
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: "#60A5FA" },
                  { offset: 1, color: `${tokens.primary}80` },
                ],
              },
              shadowBlur: 12,
              shadowColor: `${tokens.primary}59`,
            },
          },
          animationDuration: 800,
          animationEasing: "cubicOut",
          animationDelay: (index: number) => index * 60,
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
          description="This chart requires a dataset with categorical data"
        />
      </Card>
    );
  }

  return (
    <Card className={cn("p-5", className)}>
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div
        ref={chartRef}
        className="h-64 w-full"
        role="img"
        aria-label={`${title} chart`}
      />
    </Card>
  );
};
