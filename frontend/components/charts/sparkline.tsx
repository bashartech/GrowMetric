"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type SparklineTone = "positive" | "negative" | "neutral";

interface SparklineProps {
  points: number[];
  tone?: SparklineTone;
  className?: string;
}

const TONE_COLORS: Record<SparklineTone, string> = {
  positive: "#22C55E",
  negative: "#EF4444",
  neutral: "#3B82F6",
};

const WIDTH = 128;
const HEIGHT = 36;
const PAD = 3;

/**
 * Lightweight inline SVG sparkline (no chart engine) with a CSS draw-in
 * animation that respects prefers-reduced-motion.
 */
export const Sparkline = ({
  points,
  tone = "neutral",
  className,
}: SparklineProps) => {
  const rawId = useId();
  const gradientId = `spark-${rawId.replaceAll(":", "")}`;

  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (WIDTH - PAD * 2) / (points.length - 1);

  const coords = points.map((point, index) => {
    const x = PAD + index * stepX;
    const y = HEIGHT - PAD - ((point - min) / span) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });

  const linePath = coords
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${(WIDTH - PAD).toFixed(1)} ${HEIGHT} L${PAD} ${HEIGHT} Z`;

  const color = TONE_COLORS[tone];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} className="animate-fade-in" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="sparkline-draw"
      />
    </svg>
  );
};
