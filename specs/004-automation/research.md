# Research: Phase 4 — Automation

**Feature**: `004-automation`
**Status**: Draft (pending user verification)
**Date**: 2026-09-26
**Source of truth**: root `research.md` §7 (AI agent/tool architecture), §9 (queue architecture), §14 (roadmap) + `architecture.md` (§60 first development milestone, §61 final product principle) + `.specify/memory/constitution.md` (v1.0.0)
**Scope**: Resolve the Phase 4 technical questions R1–R6 documented below. Design documents only — no code locked before user verification.

---

## R1 — Automation job types and queue pattern

Phase 4 reuses the Phase 2/3 queue architecture unchanged: the `jobs` table remains the system of record; Redis is an optional signal layer; table-polling fallback when Redis is unavailable (ADR-005). No new queue technology is introduced. New job types are registered:

```text
RUN_ANOMALY_DETECTION   — background worker scans analytics-ready datasets
EVALUATE_ALERT_RULES    — background worker evaluates alert rules on schedule
GENERATE_REPORT         — background worker renders report content
SEND_EMAIL              — background worker delivers via email provider
```

The `SEND_EMAIL` job type is the same pattern as `RUN_ANALYST` (enqueue → claim → run → persist). The anomaly/alert/report evaluators are scheduled by a `node-cron` scheduler or worker timer that LPUSHes the corresponding job into the queue; the worker claims and runs it.

**Decision**: Reuse the Phase 3 jobs-table + Redis-signal pattern; add 4 new job types; cron scheduler in the worker loop.

---

## R2 — Anomaly detection algorithm

The anomaly worker extends the existing basic `find_anomalies` tool (Phase 3) into a full detector that runs on a schedule. For each analytics-ready dataset and each canonical metric (Revenue, Orders, Customers, Expenses, Profit, Inventory — per `metric-catalog.ts`):

- **Baseline**: trailing N periods (configurable, default 4) aggregated via `calculate_metric` (same aggregation as the metric definition — SUM for Revenue/Expenses/Profit/Inventory, COUNT for Orders/Customers).
- **Observed**: the most recent completed period aggregated the same way.
- **Deviation**: `deviationPct = |observed − baseline| / |baseline| × 100` (with a guard against baseline = 0 — treat any nonzero observed as anomalous).
- **Threshold**: `deviationPct >= deviationThreshold` (configurable, default 30%) to emit an anomaly.
- **Status**: `OPEN` (new detection) or skipped (no anomaly / insufficient data / dataset not ready).

The worker writes one `AnomalyDetection` row per metric per scan that meets the threshold. Baseline and observed are stored as JSON `{ period, value }` for traceability.

**Decision**: Deterministic IQR/deviation via the existing analytics pipeline; one `AnomalyDetection` row per threshold-crossing metric/period; baseline configurable.

---

## R3 — Recommendations generation and aggregation

Recommendations are generated as a periodic bulk read-through over the active signals:

1. New `AnomalyDetection` rows with `status: OPEN`.
2. New `Alert` rows with `status: OPEN` (from alert rules).
3. Existing investigation findings and simulation results that are actionable (signals from Phase 3 remain).
4. System signals (e.g., dataset just became analytics-ready, import completed).

For each signal a `Recommendation` row is created with:
- `severity` derived from deviation magnitude (HIGH/CRITICAL for large deviations, MEDIUM/LOW for smaller) or the rule's alert severity.
- `source` = `ANOMALY` | `INVESTIGATION` | `RULE` | `SIMULATION` | `SYSTEM`.
- `evidence` = a summary JSON (dataset name, metric, period, baseline vs observed, rule name if applicable).
- `suggestedAction` = a short, deterministic text derived from the signal type (never invented by an LLM).

Duplicate signals for the same metric/period/source are merged by a dedup key (`source + metricId/ruleId + period`) so the surface shows one recommendation per signal.

**Decision**: Bulk read-through batch job; severity derived from signal magnitude; `suggestedAction` deterministic (no LLM); dedup by composite key.

---

## R4 — Alert rule evaluation

The alert evaluator runs on each rule's frequency (a `node-cron` expression or fixed interval). For each `enabled = true` rule:

1. Resolve the rule's `metricKind` and its current value via `calculate_metric` over the dataset's current period.
2. Evaluate the `condition` against `threshold`:
   - `GREATER_THAN`: `currentValue > threshold`
   - `LESS_THAN`: `currentValue < threshold`
   - `EQUAL_TO`: `currentValue == threshold`
   - `CHANGES_BY`: `|(currentValue − previousValue)| / |previousValue| × 100 >= threshold`
