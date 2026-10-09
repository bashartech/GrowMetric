# Implementation Plan: 005-website-design

**Branch**: `005-website-design`  
**Spec**: `specs/005-website-design/spec.md`  
**Approach**: Visual redesign only. Inspect → Define tokens → Restyle shared components → Apply globally → Polish charts/AI/animations → Verify (lint/typecheck/build/tests)

## 1. Pre-Implementation (Discovery)
- [ ] Read `frontend/package.json` to detect existing deps (charts, icons, motion, theme)
- [ ] Read `frontend/app/globals.css` (full) to see current tokens, CSS vars, `.dark` setup
- [ ] Read `frontend/tailwind.config.*` / postcss (Tailwind v4)
- [ ] Read `frontend/app/providers.tsx`, `frontend/app/layout.tsx`
- [ ] Read `frontend/components/layout/sidebar.tsx`, `topbar.tsx`, `app-shell.tsx`
- [ ] Inspect key shared UI: `components/ui/*` (button, card, input, badge, table, dialog, dropdown, tabs, tooltip, skeleton, toast)
- [ ] Inspect AI components, charts usage, feature components
- [ ] Analyze reference images (`reference-image1.png`, `reference-image2.png`) for layout/colors/spacing/typography (extract palette/spacing)
- [ ] Map design.md tokens to CSS variables (extend/update globals.css)

## 2. Design System Foundation
- [ ] Extend/replace theme tokens in `frontend/app/globals.css` with design.md tokens (background/surface/card/input/border/text/accent/semantic)
- [ ] Define chart color tokens and utility classes
- [ ] Add scrollbar styles (subtly dark)
- [ ] Add base focus ring styles (visible, blue accent)
- [ ] Add skeleton shimmer + reduced-motion keyframes
- [ ] Add micro-interaction utilities (fade/slide/scale) as CSS-first
- [ ] Ensure theme-aware (dark-first; preserve light if exists, keep functional)

## 3. Shared Components (Priority #1 — propagate globally)
Restyle once at shared level:
- [ ] `components/ui/card.tsx` — bg #0D111A, border rgba(255,255,255,0.07), radius 12–16px, padding 16–24px, subtle hover
- [ ] `components/ui/button.tsx` — variants: primary (blue), secondary (surface+border), ghost, destructive (red), AI (purple/violet), sizes, hover/active/disabled/loading, focus
- [ ] `components/ui/badge.tsx` — semantic (success/warning/error/info/AI) with dark backgrounds
- [ ] `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/label.tsx` — dark bg, subtle border, focus blue+glow
- [ ] `components/ui/table.tsx` — dark bg, row separators, sticky header, hover row, compact readable
- [ ] `components/ui/dialog.tsx` — dark elevated, backdrop blur, radius 14–16px, fade+scale
- [ ] `components/ui/dropdown-menu.tsx`, `components/ui/select.tsx` — dark surface, hover/selected, focus
- [ ] `components/ui/tabs.tsx` — active blue accent, underline/bg, smooth
- [ ] `components/ui/tooltip.tsx` — #111827 bg, border rgba(255,255,255,0.10), radius 10px
- [ ] `components/ui/skeleton.tsx` — shimmer, matches surfaces
- [ ] `components/ui/alert.tsx`, `components/ui/toast/sonner` — semantic colors, dark elevated
- [ ] `components/ui/progress.tsx`, `components/ui/avatar.tsx`, `components/ui/scroll-area.tsx` (if present)
- [ ] `components/ui/sheet.tsx`, `components/ui/popover.tsx`, `components/ui/separator.tsx`

## 4. App Shell & Navigation
- [ ] `components/layout/app-shell.tsx` — container, responsive drawer, z-index, bg
- [ ] `components/layout/sidebar.tsx` — dark #070A10, 1px border, grouped, active state (blue bg+glow+border), hover, collapsible/tooltip, user/profile
- [ ] `components/layout/topbar.tsx` — elevated dark, subtle border, controls, button hierarchy, responsive
- [ ] Apply consistent page container padding (desktop 24–32, tablet 20–24, mobile 16), info density preserved

