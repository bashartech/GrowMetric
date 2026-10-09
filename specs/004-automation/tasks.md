---
description: "Task list for Phase 4 — Automation"
---

# Tasks: Phase 4 — Automation

**Input**: Design documents from `/specs/004-automation/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: INCLUDED — the phase gate (plan.md) and FR-008 require unit + integration (tenant-isolation-based) tests in every phase.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to the spec's user stories
- Exact file paths are included in every task

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`, `backend/prisma/`
- Frontend: `frontend/app/`, `frontend/components/`, `frontend/hooks/`, `frontend/lib/`, `frontend/tests/`
- Automation logic: `backend/src/modules/{anomalies,recommendations,alerts,reports,notifications}/` and `backend/src/lib/email/`
- Job handlers: `backend/src/workers/handlers/`
- No LLM/provider mock needed here (no AI) — tests use deterministic analytics fixtures and in-memory sinks

---

## Phase 1: Setup (Add Automation Dependencies + Env)

**Purpose**: Add Phase 4 dependencies, environment variables, and the email provider stub on top of the Phase 3 foundation.

- [x] T078 Extend `backend/package.json` with `node-cron` (scheduler), `nodemailer` (SMTP email delivery), and `pdfkit` (PDF export); add `@types/node-cron`, `@types/nodemailer`, `@types/pdfkit` as dev deps
- [x] T079 Extend `backend/src/config/env.ts` + `backend/.env.example` with zod-validated vars: `ANOMALY_SCAN_INTERVAL_MS`, `ANOMALY_DEVIATION_THRESHOLD`, `ALERT_DEDUP_WINDOW_MS`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `REPORT_MAX_RETRIES`; fail-fast with redacted errors
- [x] T080 [P] Extend pino redaction in `backend/src/lib/logger.ts` to redact `SMTP_PASS`/email-credential patterns; add redaction unit test in `backend/tests/unit/logger.test.ts` (fails if credential leaks)
- [x] T081 [P] Create `backend/tests/fixtures/automation/` — deterministic metric fixtures for anomaly/alert/report tests (datasets with known revenue/order sequences spanning multiple periods)

**Checkpoint**: ✅ Dependencies install; env loader validates automation vars; logger redaction test passes; fixtures load deterministically.

---

## Phase 2: Database (Blocking Prerequisites)

**Purpose**: Prisma models for the 7 new entities + 12 enums + migration. Blocks all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database

- [x] T082 [P] Extend `backend/prisma/schema.prisma` with the 7 Phase 4 models + 12 enums from data-model.md (AnomalyDetection, Recommendation, AlertRule, Alert, Report, ReportSchedule, EmailDelivery; enums: AnomalyStatus, RecommendationSeverity, RecommendationSource, RecommendationStatus, AlertCondition, AlertRuleFrequency, AlertSeverity, AlertStatus, ReportKind, ReportStatus, ReportScheduleFrequency, EmailDeliveryStatus)
- [x] T083 Generate and apply the migration: `npx prisma migrate dev --name automation` and `npx prisma generate`

**Checkpoint**: ✅ DB migrates; `prisma validate` clean; all 7 models + 12 enums queryable.

---

## Phase 3: Email Service (Foundational — shared by alerts, reports, notifications)

**Purpose**: The reusable email service, templates, provider, and `SEND_EMAIL` job handler. Blocks alert firing and report email delivery.

**⚠️ CRITICAL**: No alert/report email story work can begin until this phase is complete.

- [x] T084 [P] Implement `backend/src/lib/email/email.service.ts`
- [x] T085 [P] Implement `backend/src/lib/email/email-templates.ts`
- [x] T086 [P] Implement `backend/src/lib/email/email.provider.ts`
- [x] T087 [P] Implement `backend/src/workers/handlers/send-email.ts`
- [x] T088 [P] Add foundation unit tests: `backend/tests/unit/email-service.test.ts`, `backend/tests/unit/email-templates.test.ts`, `backend/tests/unit/email-provider.test.ts`
- [x] T089 [P] Add unit tests: `backend/tests/unit/send-email.test.ts`

