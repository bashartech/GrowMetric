# 006-premium-dashboard — Tasks

Status legend: `[ ]` pending, `[X]` done. Mark complete before starting the next phase.

## Phase 1: Chart engine scaffold

- [X] T001: Install `echarts` (done via npm), verify tree-shaken import path
- [X] T002: `components/charts/echarts-core.ts` — register Line/Bar/Pie charts + Grid/Tooltip/Legend + SVG renderer
- [X] T003: `components/charts/echarts-theme.ts` — dark premium theme from design.md tokens (palette, tooltip #111827, grid rgba(255,255,255,0.06), axis #64748B, animation timing)
- [X] T004: `components/charts/use-echarts.ts` — SSR/jsdom-safe hook: init (SVG), setOption notMerge, ResizeObserver, dispose, try/catch fallback

## Phase 2: Chart kit rebuild (same props contract)

- [X] T005: `sparkline.tsx` — tiny animated area sparkline primitive (no axes)
- [X] T006: `kpi-card.tsx` — label, animated count-up value + unit, trend `+15,000.5 (+13.6%)` (format preserved for tests), vs-last-period, sparkline
- [X] T007: `line-chart.tsx` — smooth animated line + gradient area, crosshair axisPointer, dark tooltip
- [X] T008: `bar-chart.tsx` — staggered animated rounded-top bars, gradient fill, hover emphasis
- [X] T009: `pie-chart.tsx` — animated donut, center total, percent labels, legend
- [X] T010: `data-table.tsx` — premium table styling (hover rows, tabular-nums, Total footer kept)
- [X] T011: `radial-gauge.tsx` — new: animated radial progress (used for data-quality score)
- [X] T012: Update `components/charts/index.ts` barrel exports
- [X] T013: Remove `recharts` dependency (no remaining imports)

## Phase 3: Backend enrichment

- [X] T014: `dashboard.service.ts` — group-by row limit: LINE 40, BAR/PIE/TABLE 15 (was 10)
- [X] T015: `dashboard.service.ts` — KPI preview computes previousValue/change/changePct/changeAvailable (reuse compare-periods logic; window = selected/default date range vs preceding equal window)
- [X] T016: Preview widget computation runs concurrently (Promise.all, order preserved)
- [X] T017: Backend unit tests for deltas + limits

## Phase 4: Dashboard page rebuild

- [X] T018: Header: name, live-data status, date presets, filters dropdown, refresh (existing behavior preserved)
- [X] T019: Stat strip: 4 KPI widgets → StatCard row (delta + sparkline)
- [X] T020: Hero: LINE widget as large gradient area chart (2/3) + Summary panel (1/3): totals, top group, average, share — calculated from widget rows
- [X] T021: Secondary row: BAR + PIE + TABLE placed by widget type (graceful fallback to generic grid for unknown shapes)
- [X] T022: AI insights feed: anomalies + recommendations + alerts (severity badges) via existing endpoints; api-client methods added for gaps (`/imports`, `/datasets/:id/quality`, `/usage`)
- [X] T023: Activity + health panels: recent imports table, data-quality score gauge, usage vs plan
- [X] T024: Loading/empty/error states preserved (skeleton grid, EmptyState, warning banner)

## Phase 5: Polish

- [X] T025: Entrance animations (staggered card fade/slide), count-up numbers
- [X] T026: `prefers-reduced-motion` respected (disable ECharts animations + count-up)
- [X] T027: Responsive breakpoints (1/2/4 columns)
- [X] T028: A11y: aria labels on charts, keyboard-reachable actions, contrast check vs design.md

## Phase 6: Validation

- [X] T029: `npm run typecheck`
- [X] T030: `npm run lint`
- [X] T031: `npm run test` (update dashboard-render assertions for new layout where needed)
- [X] T032: `npm run build`
- [ ] T033: Backend test suite (vitest, worker stopped, --maxWorkers=2)
- [ ] T034: Visual smoke + PHR record for 006-premium-dashboard
