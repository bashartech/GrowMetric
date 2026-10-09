# Feature Specification: Phase 5 — Website Design (Complete UI/UX Redesign)

**Feature Branch**: `005-website-design`  
**Created**: 2026-10-07  
**Status**: Draft  
**Input**: `design.md` (1681 lines), reference images `frontend/public/reference-image1.png`, `frontend/public/reference-image2.png`, UI/UX skills in `.opencode/skills/` (design-to-code, frontend-design, ui-ux-engineering, ui-ux-pro-max)

## 1. Goal

Completely redesign the visual UI/UX of the **existing** GrowMetrics application while **preserving 100% of existing functionality, routes, APIs, authentication, business logic, forms, data, and backend integrations**. Treat this as a visual/design-system migration (not a rebuild).

The target aesthetic is **Dark Premium SaaS / Enterprise Data Platform**, inspired directly by the two reference images and all specifications in `design.md`.

## 2. Non-Goals

- Rebuild or remove features/pages/routes/components
- Remove/replace working API calls, DB logic, or auth
- Replace real application data with mock/demo data
- Simplify functionality to fit visuals
- Introduce unnecessary heavy dependencies without justification
- Create light-mode-first redesign (dark-first, preserve existing theme architecture if present)

## 3. Design References

### 3.1 Reference Images (Primary Inspiration)

Located in `frontend/public/`:
- `reference-image1.png`
- `reference-image2.png`

