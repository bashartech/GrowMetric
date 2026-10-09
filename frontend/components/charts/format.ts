export const formatValue = (
  value: number | null | undefined,
  unit?: string,
): string => {
  if (value === null || value === undefined) return "—";
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return unit ? `${formatted} ${unit}` : formatted;
};

export const formatChange = (change: number, changePct: number): string => {
  const sign = change > 0 ? "+" : "";
  const amount = change.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${sign}${amount} (${sign}${changePct.toFixed(1)}%)`;
};

export const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
