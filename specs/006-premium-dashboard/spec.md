# 006-premium-dashboard — Spec

## Goal

Replace the simple recharts-based chart layer with a premium, animated ECharts-based chart system and rebuild the dashboard page into the dense, analytics-heavy layout defined in `design.md` (stat strip → hero chart + summary → secondary charts → insights → activity/health), using only real backend data.

## Constraints

- No functionality regressions: filters, refresh, widget preview, existing routes/APIs unchanged.
- Chart components keep the `DashboardWidgetDataDTO["data"]` + `title` props contract so all consumers upgrade transparently.
- ECharts (Apache-2.0) tree-shaken via `echarts/core`, SVG renderer (SSR/jsdom safe), themed with 005 design tokens.
- Backend: time-based widgets get up to 40 points (was 10); KPI preview gains previousValue/change/changePct.
- New dashboard panels (insights, activity, health) use existing endpoints only.
- Unit tests (vitest/RTL) must keep passing; update assertions only where layout legitimately changes.

## Out of scope

- Migrating non-dashboard pages off recharts (they only use components/charts, which migrates automatically).
- Widget editor / dashboard CRUD UI.
