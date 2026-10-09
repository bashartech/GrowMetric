# Tasks: 005-website-design

**Spec**: `specs/005-website-design/spec.md`  
**Plan**: `specs/005-website-design/plan.md`  
**Branch**: `005-website-design`

## Phase 1: Discovery & Baseline (Read-only audit)
- [X] T001: Read `frontend/package.json` (deps: charts, motion, theme, icons)
- [X] T002: Read `frontend/app/globals.css` (full) + current tokens
- [X] T003: Read `frontend/postcss.config.mjs`, Tailwind config (if any)
- [X] T004: Read `frontend/app/layout.tsx`, `frontend/app/providers.tsx`
- [X] T005: Read `frontend/components/layout/app-shell.tsx`, `sidebar.tsx`, `topbar.tsx`
- [X] T006: Inventory `frontend/components/ui/*` (button/card/input/badge/table/dialog/dropdown/tabs/tooltip/skeleton/toast/select/popover/sheet/alert/avatar/progress/scroll-area)
- [X] T007: Read AI components: `components/ai/*` (analyst, chat, evidence, investigation, simulator, bubbles/tool-calls)
- [X] T008: Read feature components: dashboard, datasets, data-sources, imports, mapping, filters, charts wrappers
- [X] T009: Read automation: alerts, alert-rules, recommendations, notifications, reports, report-schedules
- [X] T010: Analyze `frontend/public/reference-image1.png`, `reference-image2.png` (palette, spacing, layout, sidebar, cards, charts, tooltips)

## Phase 2: Design Tokens & Global Styles
- [X] T011: Define CSS variables per design.md (background/surface/card/input/border/text/accent/semantic) in `app/globals.css`
- [X] T012: Add chart color tokens + utilities
- [X] T013: Add dark scrollbar styles
- [X] T014: Add visible focus ring base styles (blue accent)
- [X] T015: Add skeleton shimmer + reduced-motion keyframes
- [X] T016: Add CSS-first micro-interaction utilities (fade-in/slide-in/scale-in)
- [X] T017: Verify dark-first; keep light mode functional if exists

