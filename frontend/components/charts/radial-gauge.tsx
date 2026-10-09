"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useChartTokens } from "./use-chart-tokens";
import { useECharts } from "./use-echarts";

interface RadialGaugeProps {
  /** 0–100 */
  value: number;
  label?: string;
  title?: string;
  className?: string;
}

const clamp = (value: number): number => Math.min(Math.max(value, 0), 100);

export const RadialGauge = ({
  value,
  label = "score",
  title,
  className,
}: RadialGaugeProps) => {
  const tokens = useChartTokens();
  const safeValue = clamp(value);

  const option = useMemo<EChartsOption>(
    () => ({
      series: [
        {
          type: "gauge",
          startAngle: 90,
          endAngle: -270,
          radius: "100%",
          pointer: { show: false },
          progress: {
            show: true,
            overlap: false,
            roundCap: true,
            width: 12,
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 1,
                y2: 1,
                colorStops: [
                  { offset: 0, color: tokens.primary },
                  { offset: 1, color: "#22D3EE" },
                ],
              },
            },
          },
          axisLine: { lineStyle: { width: 12, color: [[1, tokens.track]] } },
          splitLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          data: [
            {
              value: safeValue,
              name: label,
              title: { color: tokens.muted, fontSize: 11, offsetCenter: [0, "30%"] },
              detail: {
                valueAnimation: true,
                fontSize: 26,
                fontWeight: 700,
                color: tokens.tooltipText,
                offsetCenter: [0, "-8%"],
                formatter: "{value}%",
              },
            },
          ],
          animationDuration: 900,
          animationEasing: "cubicOut",
        },
      ],
    }),
    [safeValue, label, tokens],
  );

  const chartRef = useECharts(option);

  const content = (
    <div
      ref={chartRef}
      className="h-44 w-full"
      role="img"
      aria-label={`${label}: ${safeValue.toFixed(0)} percent`}
    />
  );

  if (!title) return <div className={className}>{content}</div>;

  return (
    <Card className={cn("p-5", className)}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {content}
    </Card>
  );
};
