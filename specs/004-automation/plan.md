# Implementation Plan: Phase 4 — Automation

**Branch**: `004-automation` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-automation/spec.md`
**Design reference**: repository root `research.md` (§9 queues, §14 roadmap) and `architecture.md`; phase research in `./research.md`

## Summary

Deliver the automation layer of GrowMetrics on top of the Phase 3 AI layer: an **anomaly detection worker** that scans analytics-ready datasets and persists `AnomalyDetection` rows, a **Recommendations** surface consolidating anomalies, alerts, investigation findings, simulation outcomes, and system signals, **alert rules** that users configure and that auto-fire `Alert` records, **scheduled reports** generated from dashboard metrics, an **email service** that delivers every notification through a `SEND_EMAIL` job with a development log sink, and an **in-app notification inbox**. All work sits on top of the Phase 1/2/3 foundation (auth, tenancy, jobs table + Redis signal, analytic tools, metric catalog, entitlements, audit, datasets). All automation runs as background jobs; requests only enqueue and poll. No LLM is involved in automation — all computations are deterministic via the existing analytics pipeline.

## Technical Context

**Language/Version**: TypeScript 5.x; Node.js 20 LTS (ESM)
**Primary Dependencies**:
- Backend (new): `node-cron` for alert/report scheduling; `nodemailer` for SMTP email delivery; `pdfkit` for PDF export; email service uses `nodemailer` (SMTP delivery) with dev log sink fallback
- Backend (existing, reused): Express, Prisma, `zod`, `pino` (redact), jobs registry + worker loop + Redis signal (Phase 3), entitlement + audit middleware (Phase 1), analytic pipeline (`calculate_metric`, `compare_periods`, `group_by_dimension`, `buildAggregateQuery`), `metric-catalog`, `analytics-sql`
- Frontend (new): none beyond the existing stack (Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, `react-hook-form` + zod, TanStack Query, `recharts`, `lucide-react`); notification badge + recommendation/alert/report/list components
- Queue signal: `ioredis` when `REDIS_URL` is configured (jobs table remains system of record)
**Storage**: PostgreSQL on Neon via Prisma (7 new models + 12 new enums); no new object storage
**Testing**: Backend Vitest + Supertest (unit for anomaly detector, alert evaluator, recommendation aggregator, report renderer, email service, pdf renderer; integration for end-to-end job flows, tenant isolation, SMTP + log sink); Frontend Vitest + React Testing Library; provider behavior NOT mocked here (no LLM); Playwright remains Phase 5
**Target Platform**: Web (Node.js server + modern browsers); automation runs enqueued as jobs, never blocking requests
**Project Type**: Web application — two independent folders (`backend/`, `frontend/`)
**Performance Goals**: anomaly scan completes within a configurable interval (default 60 min); alert evaluator runs per rule frequency; report generation under 30 s per report; email delivery non-blocking
**Constraints**: no LLM in automation (all deterministic); every record tenant-scoped; cross-tenant denied; SMTP delivery to configured recipients when configured, dev log sink fallback when not; Redis optional signal with table-polling fallback; jobs table system of record; closed analytic tools only
**Scale/Scope**: Multi-organization SaaS; single user per workspace; 7 new Prisma models + 12 new enums; 5 new backend modules (anomaly, recommendation, alert, report, email) + 4 job handlers + 1 scheduler; 5 new frontend AI routes + recommendation/alert/report/list components + notification badge; 6 new API contracts; PDF export via pdfkit

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 2 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Data-First Architecture | Automation uses tools via the existing analytics pipeline; no invented figures in recommendations/suggested actions | PASS |
| II. Read-Only External DB | External DB access unchanged (Phase 2); anomaly/alert/report evaluation reads only platform storage analytics | PASS |
| III. Tenant Isolation | Every automation record scoped via authenticated org/workspace; cross-tenant tests required | PASS |
| IV. Least Privilege | Automation services get only the analytic tools; no shell/FS/secrets/credentials; SQL tool SELECT-only + bounded | PASS |
| V. AI Must Use Controlled Tools | N/A — no LLM in automation; closed analytic tools only | PASS |
| VI. Deterministic Calculations | All anomaly/baseline/alert/report math deterministic backend logic; no LLM | PASS |
| VII. Simulation Transparency | N/A for Phase 4 (Phase 3 covers simulation) | PASS |
| VIII. Evidence-Based AI | Recommendations carry evidence referencing underlying records | PASS |
| IX. Data Quality Before Intelligence | Anomaly/alert evaluators skip non-analytics-ready datasets | PASS |
| X. Async Processing for Expensive Operations | All automation runs are jobs; requests only enqueue; UI polls | PASS |
| XI. Security by Default | Zod on all bodies/queries/params; tenant predicate on every query; SMTP/log sink redacts | PASS |
| XII. Secrets Management | No credentials in email/tool I/O; pino redaction; `.env` gitignored | PASS |
| XIII. API Boundary | Frontend talks only to REST API; never Prisma/DB/Redis/Groq directly | PASS |
| XIV. Separation of Concerns | `routes → controllers → services → Prisma`; automation logic in services + job handlers; thin controllers | PASS |
| XV. Multi-Tenant Data Model | User → Organization → Workspace hierarchy preserved; all new models scoped by org + workspace | PASS |
| XVI. AI Not System of Record | Automation output never authoritative; numbers from stored data + validated calculations | PASS |
| XVII. Human Oversight | Recommendations are observations (not instructions); alerts are acknowledged/resolved by user | PASS |
| XVIII. Auditability | Automation events recorded; no secrets or payloads | PASS |
| XIX. Production Quality | Full vertical slices (UI + API + validation + auth + DB + errors + loading + logging + tests + security) per story | PASS |
| XX. Testing | Unit (detector, evaluator, aggregator, renderer, email service) + integration (job flows, tenant isolation, SMTP + log sink) + component UI + PDF rendering | PASS |
| XXI. Observability | AnomalyDetection + Recommendation + Alert + Report + EmailDelivery persisted; run IDs in logs; pino redaction | PASS |
| XXII. Performance | Analytic calls bounded (same as Phase 3); email non-blocking; report generation bounded; indexes on new tables | PASS |
| XXIII. Maintainability | Small typed modules; provider-abstraction seam reused; one purpose per dependency | PASS |
| XXIV. Specification Before Implementation | Spec + this plan + research precede implementation (this phase set) | PASS |
| XXV. No Silent Architecture Changes | Jobs-table system of record retained; Redis signal only (ADR-005); no new queue technology | PASS |
| XXVI. Definition of Done | Gate: spec satisfied, tests, type-check, lint, migrations, authorization, errors, docs | PASS |

**Gate result**: PASS — no violations require justification.

## Skills (loaded at implementation time to prevent common errors)

> The implementation agents must load the following skills before writing code for this phase. AGENTS.md documents them for every session.

- **code-quality** (repo `.opencode/skills/code-quality`) — MUST be loaded before ANY `.ts`/`.tsx` editing in this phase (structure, type safety, error handling, security).
- **nodejs / python / fastapi skills** — NOT applicable here (backend is Express/TypeScript).
- **ui-ux-engineering** (repo `.opencode/skills/ui-ux-engineering`) — recommendation/alert/report list components, notification badge, empty/states.

## Project Structure

### Documentation (this feature)

```text
specs/004-automation/
├── plan.md              # This file (/sp.plan command output)
├── spec.md              # Feature specification (story/FR/SC)
├── research.md          # Phase 0 output (R1–R7 technical decisions)
├── data-model.md        # Phase 1 output (7 entities + Prisma mapping)
├── quickstart.md        # Phase 1 output (run/verify guide)
├── contracts/           # Phase 1 output (API contracts)
│   ├── anomaly-detections.md
│   ├── recommendations.md
│   ├── alert-rules.md
│   ├── alerts.md
│   ├── reports.md
│   ├── report-schedules.md
│   └── errors.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/sp.tasks command)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma        # +7 Phase 4 models (12 new enums)
│   └── migrations/          # +1 migration (automation)
├── src/
│   ├── config/env.ts        # + ANOMALY_SCAN_INTERVAL_MS, ANOMALY_DEVIATION_THRESHOLD,
│   │                        #   ALERT_DEDUP_WINDOW_MS, EMAIL_FROM, SMTP vars
│   ├── lib/
│   │   └── email/           # Email service (NEW)
│   │       ├── email.service.ts   # send() → SEND_EMAIL job; SMTP/nodemailer + dev log sink
│   │       ├── email-templates.ts # template name/variable resolution
│   │       └── email.provider.ts  # nodemailer SMTP + log sink adapter
│   │       ├── pdf-renderer.ts     # pdfkit PDF generation from report content
│   ├── modules/
│   │   ├── anomalies/       # anomaly service + controller + routes (NEW)
│   │   ├── recommendations/ # recommendation service + controller + routes (NEW)
│   │   ├── alerts/          # alert service + controller + routes (NEW)
│   │   │                    # (alert-rules + alerts sub-modules)
│   │   ├── reports/         # report service + controller + routes (NEW)
│   │   └── notifications/   # notification inbox controller + routes (NEW)
│   └── workers/
│       ├── index.ts          # + node-cron scheduler for alert/report eval
│       ├── registry.ts       # register new job types
│       └── handlers/
│           ├── run-anomaly-detection.ts  # RUN_ANOMALY_DETECTION job
│           ├── evaluate-alert-rules.ts   # EVALUATE_ALERT_RULES job
│           ├── generate-report.ts        # GENERATE_REPORT job
│           └── send-email.ts           # SEND_EMAIL job
├── tests/
│   ├── unit/               # anomaly-detector, alert-evaluator, recommendation-aggregator,
│   │                       # report-renderer, email-service, pdf-renderer, log-sink, tenant-isolation
│   └── integration/        # anomaly-flow, alert-flow, report-generation, email-smtp-log-sink,
│                           # tenant-isolation-automation, job-signal
└── (jobs table, workers unchanged; ioredis activated)