3. Deduplicate: if an `OPEN` alert exists for the same `ruleId` within the deduplication window (configurable, default 60 minutes), suppress.
4. If condition met and not deduped: create an `Alert` record (`status: OPEN`, severity from rule, message from template, evidence JSON).
5. Enqueue `SEND_EMAIL` to the rule's recipients and create an in-app notification.

A disabled rule (`enabled = false`) is skipped. A rule whose dataset is not analytics-ready is skipped for that metric.

**Decision**: Evaluate via the existing analytics pipeline; dedup by `ruleId + period`; in-app notification + email enqueue on fire; disabled/non-ready rules skipped.

---

## R5 — Report generation and scheduling

A `ReportSchedule` drives `GENERATE_REPORT` jobs via cron. When the job runs:

1. Load the `Report` + its configured metrics/widgets (referencing existing dashboard widget definitions or metric definitions).
2. Compute each metric's current value via `calculate_metric`.
3. Render the `content` as a structured JSON blob: `{ title, generatedAt, metrics: [{ name, kind, value, unit }], ... }`.
4. Persist: `Report.status` transitions `DRAFT` → `GENERATED`; `content` populated. On failure: `DRAFT` → `FAILED` with sanitized error.
5. Advance `ReportSchedule.nextRunAt` to the next cron occurrence; if `enabled`, the next cycle fires.

Report content references existing dashboard/metric definitions — no new visualization engine is added (reuse Phase 2 recharts/dashboard widgets).

**Decision**: Report content is a computed JSON blob from existing metrics; reuse dashboard metric definitions; cron-driven; DRAFT→GENERATED/FAILED transitions.

---

## R6 — Email service, templates, and notifications

One reusable email service (`email.service.ts`) with:

- `send({ to, subject, body, template })` that creates a `SEND_EMAIL` job and returns the `EmailDelivery` id.
- The `SEND_EMAIL` worker handler claims the job, invokes the mailer, and transitions `EmailDelivery.status` (`QUEUED` → `SENT` / `FAILED` / `BOUNCED`).
- **Templates**: simple text/HTML strings; the template name and variables are passed at send time; the service resolves the template content. Templates are defined in a `email-templates.ts` module (not a full engine). Business logic (alert/report) constructs the body; the service sends.
- **Development log sink**: when `SMTP_HOST` is not configured, the service logs the send (to, subject, body) and marks `EmailDelivery` as `SENT` for verification. When `SMTP_HOST` is configured, `nodemailer` delivers the email to the configured recipients.
- **In-app notifications**: each new `Recommendation` (OPEN) and `Alert` (OPEN) creates a notification record. A notification inbox lists them with an unread count badge. Marking read sets `isRead = true`.

The `EmailDelivery` record captures: `jobId?`, `from`, `to` (JSON), `subject`, `template`, `error?`, `sentAt`.

**Decision**: One email service; `SEND_EMAIL` job; `nodemailer` SMTP delivery (real email to configured recipients); dev log sink when SMTP not configured; templates as simple text/HTML; in-app notifications derived from OPEN recommendations/alerts with `isRead` flag.

---

## R7 — PDF export for reports

Reports support PDF export alongside JSON content. The `Report` model has a nullable `pdfUrl` field. PDF generation uses `pdfkit` to convert the structured JSON content into a downloadable PDF.

**Decision**: `pdfkit` for PDF generation; `pdfUrl` stored on `Report` record; PDF generation is a background job (extending `GENERATE_REPORT`).

---

## Resolved / open questions

Resolved for Phase 4:
1. **Queue**: jobs-table system of record retained; Redis optional signal; 4 new job types (R1).
2. **Anomaly detection**: deterministic via existing analytics pipeline; baseline configurable (R2).
3. **Recommendations**: bulk read-through; deterministic `suggestedAction`; dedup by composite key (R3).
4. **Alert rules**: evaluate via analytics; dedup by `ruleId + period`; in-app + email on fire (R4).
5. **Reports**: JSON content blob from existing metric definitions; cron-driven; DRAFT→GENERATED/FAILED (R5).
6. **Email**: `nodemailer` SMTP delivery; dev log sink; in-app notifications (R6).
7. **PDF export**: `pdfkit`; `pdfUrl` on Report (R7).

Deferred (defaults chosen):
- SSE/real-time push: in-app notifications update via polling (same pattern as Phase 3 chat) — push deferred to a later phase.
- A dedicated `Notification` model: satisfied by querying `Recommendation`/`Alert` with `status: OPEN` + `isRead`; a richer notification model can be added later if needed.
- Template engine: simple text/HTML strings; a full template engine is out of scope.
- Multi-channel delivery (Slack, SMS): email only in Phase 4; other channels deferred.