**Checkpoint**: ✅ `send()` creates `EmailDelivery` in `QUEUED`; worker transitions to `SENT` (log sink) or `FAILED`; template resolution works; no real email in dev without SMTP env vars.

---

## Phase 4: User Story 1 — Anomaly Detection (Priority: P1) 🎯 MVP

**Goal**: Background worker scans analytics-ready datasets and detects metric deviations; persists `AnomalyDetection` rows.

**Independent Test**: Point the worker at a dataset with a spiked metric; confirm an `AnomalyDetection` row exists with `deviationPct`, `baseline`, `observed`; stable metric emits none; non-ready dataset is skipped.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T090 [P] [US1] Unit test: detector computes `deviationPct` and emits `AnomalyDetection` for a spiked metric; stable metric emits none in `backend/tests/unit/anomaly-detector.test.ts`
- [x] T091 [P] [US1] Unit test: non-analytics-ready dataset (DRAFT, READY_WITH_WARNINGS) is skipped; insufficient-history metric is skipped with a reason in `backend/tests/unit/anomaly-detector.test.ts`
- [x] T092 [P] [US1] Integration test: `RUN_ANOMALY_DETECTION` job claims → scans → persists `AnomalyDetection` rows in `backend/tests/integration/anomaly-detections.test.ts`
- [x] T093 [P] [US1] Integration test: tenant isolation — foreign anomaly id → `NOT_FOUND`; cross-tenant access denied in `backend/tests/integration/anomaly-detections.test.ts`
- [x] T094 [P] [US1] Component test: anomaly list page with filter (dataset/period/status) and detail view in `frontend/tests/unit/anomaly-list.test.tsx`

### Implementation for User Story 1

- [x] T095 [US1] Implement `backend/src/modules/anomalies/anomaly.schema.ts` + `anomaly.service.ts` — `scan()` (iterates analytics-ready datasets × canonical metrics, computes baseline vs observed via `comparePeriods`, emits `AnomalyDetection`), `list()`, `get()`, `acknowledge()`/`resolve()`
- [x] T096 [US1] Implement `backend/src/modules/anomalies/anomaly.controller.ts` + `routes.ts`: `GET /ai/anomaly-detections`, `GET /ai/anomaly-detections/:id`, `PATCH /ai/anomaly-detections/:id/status` (per contracts/anomaly-detections.md); mount `/ai` under `/api/v1` in `backend/src/app.ts`
- [x] T097 [US1] Implement `backend/src/workers/handlers/run-anomaly-detection.ts` — cron-scheduled job: claim → `anomaly.service.scan()` → persist rows; `ANOMALY_SCAN_INTERVAL_MS` configurable; skips non-ready datasets
- [x] T098 [US1] Extend `frontend/lib/api-client.ts` (async anomaly list/get/status) and mirror anomaly DTOs in `frontend/lib/types.ts`
- [x] T099 [US1] Implement `frontend/app/(app)/ai/anomaly-detections/page.tsx` (list + filters) and `frontend/components/ai/anomaly-card.tsx` (deviation, period, kind, status)
- [x] T100 [US1] Run and fix US1 tests; verify a typical spike settles within the worker interval and is traceable to `calculate_metric` (SC-001, SC-002)

**Checkpoint**: ✅ US1 backend + frontend complete; anomalies trace to the analytics pipeline; non-ready datasets skipped; tenant isolation verified.

**Phase 4 Gate**: ✅ PASSED — 269/269 unit tests, typecheck clean, lint clean.

---

## Phase 5: User Story 2 — Recommendations (Priority: P1)

**Goal**: Bulk read-through aggregation of anomalies, alerts, investigations, simulations, and system signals into a single `Recommendation` surface with severity, source, evidence, and optional suggested action; user can acknowledge/resolve/dismiss.

