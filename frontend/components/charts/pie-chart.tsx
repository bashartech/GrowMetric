"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/signals/empty-state";
import type { DashboardWidgetDataDTO } from "@/lib/types";
import { formatValue } from "./format";
import { useChartTokens } from "./use-chart-tokens";
import { useECharts } from "./use-echarts";

interface PieChartProps {
  data: DashboardWidgetDataDTO["data"];
  title: string;
  className?: string;
}

export const PieChart = ({ data, title, className }: PieChartProps) => {
  const { available, rows, total } = data;
  const hasData = Boolean(available && rows && rows.length > 0);
  const tokens = useChartTokens();

  const centerTotal = useMemo(() => {
    if (!rows) return 0;
    return total ?? rows.reduce((sum, row) => sum + row.value, 0);
  }, [rows, total]);

  const option = useMemo<EChartsOption>(() => {
    if (!hasData || !rows) return {};
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderRadius: 10,
        padding: [8, 12],
        textStyle: { color: tokens.tooltipText, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { name?: string; value?: number; percent?: number };
          return `${p.name ?? ""}: ${formatValue(p.value)} (${(p.percent ?? 0).toFixed(1)}%)`;
        },
      },
      legend: {
        type: "scroll",
        bottom: 0,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: tokens.muted, fontSize: 11 },
        pageIconColor: tokens.primary,
        pageTextStyle: { color: tokens.muted },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "82%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          padAngle: 2,
          itemStyle: {
            borderRadius: 5,
            borderColor: "transparent",
            borderWidth: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 16, shadowColor: "rgba(0,0,0,0.35)" },
          },
          data: rows.map((row, index) => ({
            name: row.group,
            value: row.value,
            itemStyle: { color: tokens.palette[index % tokens.palette.length] },
          })),
          animationType: "scale",
          animationDuration: 800,
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
      <div className="relative h-64 w-full">
        <div
          ref={chartRef}
          className="absolute inset-0"
          role="img"
          aria-label={`${title} chart`}
        />
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex flex-col items-center">
          <span className="text-xl font-bold tabular-nums text-foreground">
            {formatValue(centerTotal)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            total
          </span>
        </div>
      </div>
    </Card>
  );
};