## 5. Common/Shared Page Primitives
- [ ] `components/common/page-header.tsx` (if exists) — title hierarchy, actions
- [ ] `components/common/empty-state.tsx` — icon/title/desc/action, premium
- [ ] `components/common/error-state.tsx` — red accent, retry
- [ ] `components/common/loading-state.tsx` / skeletons
- [ ] `components/common/stat-card.tsx`, `components/common/chart-card.tsx` — premium cards, trends, sparklines

## 6. Feature Components (Data/Analytics)
- [ ] Dashboard: `components/dashboard/dashboard-render.tsx`, KPI/stat cards, chart cards
- [ ] Datasets: `components/datasets/dataset-view.tsx`
- [ ] Data sources: `components/data-sources/external-db-form.tsx`, `external-db-url.tsx`
- [ ] Imports: `components/imports/upload-form.tsx`, `reimport-form.tsx`, `history-view.tsx`
- [ ] Mapping: `components/mapping/mapping-dialog.tsx`
- [ ] Data quality: `components/data-quality/data-quality-view.tsx` (if present)
- [ ] Filters: `components/filters/date-filters.tsx`
- [ ] Tables throughout use shared table styles

## 7. Charts & Graphs
- [ ] Audit existing chart usage; use existing lib or Recharts if missing (justify). No data changes
- [ ] Apply dark theme, consistent color sequence, minimal gridlines, readable axes/labels
- [ ] Premium tooltip (#111827, 10px radius, border)
- [ ] Responsive containers, no overflow, mobile simplification
- [ ] Line/Area/Bar/Stacked/Donut/Pie/Radial/Progress/Sparklines/Comparison/Activity styled consistently
- [ ] Add subtle chart enter/update transitions (CSS; reduced-motion safe)

## 8. AI Surfaces
- [ ] `components/ai/ai-analyst.tsx`, `ai-analyst-chat.tsx`, `ai-evidence-panel.tsx`, `ai-investigation.tsx`, `ai-simulator.tsx`
- [ ] Message bubbles (user vs AI), AI purple/blue accent, avatar, timestamps if exist
- [ ] Tool-call cards (compact expandable), status indicators
- [ ] Typing indicator, code-block, markdown rendering, copy/regenerate/feedback if present
- [ ] Premium input composer, focus glow, Enter/Shift+Enter preserved
- [ ] Subtly staggered message fade-in (non-blocking, reduced-motion)

## 9. Automation/Notifications/Reports
- [ ] Alerts: lists/forms, semantic states
- [ ] Alert rules: forms/lists
- [ ] Recommendations: list, severity/source, evidence
- [ ] Notifications: inbox, unread badge, read states
- [ ] Reports/report-schedules: lists/forms, clean layout

## 10. Auth, Onboarding, Root
- [ ] `(auth)/login`, `(auth)/register`, `(auth)/layout`
- [ ] `app/onboarding/page.tsx`, `app/page.tsx`
- [ ] Forms use shared input/button/card; focus states, errors

## 11. Apply Globally to All Pages/Routes
- [ ] Verify every route in inventory uses AppShell + shared components + tokens
- [ ] Ensure no page has ad-hoc colors/borders/radius; enforce consistency
- [ ] Mobile responsiveness sweep (320–1920+), no horizontal overflow

## 12. Animations & Polish
- [ ] Add CSS-first micro-interactions (buttons/cards/nav/tabs/modals/dropdowns/toasts)
- [ ] Skeleton shimmer, reduced-motion respected everywhere
- [ ] Subtly refined AI/tool states (non-distracting)

## 13. Accessibility & Quality
- [ ] Visible focus rings, semantic HTML, ARIA, contrast AA, keyboard nav
- [ ] Prefers-reduced-motion compliance

## 14. Validation (Gate)
- [ ] Type-check, lint, build (frontend)
- [ ] Run unit tests (Vitest) — behavior preserved; update only brittle class assertions if needed
- [ ] Manual smoke: auth, dashboard, data hub, AI, automation, responsive
- [ ] Visual consistency pass vs refs/design.md

## 15. Dependencies Check
- [ ] If motion needed: add `framer-motion` only if CSS insufficient (justify in commit). Else skip. Prefer existing libs.