## Phase 3: Shared UI Primitives (Core System)
- [X] T018: Restyle `components/ui/card.tsx` (bg/border/radius/padding/hover)
- [X] T019: Restyle `components/ui/button.tsx` (variants: primary/secondary/ghost/destructive/ai, states, loading)
- [X] T020: Restyle `components/ui/badge.tsx` (semantic: success/warning/error/info/ai)
- [X] T021: Restyle `components/ui/input.tsx`, `textarea.tsx`, `label.tsx` (focus glow)
- [X] T022: Restyle `components/ui/table.tsx` (rows, hover, sticky header, separators)
- [X] T023: Restyle `components/ui/dialog.tsx` (backdrop blur, fade+scale, elevated)
- [X] T024: Restyle `components/ui/dropdown-menu.tsx`, `select.tsx` (dark, hover/selected/focus)
- [X] T025: Restyle `components/ui/tabs.tsx` (active blue accent, smooth)
- [X] T026: Restyle `components/ui/tooltip.tsx` (#111827, border, radius 10px)
- [X] T027: Restyle `components/ui/skeleton.tsx` (shimmer)
- [X] T028: Restyle `components/ui/alert.tsx`, toast system
- [X] T029: Restyle `components/ui/popover.tsx`, `sheet.tsx`, `separator.tsx`, `progress.tsx`, `avatar.tsx`, `scroll-area.tsx` (if present)

## Phase 4: App Shell & Navigation
- [X] T030: Restyle `components/layout/app-shell.tsx` (responsive drawer, bg, layout)
- [X] T031: Restyle `components/layout/sidebar.tsx` (dark #070A10, border, grouped, active blue bg+glow+border, hover, tooltip/collapsible)
- [X] T032: Restyle `components/layout/topbar.tsx` (elevated, border, controls, hierarchy)
- [X] T033: Apply page container padding system globally (desktop 24–32/tablet 20–24/mobile 16), preserve info density

## Phase 5: Common Primitives
- [X] T034: Restyle/commonize `components/common/page-header.tsx` (if exists)
- [X] T035: Restyle `components/common/empty-state.tsx`, `error-state.tsx`, `loading-state.tsx`
- [X] T036: Restyle `components/common/stat-card.tsx`, `chart-card.tsx`

## Phase 6: Feature Components (Data/Analytics/Dashboard)
- [X] T037: Restyle `components/dashboard/dashboard-render.tsx`, KPI/stat/chart cards
- [X] T038: Restyle `components/datasets/dataset-view.tsx`
- [X] T039: Restyle `components/data-sources/external-db-form.tsx`, `external-db-url.tsx`
- [X] T040: Restyle `components/imports/upload-form.tsx`, `reimport-form.tsx`, `history-view.tsx`
- [X] T041: Restyle `components/mapping/mapping-dialog.tsx`
- [X] T042: Restyle `components/data-quality/data-quality-view.tsx` (if present)
- [X] T043: Restyle `components/filters/date-filters.tsx`

## Phase 7: Charts & Graphs
- [X] T044: Audit chart libs; confirm Recharts or existing; style wrappers
- [X] T045: Apply dark theme, color sequence, minimal gridlines, axes/labels
- [X] T046: Premium tooltips (#111827, 10px, border) for all chart types
- [X] T047: Responsive containers, mobile simplification, no overflow
- [X] T048: Style Line/Area/Bar/Stacked/Donut/Pie/Radial/Progress/Sparklines/Comparison/Activity

## Phase 8: AI Surfaces
- [X] T049: Restyle `components/ai/ai-analyst.tsx`, `ai-analyst-chat.tsx`
- [X] T050: Restyle `components/ai/ai-evidence-panel.tsx`, `ai-investigation.tsx`, `ai-simulator.tsx`
- [X] T051: Restyle message bubbles, tool-call cards, typing/code-block/markdown
- [X] T052: Restyle AI input composer (focus glow, preserve Enter/Shift+Enter)
- [X] T053: Add subtle AI message fade-in (reduced-motion safe)

## Phase 9: Automation/Notifications/Reports
- [X] T054: Restyle `components/alerts/*`
- [X] T055: Restyle `components/alert-rules/*`
- [X] T056: Restyle `components/recommendations/recommendations-list.tsx`
- [X] T057: Restyle `components/notifications/notifications-list.tsx`
- [X] T058: Restyle `components/reports/*`, `components/report-schedules/*`

## Phase 10: Auth/Onboarding/Root Pages
- [X] T059: Restyle `(auth)/login`, `(auth)/register`, layout
- [X] T060: Restyle `app/onboarding/page.tsx`, `app/page.tsx`
- [X] T061: Verify root `app/layout.tsx`, `providers.tsx` (no logic changes)

## Phase 11: Global Sweep & Responsive
- [X] T062: Sweep all `(app)/*` routes for ad-hoc styles; enforce tokens/shared components
- [X] T063: Responsive pass 320–1920+, eliminate horizontal overflow
- [X] T064: Accessibility pass (focus rings, semantics, contrast AA, keyboard)

## Phase 12: Animations Polish
- [X] T065: Apply CSS micro-interactions to buttons/cards/nav/tabs/modals/dropdowns/toasts
- [X] T066: Ensure skeleton shimmer + reduced-motion everywhere

## Phase 13: Validation & Gate
- [X] T067: Type-check (frontend)
- [X] T068: Lint (frontend)
- [X] T069: Build (frontend)
- [X] T070: Unit tests (Vitest) — run, fix only brittle class assertions if they fail
- [X] T071: Smoke test critical flows (auth, dashboard, data hub, AI, automation)
- [X] T072: Visual consistency vs design.md + refs; finalize
- [X] T073: Phase gate: all pass before merge