**Required extraction/analysis (to match closely):**
- Visual hierarchy, layout grid, spacing rhythm
- Dark backgrounds (#05070B / near-black/navy), surface layering, elevation via subtle borders (not heavy shadows)
- Sidebar: dark base, active item with blue accent + soft glow, grouped nav, compact readable spacing
- Dashboard: stat cards, large primary charts, secondary charts, summary panels, data density
- Cards: soft inner/outer borders, 12–16px radius, premium depth
- Typography: clean sans-serif, high contrast, tight vertical rhythm
- Charts/graphs: dark plot areas, gridlines, legends, tooltips (elevated dark), accent palette (blue/cyan/purple/green/yellow/red)
- Data visualization style: professional analytics/financial dashboard
- Color usage: blue/cyan/purple accents, enterprise aesthetic

### 3.2 Design Document (`design.md`)

Must be treated as **source of truth** for tokens, spacing, typography, states, accessibility, responsiveness, animations, AI visual language, charts, tables, forms, empty/loading/error states.

## 4. Color System (Dark-First)

**Base backgrounds:**
- `--background`: `#05070B` (primary app background)
- `--surface-base`: `#080B12` (secondary background)
- `--sidebar-bg`: `#070A10` (sidebar)
- `--card-bg`: `#0D111A` (cards)
- `--card-elevated`: `#111722` (elevated cards/surfaces)
- `--input-bg`: `#0B0F17` (inputs/selects)
- `--surface-hover`: `rgba(255,255,255,0.04)`–`rgba(255,255,255,0.06)`
- `--surface-active`: `rgba(59,130,246,0.12)`

**Borders:**
- `--border-subtle`: `rgba(255,255,255,0.08)`
- `--border-hover`: `rgba(255,255,255,0.16)`
- `--border-active`: `rgba(59,130,246,0.40)`

**Accent palette (semantic):**
- Primary/Action: `#3B82F6`, `#2563EB`, `#60A5FA`
- Cyan (analytics/highlights): `#22D3EE`, `#38BDF8`
- Purple/Violet (AI/intelligence): `#7C3AED`, `#8B5CF6`, `#A78BFA`
- Green (success/positive): `#22C55E`, `#4ADE80`
- Yellow (warning/attention): `#FACC15`, `#FDE047`
- Red (destructive/error): `#EF4444`, `#F87171`
- Slate/neutral text: Primary `#F8FAFC`, Secondary `#94A3B8`, Muted `#64748B`

**Active nav state (required):**
- Background: `rgba(59,130,246,0.15)`
- Border: `rgba(59,130,246,0.25)`
- Text: `#FFFFFF`
- Icon: `#60A5FA`
- Subtly blue glow (non-excessive) on active/focus

## 5. Typography

**Font family:** Prefer Geist Sans/Mono (existing). If Inter available/project-compatible keep existing stack; do not add unnecessary font deps. Maintain existing Next/font setup.

**Type scale:**
- Page title: 28–36px (700–600)
- Section title: 18–24px (600)
- Card title: 14–16px (600)
- Body: 13–15px (400–500)
- Metadata/labels: 11–13px (500–600)
- KPI/stat numbers: 24–36px (700), large hero 40–48px if present
- Code/mono: Geist Mono

Line-height 1.5–1.7, letter-spacing -0.01em for titles, tracking normal for body.

## 6. Spacing, Radius, Elevation, Transitions

- Spacing 4pt scale (4,8,12,16,20,24,28,32,40,48)
- Content padding: desktop 24–32px, tablet 20–24px, mobile 16px
- Radius: cards 12–16px, inputs/buttons 8–12px, badges/chips 6–10px, modals 14–16px, tooltips 10px
- Elevation: use **subtly elevated surfaces + 1px borders** (avoid heavy drop shadows). Modal: backdrop blur + soft border.
- Transitions: 150–300ms ease-in-out (layout 250–300ms, micro-interactions 150ms), respect `prefers-reduced-motion`.

## 7. Layout & App Shell

Preserve existing `AppShell` structure (Sidebar + Topbar + Main). Redesign visuals only.

**Sidebar (`components/layout/sidebar.tsx`):** dark `#070A10`, 1px right border `--border-subtle`, grouped sections, collapsible (if exists), tooltip on collapsed, active state with blue glow, hover, user/profile area, settings. Keep existing nav items/structure.
**Topbar (`components/layout/topbar.tsx`):** dark elevated, subtle border, search/notifications/profile/workspace/date/actions as exist. Button hierarchy, compact controls.
**Main container:** consistent max-width, responsive padding, high info density while readable.

## 8. Animations (Detailed)

Subtly professional, state/interaction-driven. Respect reduced motion.

**Core primitives:**
- Fade-in: opacity 0→1 (150–200ms ease-out)
- Slide-in (right/left/top): translate + fade (200–250ms)
- Scale-in (modals/cards): scale 0.98→1.0 + opacity (180–220ms ease-out)
- Hover lift: translateY(-1px) subtle (150ms), border highlight
- Button press: scale 0.995 (120ms)
- Skeleton shimmer: linear gradient moving across (1.8–2.0s infinite, reduced-motion disabled)
- Dropdown/menu: fade+scale+slide (160ms)
- Sheet/modal: backdrop fade (120ms) + content scale/slide (200ms)
- Sidebar expand/collapse: width+translate (250ms ease-in-out)
- Tabs underline/active: width/position (200ms)
- Toasts: slide-in top/right + fade (180ms), exit (150ms)
- Chart transitions: area/line/bar enter/update (400–600ms, avoid blocking)
- AI message stream: fade+slide-up per block (120–180ms stagger optional, non-blocking)
- Tool execution states: pulse/subtly fade (600–800ms loop, reduced-motion off)

Implementation: prefer CSS transitions + keyframes first; use `framer-motion` only where enter/exit orchestration needed (justify below).

## 9. Graphs & Charts (Detailed)

Redesign all existing charts/graphs to match refs. Use existing chart library if present; otherwise Recharts (mature, TS, Tailwind-friendly). Never replace real data.

**Chart color sequence (consistent):** `#3B82F6`, `#22D3EE`, `#7C3AED`, `#22C55E`, `#FACC15`, `#EF4444`, `#38BDF8`, `#A78BFA`, `#4ADE80`, `#FDE047`, `#F87171`

**Types required:** Line, Area, Bar, Stacked Bar, Donut/Pie, Radial, Progress, Sparklines, Comparison, Activity.

**Styling:**
- Dark plot background matching card (#0D111A/#111722)
- Subtly visible gridlines (opacity 0.08–0.12), minimal vertical/horizontal
- Clean axes, readable ticks/labels (#94A3B8)
- Legends bottom/top, compact
- **Tooltip (premium):** bg `#111827`, border `rgba(255,255,255,0.10)`, radius 10px, padding 8–10px, elevation subtle, shows label/value/change clearly
- Hover states, responsive containers, no overflow
- Mobile: reduce height, simplify legends, preserve labels

## 10. Pages Inventory (All Existing Routes)

List every existing route/page to redesign (no omissions):

**Auth group `(auth)`:**
- `app/(auth)/layout.tsx`
- `app/(auth)/login/page.tsx`
- `app/(auth)/register/page.tsx`

**App group `(app)`:**
- `app/(app)/layout.tsx` (AppShell wrapper)
- `app/(app)/overview/page.tsx`
- `app/(app)/dashboard/page.tsx`
- `app/(app)/ai-analyst/page.tsx` (AI Analyst)
- `app/(app)/investigations/page.tsx`
- `app/(app)/simulator/page.tsx`
- `app/(app)/recommendations/page.tsx`
- `app/(app)/reports/page.tsx`
- `app/(app)/report-schedules/page.tsx`
- `app/(app)/alert-rules/page.tsx`
- `app/(app)/alerts/page.tsx`
- `app/(app)/notifications/page.tsx`
- `app/(app)/data-hub/datasets/page.tsx`
- `app/(app)/data-hub/imports/page.tsx`
- `app/(app)/data-hub/data-sources/page.tsx`
- `app/(app)/data-hub/data-quality/page.tsx`
- `app/(app)/audit-logs/page.tsx`
- `app/(app)/settings/page.tsx`
- `app/(app)/billing/page.tsx`

**Other:**
- `app/onboarding/page.tsx`
- `app/page.tsx` (root)
- `app/layout.tsx`, `app/providers.tsx`, `app/globals.css`

All must follow design system.

## 11. Components Inventory (Design One-by-One)

Comprehensive list (by path). Redesign at **shared component level** first to propagate globally.

### 11.1 Layout
- `components/layout/app-shell.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`

### 11.2 Core UI (shared primitives)
- `components/ui/button.tsx`
- `components/ui/input.tsx`
- `components/ui/label.tsx`
- `components/ui/card.tsx` (Card, CardHeader, CardTitle, CardContent, CardFooter)
- `components/ui/badge.tsx`
- `components/ui/table.tsx`
- `components/ui/dialog.tsx` / modal primitives
- `components/ui/dropdown-menu.tsx`
- `components/ui/select.tsx`
- `components/ui/tabs.tsx`
- `components/ui/tooltip.tsx`
- `components/ui/popover.tsx`
- `components/ui/sheet.tsx` (if present)
- `components/ui/textarea.tsx`
- `components/ui/checkbox.tsx`, `components/ui/radio-group.tsx` (if present)
- `components/ui/switch.tsx` (if present)
- `components/ui/slider.tsx` (if present)
- `components/ui/calendar/date-picker.tsx` / range picker (if present)
- `components/ui/separator.tsx` (if present)
- `components/ui/skeleton.tsx`
- `components/ui/alert.tsx`
- `components/ui/toast.tsx` / sonner/toast system
- `components/ui/progress.tsx` (if present)
- `components/ui/avatar.tsx` (if present)
- `components/ui/scroll-area.tsx` (if present)

### 11.3 Feature Components (Data/Analytics)
- `components/datasets/dataset-view.tsx`
- `components/data-sources/external-db-form.tsx`
- `components/data-sources/external-db-url.tsx`
- `components/imports/upload-form.tsx`
- `components/imports/reimport-form.tsx`
- `components/imports/history-view.tsx`
- `components/mapping/mapping-dialog.tsx`
- `components/data-quality/data-quality-view.tsx` (if present)
- `components/dashboard/dashboard-render.tsx`
- `components/dashboard/kpi-card.tsx` / StatCard
- `components/dashboard/chart-card.tsx`
- `components/charts/*` (any chart wrappers)
- `components/filters/date-filters.tsx`

### 11.4 AI Surfaces
- `components/ai/ai-analyst.tsx`
- `components/ai/ai-analyst-chat.tsx`
- `components/ai/ai-evidence-panel.tsx`
- `components/ai/ai-investigation.tsx`
- `components/ai/ai-simulator.tsx`
- `components/ai/message-bubble.tsx`, `components/ai/tool-call-card.tsx`, `components/ai/typing-indicator.tsx`, `components/ai/code-block.tsx`, `components/ai/markdown-render.tsx` (if present)

### 11.5 Automation/Notifications/Reports
- `components/alerts/alerts-list.tsx`, `components/alerts/alert-form.tsx`
- `components/alert-rules/alert-rules-list.tsx`, `components/alert-rules/alert-rule-form.tsx`
- `components/recommendations/recommendations-list.tsx`
- `components/notifications/notifications-list.tsx`
- `components/reports/reports-list.tsx`, `components/reports/report-form.tsx`
- `components/report-schedules/report-schedules-list.tsx`, `components/report-schedules/report-schedule-form.tsx`

### 11.6 Auth/Onboarding/Shared
- `components/auth/login-form.tsx`
- `components/auth/register-form.tsx`
- `components/onboarding/*` (if any)
- `components/common/page-header.tsx`, `components/common/empty-state.tsx`, `components/common/error-state.tsx`, `components/common/loading-state.tsx`, `components/common/stat-card.tsx`, `components/common/chart-card.tsx`

### 11.7 Utilities/Providers
- `components/theme/*` (if theme toggle exists)
- `app/providers.tsx` (theme provider integration if applicable)

**Rule:** Redesign each shared component once (shared level). Page-level components restyle via tokens/shared components.

## 12. Skills (To Use)

Load/consider these from `.opencode/skills/` during implementation:
- `frontend-design` — UI design generation, premium aesthetics
- `ui-ux-engineering` — production-grade UI/UX, states, accessibility, Tailwind/shadcn
- `ui-ux-pro-max` — 67 styles/palettes, charts/stacks, design intelligence
- `design-to-code` — pixel-accurate conversion from refs/images to code
- `code-quality` — structure, typing, error handling, no monoliths (MUST load when editing TS/TSX)

## 13. Libraries Required (Search & Justify)

**Existing (check first):** Next 15, React 19, TS, Tailwind CSS v4, lucide-react (likely), clsx, tailwind-merge, recharts? (charts exist in tests/components). Vitest/RTL.

**Recommended additions (only if not present; avoid unnecessary deps):**
- **Animations:** `framer-motion@^11` — justified only for complex enter/exit (modals/sheets, AI streaming orchestration, staggered lists). Prefer CSS first. If unused, skip.
- **Charts:** Prefer existing chart lib. If missing, `recharts@^2.15` (TS, responsive, dark-friendly, tooltip customization). Do not switch if existing works.
- **Icons:** Lucide (existing) — enforce single set, consistent sizing.
- **Toasts:** Existing (sonner or custom). Keep as-is if present, restyle only.
- **Utils:** keep clsx/tailwind-merge (cn). Add nothing extra unless required.
- **Accessibility:** no new heavy deps.

**Constraint:** Keep dependencies minimal. Search `frontend/package.json` before adding any.

## 14. Success Criteria

- All existing routes/pages/components visually redesigned per design.md + refs
- Dark theme matches specified tokens across entire app
- AppShell, Sidebar, Topbar fully restyled and consistent
- Dashboard, AI surfaces, Data Hub, Automation match premium SaaS aesthetic
- Charts/graphs match tooltip/grid/style from refs
- Animations subtle, respect reduced-motion, performant
- Fully responsive (320–1920+), no horizontal overflow
- Accessibility: visible focus rings, semantic HTML, ARIA, contrast AA
- **Zero functional regressions**: all existing features/routes/APIs/auth work
- Visual consistency: shared components drive 90%+ of styling
- Lint, typecheck, build pass; unit/integration tests still valid (behavior preserved). Update tests only if they assert brittle classnames (prefer behavior assertions)
- No fabricated/mock data introduced

## 15. Assumptions

- Existing codebase is Next.js App Router + TS + Tailwind v4
- Reference images are primary visual benchmark
- design.md is exhaustive directive; implement per steps
- Redesign via tokens + shared components (not per-page one-offs)
- Real data always used for charts/dashboards

## 16. Out of Scope

Light-mode redesign from scratch, new features, API/schema changes, backend logic changes.