frontend/
├── app/(app)/
│   ├── ai/
│   │   ├── recommendations/page.tsx   # recommendations surface (list + filter + detail)
│   │   ├── alerts/page.tsx            # alerts list + detail + status updates
│   │   ├── alert-rules/page.tsx       # alert rules management
│   │   ├── reports/page.tsx           # report list + detail + generate
│   │   └── report-schedules/page.tsx  # schedule management
│   └── ...
├── components/
│   ├── ai/                           # recommendation-card, alert-card, alert-rule-form,
│   │                                 # report-list, report-schedule-form, notification-badge,
│   │                                 # notification-inbox
│   └── ...
├── hooks/                            # use-recommendations, use-alerts, use-alert-rules,
│                                     # use-reports, use-report-schedules, use-notifications
└── lib/
    ├── api-client.ts                 # + Automation endpoints
    └── types.ts                      # + Phase 4 DTOs mirrored from contracts/
```

**Structure Decision**: Two-folder web application (backend + frontend), matching the ratified architecture. Automation logic is isolated in new `modules/` and `lib/email/` so each service is unit-testable without external dependencies. Worker handlers are thin wrappers that enqueue → claim → run → persist; all math lives in services. Frontend adds an `ai/` route group for the automation surfaces and reuses the existing `ai/` component set and TanStack Query hooks; no new frontend dependencies.

## Phase 0 — Research (summary; full detail in [research.md](./research.md))

Key decisions for Phase 4:

- **Queue**: jobs-table system of record retained; Redis optional signal; 4 new job types (R1).
- **Anomaly detection**: deterministic via existing analytics pipeline; baseline configurable (R2).
- **Recommendations**: bulk read-through batch job; deterministic `suggestedAction`; dedup by composite key (R3).
- **Alert rules**: evaluate via analytics; dedup by `ruleId + period`; in-app notification + email on fire (R4).
- **Reports**: JSON content blob from existing metric definitions; cron-driven; DRAFT→GENERATED/FAILED (R5).
- **Email**: one service; `SEND_EMAIL` job; dev log sink; in-app notifications from OPEN signals (R6).

## Phase 1 — Design & Contracts

- `data-model.md`: 7 Prisma models (AnomalyDetection, Recommendation, AlertRule, Alert, Report, ReportSchedule, EmailDelivery) + 12 enums, fields, relations, indexes.
- `contracts/`: anomaly-detections, recommendations, alert-rules, alerts, reports, report-schedules, errors (extends Phase 1/2/3 codes with automation codes).
- `quickstart.md`: env additions (automation vars, SMTP optional), worker + scheduler, verification steps incl. dev log sink smoke test.
