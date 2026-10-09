"use client";

import { useTheme } from "next-themes";
import { CHART_COLORS } from "./chart-theme";

export interface ChartTokens {
  isDark: boolean;
  primary: string;
  axis: string;
  muted: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
  track: string;
  palette: readonly string[];
}

const DARK_TOKENS: ChartTokens = {
  isDark: true,
  primary: "#3B82F6",
  axis: "#64748B",
  muted: "#94A3B8",
  grid: "rgba(148,163,184,0.12)",
  tooltipBg: "#111827",
  tooltipBorder: "rgba(255,255,255,0.10)",
  tooltipText: "#F8FAFC",
  tooltipMuted: "#94A3B8",
  track: "rgba(148,163,184,0.15)",
  palette: CHART_COLORS,
};

const LIGHT_TOKENS: ChartTokens = {
  isDark: false,
  primary: "#2563EB",
  axis: "#64748B",
  muted: "#475569",
  grid: "rgba(15,23,42,0.08)",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "rgba(15,23,42,0.10)",
  tooltipText: "#0F172A",
  tooltipMuted: "#475569",
  track: "rgba(15,23,42,0.08)",
  palette: CHART_COLORS,
};

export const useChartTokens = (): ChartTokens => {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? LIGHT_TOKENS : DARK_TOKENS;
};
