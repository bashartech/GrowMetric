/**
 * Deterministic metric fixtures for Phase 4 automation tests.
 * All values are computed from fixed seeds — no random data.
 */

export const FIXED_REVENUE = Object.freeze({
  months: [
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
    "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    "2026-07", "2026-08",
  ] as const,
  values: Object.freeze([
    100000, 102000, 98000, 105000, 103000, 107000,
    110000, 108000, 112000, 115000, 113000, 118000,
    120000, 122000, 125000, 123000, 128000, 130000,
    135000, 200000,
  ] as const),
});

export const FIXED_ORDERS = Object.freeze({
  months: FIXED_REVENUE.months,
  values: Object.freeze([
    500, 520, 490, 530, 510, 540,
    550, 530, 560, 580, 570, 590,
    600, 610, 620, 615, 630, 640,
    650, 660,
  ] as const),
});

/** Returns the mean of the trailing `window` periods before `currentIndex`. */
export function baseline(values: readonly number[], currentIndex: number, window = 3): number {
  const start = Math.max(0, currentIndex - window);
  const slice = values.slice(start, currentIndex);
  return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
}

/** Computes deviation percentage: |observed - baseline| / |baseline| * 100 */
export function deviationPct(observed: number, baselineValue: number): number {
  if (baselineValue === 0) return 0;
  return Math.round((Math.abs(observed - baselineValue) / Math.abs(baselineValue)) * 100);
}

/** Build an anomaly-like record for the given metric at `currentIndex`. */
export function buildAnomalyRecord(
  metricKind: string,
  currentIndex: number,
  data: { months: readonly string[]; values: readonly number[] },
  threshold = 30,
) {
  const observed = data.values[currentIndex];
  const base = baseline(data.values, currentIndex);
  const dev = deviationPct(observed ?? 0, base);
  return {
    metricKind,
    period: data.months[currentIndex],
    baseline: { period: data.months[currentIndex - 1] ?? data.months[0], value: base },
    observed: { period: data.months[currentIndex], value: observed },
    deviationPct: dev,
    exceedsThreshold: dev >= threshold,
  };
}