**Independent Test**: With anomalies and alerts present, recommendations surface shows items with severity/source/evidence; acknowledge one → status updates; filter by source works.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T101 [P] [US2] Unit test: aggregator builds `Recommendation` rows from anomalies + alerts with correct severity/source/evidence in `backend/tests/unit/recommendation-aggregator.test.ts`
- [X] T102 [P] [US2] Unit test: dedup merges duplicate signals for the same metric/period/source into one recommendation in `backend/tests/unit/recommendation-aggregator.test.ts`
- [X] T103 [P] [US2] Integration test: `RUN_ANOMALY_DETECTION` → recommendations surface shows new items; `PATCH /ai/recommendations/:id/status` → status transitions in `backend/tests/integration/recommendations.test.ts`
- [X] T104 [P] [US2] Integration test: filter by severity/source returns only matching recommendations in `backend/tests/integration/recommendations.test.ts`
- [X] T105 [P] [US2] Component test: recommendations list + filter + detail + acknowledge/resolve/dismiss in `frontend/tests/unit/recommendations.test.tsx`

### Implementation for User Story 2

- [X] T106 [US2] Implement `backend/src/modules/recommendations/recommendation.schema.ts` + `recommendation.service.ts` — `generate()` (bulk read-through of OPEN anomalies + alerts + investigation/simulation signals → `Recommendation` rows with deterministic `suggestedAction`), `list()`, `get()`, `updateStatus()`
- [X] T107 [US2] Implement `backend/src/modules/recommendations/recommendation.controller.ts` + `routes.ts`: `GET /ai/recommendations`, `GET /ai/recommendations/:id`, `PATCH /ai/recommendations/:id/status` (per contracts/recommendations.md); mount in app.ts
- [X] T108 [US2] Extend `backend/src/workers/handlers/run-anomaly-detection.ts` — after scanning, call `recommendation.service.generate()` to refresh recommendations
- [X] T109 [P] [US2] Extend `frontend/lib/api-client.ts` (async recommendation list/get/status) and mirror recommendation DTOs in `frontend/lib/types.ts`
- [X] T110 [US2] Implement `frontend/app/(app)/ai/recommendations/page.tsx` (list + filters + unread badge) and `frontend/components/ai/recommendation-card.tsx` (severity, source, evidence, suggested action, acknowledge/resolve/dismiss)
- [X] T111 [US2] Run and fix US2 tests; verify the surface consolidates all signals and acknowledges atomically (SC-003)

**Checkpoint**: ✅ US1–US2 functional; recommendations consolidate anomalies/alerts/signals; status transitions atomic.

**Phase 5 Gate**: ✅ PASSED — 286/286 unit tests, typecheck clean, lint clean.

---

## Phase 6: User Story 3 — Alert Rules and Alerts (Priority: P1)

**Goal**: Users configure alert rules (metric, condition, threshold, frequency, recipients); the evaluator runs on schedule and fires `Alert` records with email + in-app notification.

**Independent Test**: Create a rule whose threshold the current metric exceeds; run the evaluator; confirm `Alert` record + `EmailDelivery` + notification with unread badge.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T112 [P] [US3] Unit test: evaluator condition logic (`GREATER_THAN`, `LESS_THAN`, `EQUAL_TO`, `CHANGES_BY`) against metric values in `backend/tests/unit/alert-evaluator.test.ts`
- [X] T113 [P] [US3] Unit test: dedup suppresses repeated firings within the dedup window in `backend/tests/unit/alert-evaluator.test.ts`
- [X] T114 [P] [US3] Integration test: `EVALUATE_ALERT_RULES` job creates `Alert` + `EmailDelivery` + notification in `backend/tests/integration/alerts.test.ts`
- [X] T115 [P] [US3] Integration test: disabled rule and non-ready dataset are skipped; cross-tenant access denied in `backend/tests/integration/alerts.test.ts`
- [X] T116 [P] [US3] Component test: alert rules CRUD + alerts list + status update + notification badge in `frontend/tests/unit/alert-rules.test.tsx`

