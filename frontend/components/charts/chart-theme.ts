// Shared chart styling tokens (dark-premium per design.md) — theme-aware via CSS vars.
import type React from "react";

export const CHART_COLORS = [
  "#3B82F6",
  "#22D3EE",
  "#7C3AED",
  "#22C55E",
  "#FACC15",
  "#EF4444",
  "#38BDF8",
  "#A78BFA",
  "#4ADE80",
  "#FDE047",
  "#F87171",
] as const;

export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "#111827",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "10px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  padding: "8px 10px",
};

export const CHART_TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "#F8FAFC",
  fontWeight: 600,
  fontSize: 12,
  marginBottom: 2,
};

export const CHART_GRID_STROKE = "rgba(148,163,184,0.12)";

export const CHART_AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: "#94A3B8",
} as const;

export const CHART_AXIS_LINE_STYLE = { stroke: "rgba(148,163,184,0.25)" } as const;
