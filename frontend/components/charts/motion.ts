// Motion helpers shared by chart components (kept free of echarts imports so
// lightweight pieces like the sparkline don't pull the chart engine).
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// jsdom (unit tests) lacks IntersectionObserver — skip number animations there
// so assertions see final values immediately.
export const shouldAnimateNumbers = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.IntersectionObserver !== "undefined" &&
  !prefersReducedMotion();