### Implementation for User Story 3

- [X] T117 [US3] Implement `backend/src/modules/alerts/alert-rule.schema.ts` + `alert-rule.service.ts` — CRUD (create/update/enable/disable), `evaluate()` (resolve current metric via `calculate_metric`, evaluate condition, dedup, create `Alert`)
- [X] T118 [US3] Implement `backend/src/modules/alerts/alert-rule.controller.ts` + `routes.ts`: `POST /ai/alert-rules`, `GET /ai/alert-rules`, `GET /ai/alert-rules/:id`, `PATCH /ai/alert-rules/:id` (per contracts/alert-rules.md); mount in app.ts
- [X] T119 [US3] Implement `backend/src/modules/alerts/alert.service.ts` + `alert.controller.ts` + `routes.ts`: `GET /ai/alerts`, `GET /ai/alerts/:id`, `PATCH /ai/alerts/:id/status` (per contracts/alerts.md)
- [X] T120 [US3] Implement `backend/src/workers/handlers/evaluate-alert-rules.ts` — cron-scheduled job: claim → iterate enabled rules → `alert-rule.service.evaluate()` → create `Alert` + enqueue `SEND_EMAIL` + create notification
- [X] T121 [P] [US3] Extend `frontend/lib/api-client.ts` (async alert-rule CRUD + alerts list/status) and mirror alert DTOs in `frontend/lib/types.ts`
- [X] T122 [US3] Implement `frontend/app/(app)/ai/alert-rules/page.tsx` (CRUD form) and `frontend/app/(app)/ai/alerts/page.tsx` (list + detail + status) + `frontend/components/ai/alert-rule-form.tsx`, `alert-card.tsx`
- [X] T123 [US3] Extend notification badge: unread count from `Recommendation`/`Alert` `status: OPEN` + `isRead: false`
- [X] T124 [US3] Run and fix US3 tests; verify alert rules evaluate on schedule with dedup; no duplicate alerts (SC-004)

**Checkpoint**: ✅ US1–US3 functional; alert rules configure, evaluate, fire alerts + email + notification with dedup.

---

## Phase 7: User Story 4 — Scheduled Reports (Priority: P2)

**Goal**: Users create reports (weekly/monthly/custom) from dashboard metrics; schedules auto-generate report content on cron.

**Independent Test**: Create a weekly report + schedule; advance to the scheduled time; confirm `Report.status: GENERATED` and `content` populated; schedule `nextRunAt` advanced.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T125 [P] [US4] Unit test: report renderer computes metric values into a structured JSON `content` blob from configured metric keys in `backend/tests/unit/report-renderer.test.ts`
- [X] T126 [P] [US4] Unit test: PDF generation from JSON content produces a valid PDF file at `pdfUrl` via `pdfkit` in `backend/tests/unit/pdf-renderer.test.ts`
- [X] T127 [P] [US4] Unit test: scheduler advances `ReportSchedule.nextRunAt` correctly for daily/weekly/monthly/custom cron in `backend/tests/unit/report-scheduler.test.ts`
- [X] T128 [P] [US4] Integration test: `GENERATE_REPORT` job renders `Report.content` + `pdfUrl`, transitions `DRAFT→GENERATED`, advances schedule in `backend/tests/integration/reports.test.ts`
- [X] T129 [P] [US4] Integration test: generation failure transitions `DRAFT→FAILED` with sanitized error; disabled schedule skipped in `backend/tests/integration/reports.test.ts`
- [X] T130 [P] [US4] Component test: report list + detail + create form + schedule management + PDF download in `frontend/tests/unit/reports.test.tsx`

### Implementation for User Story 4

- [X] T131 [US4] Implement `backend/src/modules/reports/report.schema.ts` + `report.service.ts` — `create()`, `list()`, `get()`, `generate()` (compute metrics via `calculate_metric`, build `content` JSON blob, render PDF via `pdfkit` to `pdfUrl`), `listSchedules()`, `getSchedule()`, `updateSchedule()`
- [X] T132 [US4] Implement `backend/src/modules/reports/report.controller.ts` + `routes.ts`: `POST /ai/reports`, `GET /ai/reports`, `GET /ai/reports/:id`, `POST /ai/reports/:id/generate` (per contracts/reports.md); mount in app.ts
- [X] T133 [US4] Implement `backend/src/modules/reports/report-schedule.controller.ts` + `routes.ts`: `POST /ai/report-schedules`, `GET /ai/report-schedules`, `GET /ai/report-schedules/:id`, `PATCH /ai/report-schedules/:id` (per contracts/report-schedules.md); mount in app.ts
- [X] T134 [US4] Implement `backend/src/workers/handlers/generate-report.ts` — `GENERATE_REPORT` job: claim → `report.service.generate()` → persist `content` + `pdfUrl` → advance `ReportSchedule.nextRunAt`; `REPORT_MAX_RETRIES` on failure
- [X] T135 [US4] Extend `backend/src/workers/index.ts` — register `GENERATE_REPORT` + `EVALUATE_ALERT_RULES` in the node-cron scheduler (alert evaluator + report schedule runner)
- [X] T136 [P] [US4] Extend `frontend/lib/api-client.ts` + mirror report DTOs in `frontend/lib/types.ts`
- [X] T137 [US4] Implement `frontend/app/(app)/ai/reports/page.tsx` (list + detail + generate + PDF download) and `frontend/app/(app)/ai/report-schedules/page.tsx` (schedule CRUD) + `frontend/components/ai/report-card.tsx`, `report-schedule-form.tsx`
- [X] T138 [US4] Run and fix US4 tests; verify reports generate correct content and schedules advance (SC-005)

**Checkpoint**: ✅ US1–US4 functional; reports generate from metrics; schedules fire and advance.

---

## Phase 8: User Story 5 — Email Delivery + Notifications (Priority: P2)

**Goal**: Every notification is delivered through `SEND_EMAIL` via `nodemailer` SMTP (or dev log sink when SMTP is not configured) to the configured recipients (alert-rule owner/admin or report-schedule recipients); in-app notifications reflect new recommendations/alerts with an unread badge.

**Independent Test**: Trigger an alert → confirm `EmailDelivery` record + SMTP/log output + notification in inbox with unread badge.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [X] T139 [P] [US5] Integration test: `SEND_EMAIL` job → `EmailDelivery` `QUEUED→SENT` via SMTP or log sink in `backend/tests/integration/email-delivery.test.ts`
- [X] T140 [P] [US5] Integration test: `EmailDelivery` `FAILED` after max retries; SMTP configured path → real send in `backend/tests/integration/email-delivery.test.ts`
- [X] T141 [P] [US5] Integration test: new `Alert`/`Recommendation` → notification appears in inbox with unread badge; marking read clears badge in `backend/tests/integration/notifications.test.ts`
- [X] T142 [P] [US5] Component test: notification inbox + unread badge + mark-read in `frontend/tests/unit/notifications.test.tsx`

### Implementation for User Story 5

- [X] T143 [US5] Implement `backend/src/modules/notifications/notification.service.ts` + `notification.controller.ts` + `routes.ts`: `GET /ai/notifications`, `PATCH /ai/notifications/:id/read` (per contracts/alerts.md conventions for the inbox)
- [X] T144 [US5] Extend `backend/src/workers/handlers/evaluate-alert-rules.ts` and `run-anomaly-detection.ts` — when a new `Alert`/`Recommendation` (OPEN) is created, also create a notification record
- [X] T145 [US5] Extend `frontend/lib/api-client.ts` (async notification list/read) and mirror notification DTOs in `frontend/lib/types.ts`
- [X] T146 [US5] Implement `frontend/components/ai/notification-badge.tsx` (unread count) and `frontend/app/(app)/ai/notifications/page.tsx` (inbox + mark read)
- [X] T147 [US5] Run and fix US5 tests; verify every send produces a traceable `EmailDelivery` and in-app notifications reflect new signals with badge (SC-006, SC-007)

**Checkpoint**: ✅ US1–US5 functional; email delivery traceable; in-app notifications with badge; all tenant-scoped.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: ADRs, docs, logging, security, performance, quickstart, phase gate.

- [X] T148 [P] Create `backend/docs/automation-security-review.md` — security review of automation endpoints and email service
- [X] T149 [P] Create `backend/docs/automation-performance-review.md` — index and query pattern verification for new tables
- [X] T150 Extend `backend/src/workers/index.ts` + `backend/src/workers/registry.ts` — register `RUN_ANOMALY_DETECTION`, `EVALUATE_ALERT_RULES`, `GENERATE_REPORT`, `SEND_EMAIL`; cron scheduler wiring; Redis BRPOP signal consumption when `REDIS_URL` set; table-polling fallback
- [X] T151 [P] Add integration test: job signal path — enqueue `RUN_ANOMALY_DETECTION` → (mock Redis) signal consumed → job claims/completes; polling fallback when no Redis in `backend/tests/integration/queue-automation.test.ts`
- [X] T152 [P] Extend entitlement usage recording: automation features usage tracking (Phase 5 enforcement placeholder; best-effort `recordUsage`)
- [X] T153 Extend `frontend/lib/api-client.ts` and `frontend/lib/types.ts` — consolidate all automation DTOs; add run-progress polling helper for worker jobs
- [X] T154 [P] Add ADRs (if new architecture decisions emerge during implementation)
- [X] T155 Update `specs/004-automation/quickstart.md` with final env vars, migration commands, and verification steps
- [X] T156 Run the phase gate (commands documented in `phase4-completion-summary.md`): `npx prisma validate`, migration status, `npx tsc --noEmit`, `npm run lint`, full unit + integration suite

**Checkpoint**: ✅ All automation tasks complete; phase gate ready to run.

---

## Phase 10 — Phase Gate & Completion

**Purpose**: Verify the full automation suite passes the phase gate.

- [X] T157 Run the phase gate: `npx vitest run tests/unit`, `npx vitest run tests/integration`, `npx tsc --noEmit`, `npm run lint`, `npx prisma migrate status`, `npx prisma validate`
- [X] T158 Fix any gate failures
- [X] T159 Create `specs/004-automation/phase4-completion-summary.md` with completion status and gate results
- [X] T160 Mark all tasks complete; report completion with branch name, spec path, checklist results, and readiness for the next phase

**Gate result**: PASS — all tests, type-check, lint, migrations, authorization, errors, docs verified. Ready for Spec 5 (Phase 5 — Hardening).

---

## Notes

- [P] tasks touch different files with no incomplete dependencies.
- Story labels provide traceability to spec.md.
- No fake data in any UI state (FR-019); empty/insufficient-data states are honest.
- No LLM/provider in automation — all computations are deterministic via the existing analytics pipeline; provider mocks are NOT used here.
- Email credentials never logged, returned, audited, or included in tool I/O (FR-008, Principle XII); pino redaction test T080 enforced. SMTP delivery to configured recipients when `SMTP_HOST` is set; dev log sink when not.
- `pdfkit` is the PDF generation library for report export (`pdfUrl` on `Report`).
- Commit after each task or logical group; never commit secrets, `.env`, or provider keys.
- Total tasks: **~83** (Setup 4, Database 2, Email Service 6, US1 11, US2 11, US3 13, US4 14, US5 9, Polish 9, Gate 4).
- Integration tests MUST NOT run while `npm run worker` is polling the shared database: the worker claims automation jobs and may intermittently return null/foreign jobs. Stop the worker during integration-test runs and restart it afterwards; run integration files serially.
- Anomaly/alert evaluator integration tests use the deterministic `FixedDataSource` fixture (no DB) or the real `sales.csv` fixture for end-to-end flows through the actual import → RUN_ANOMALY_DETECTION job.
