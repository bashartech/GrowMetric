# Feature Specification: Phase 4 — Automation

**Feature Branch**: `004-automation`
**Created**: 2026-09-26
**Status**: Draft
**Input**: User description: "Phase 4 Automation: anomaly detection worker that scans analytics-ready datasets and surfaces metric deviations from baselines, a Recommendations workspace surface listing actionable items drawn from anomalies, investigation findings, alert triggers and system signals with severity and evidence, Alert Rules that users configure per metric with threshold/condition/frequency and recipients and auto-fire Alert records, weekly/monthly/custom Reports auto-generated from dashboard metrics on a schedule, and an Email service plus background email worker that delivers through a queue with a development log sink and an in-app notifications inbox."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Anomaly Detection on Datasets (Priority: P1)

A background worker periodically scans each analytics-ready dataset's canonical metrics (Revenue, Orders, Customers, Expenses, Profit, Inventory). For every metric it compares the most recent observed period against a computed baseline (trailing prior periods), records the deviation, and persists an `AnomalyDetection` row when the deviation exceeds a statistical threshold. The anomaly is evidence-backed: baseline, observed values, deviation percentage, period, and the metric it belongs to are all stored. The detection feeds the Recommendations surface and can be inspected directly.

**Why this priority**: Anomaly detection is the primary automated signal — it is the engine behind most recommendations and alert triggers. Without it, the automation layer has no source of truth about what changed.

**Independent Test**: Point the worker at a dataset with a metric whose value changed sharply; confirm an `AnomalyDetection` row exists with the computed `deviationPct`, `baseline` and `observed` values, and that the status reflects the finding. Run the same against a stable metric and confirm no anomaly is emitted.

**Acceptance Scenarios**:

1. **Given** an analytics-ready dataset with a metric whose recent period value deviates from the trailing baseline beyond the configured threshold, **When** the anomaly worker runs, **Then** an `AnomalyDetection` row is persisted with `kind`, `period`, `baseline`, `observed`, `deviationPct`, and `status`.
2. **Given** a metric whose recent value stays within the baseline's expected range, **When** the worker runs, **Then** no `AnomalyDetection` row is emitted for that metric/period.
3. **Given** a dataset that is not analytics-ready (DRAFT, READY_WITH_WARNINGS), **When** the worker runs, **Then** the dataset is skipped and the run is recorded as skipped with a reason (never flagged as anomalous).
4. **Given** an `AnomalyDetection`, **When** it is inspected, **Then** its baseline, observed values, deviation percentage, and period are all present and traceable to the underlying metric computation.
5. **Given** a cross-tenant attempt, **When** an anomaly detection or its period is accessed by a foreign identifier, **Then** the request is denied and the attempt is recorded.

---

### User Story 2 - Recommendations Workspace (Priority: P1)

A labeled "What should I pay attention to" surface lists all actionable recommendations — generated from anomaly detections, investigation findings, alert triggers, simulation outcomes, and system signals. Each recommendation carries a severity (LOW, MEDIUM, HIGH, CRITICAL), a category, a short title and description, a `source` tag identifying where it came from (`ANOMALY`, `INVESTIGATION`, `RULE`, `SIMULATION`, `SYSTEM`), an evidence summary, and an optional suggested action. Recommendations are not instructions — they are observations the user can acknowledge, resolve, or dismiss. The surface is searchable/filterable by severity and source and is tenant-scoped.

**Why this priority**: This is the core "pay attention to" surface of the product — it answers architecture §61's fourth question ("What should we pay attention to or do next?"). It consolidates every automated signal into one place.

**Independent Test**: With anomalies and alerts present, open the recommendations surface and confirm items appear with severity, source, evidence and suggested action; acknowledge one and confirm its status updates; confirm the surface reflects the filter state (severity/source).

**Acceptance Scenarios**:

1. **Given** an analytics-ready dataset with a high-deviation anomaly, **When** recommendations are refreshed, **Then** a recommendation with `severity: HIGH`, `source: ANOMALY`, and matching evidence is listed.
2. **Given** a user opens the recommendations surface, **When** they acknowledge a recommendation, **Then** its status becomes `ACKNOWLEDGED` and the unread badge updates; resolve/dismiss transitions to `RESOLVED` / `DISMISSED`.
3. **Given** multiple recommendation sources, **When** the user filters by `source`, **Then** only recommendations from that source are shown.
4. **Given** a recommendation, **When** it is inspected, **Then** its evidence summary (dataset, metric, period, values) is viewable and traceable to the underlying records.
5. **Given** a cross-tenant attempt, **When** any recommendation or finding is accessed by a foreign identifier, **Then** the request is denied and recorded.

---

### User Story 3 - Alert Rules and Auto-Firing Alerts (Priority: P1)

Users define alert rules on workspace metrics: choose a metric, a condition (greater than, less than, equal to, changes by percentage), a numeric threshold, a frequency (daily/weekly/monthly/custom cron), and recipients. The system evaluates each rule on its schedule; when the condition is met against the current metric value, it creates an `Alert` record with a title, severity, message, evidence, and the matched threshold. Each alert fires through the email queue to the rule's recipients (and appears in the in-app notification inbox). Rules can be enabled/disabled, and repeated firings are deduplicated within a configurable window so the inbox is not flooded.

**Why this priority**: Alert rules give users proactive control — they define what matters and the system watches it automatically. This is the "do next" counterpart to the anomaly signal's "pay attention."

**Independent Test**: Create a rule with a threshold the current metric already exceeds; run the evaluator; confirm an `Alert` record is created with the matched threshold and evidence, and that the inbox shows the notification.

**Acceptance Scenarios**:

1. **Given** an alert rule where the current metric value exceeds the threshold, **When** the evaluator runs, **Then** an `Alert` record is created with the rule ID, title, severity, message, evidence, and `status: OPEN`.
2. **Given** a metric value that does not meet any rule's condition, **When** the evaluator runs, **Then** no alert is created.
3. **Given** an alert rule that has already fired for the same metric within the deduplication window, **When** the evaluator runs again, **Then** a duplicate alert is suppressed (the existing `OPEN` alert is left untouched).
4. **Given** a user disables a rule, **When** the evaluator runs, **Then** no new alerts are created for that rule and the rule's `enabled` is `false`.
5. **Given** a cross-tenant attempt, **When** any alert or rule is accessed by a foreign identifier, **Then** the request is denied and recorded.

---

### User Story 4 - Scheduled Reports (Priority: P2)

Users create reports (weekly, monthly, or custom) that auto-generate from the workspace's dashboard metrics. A report defines a kind, a title, and the metric/dashboard widgets to include. The system renders the report content into a structured JSON blob and persists it as a `Report` record (`DRAFT` → `GENERATED`). Reports run on a `ReportSchedule` (frequency + cron + timezone + recipients). A generated report can be viewed or shared.

**Why this priority**: Scheduled reports consolidate the "what's happening" and "what to pay attention to" views into a periodic artifact — a natural companion to alerts, but less time-critical.

**Independent Test**: Create a weekly report and a schedule; advance to the scheduled time; confirm the report status becomes `GENERATED` with the title and content populated; confirm the schedule's `nextRunAt` advanced.

**Acceptance Scenarios**:

1. **Given** a report with a schedule, **When** the schedule fires, **Then** the report's `status` becomes `GENERATED` and `content` is populated from the configured metrics/widgets.
2. **Given** a report schedule, **When** it fires, **Then** the schedule's `nextRunAt` is advanced to the next occurrence and `enabled` remains as configured.
3. **Given** a report generation failure, **When** it occurs, **Then** the report `status` becomes `FAILED` with a sanitized error and is retried on the next cycle.
4. **Given** a disabled schedule, **When** the cron fires, **Then** the report is not regenerated.
5. **Given** a cross-tenant attempt, **When** any report or schedule is accessed by a foreign identifier, **Then** the request is denied and recorded.

---

### User Story 5 - Email Delivery and In-App Notifications (Priority: P2)

One reusable email service sends every notification through a background job (`SEND_EMAIL`). Each send persists an `EmailDelivery` record (`QUEUED` → `SENT` / `FAILED` / `BOUNCED`). Email templates are defined separately from business logic. In development the email service is a log sink (no real emails are sent unless SMTP env vars are configured). In-app notifications surface new recommendations and alerts in a notification inbox with an unread badge on the bell icon; notifications are tenant-scoped and can be marked read.

**Why this priority**: Email delivery and in-app notifications are the delivery mechanism for alerts and reports — they complete the automation loop by putting signals in front of the user.

**Independent Test**: Trigger an alert → confirm an `EmailDelivery` record is created in `QUEUED` then `SENT` (log sink in dev) and the notification appears in the inbox with an unread badge; confirm no real email is sent in dev without SMTP env vars.

**Acceptance Scenarios**:

1. **Given** an alert or report triggers a notification, **When** the email worker processes it, **Then** an `EmailDelivery` record persists (status `QUEUED` → `SENT`) with the recipients, subject, and template.
2. **Given** development mode without SMTP env vars, **When** an email is sent, **Then** the email service logs the send instead of invoking a mailer; the `EmailDelivery` record still shows `SENT`.
3. **Given** an email delivery fails, **When** the worker retries up to `MAX_ATTEMPTS`, **Then** the status becomes `FAILED` and is recorded (never silently dropped).
4. **Given** a new recommendation or alert, **When** it is created, **Then** a notification appears in the in-app inbox with an unread badge; marking it read removes the badge.
5. **Given** a cross-tenant attempt, **When** any email delivery or notification is accessed by a foreign identifier, **Then** the request is denied and recorded.

---

### Edge Cases

- What happens when the anomaly worker encounters a dataset with insufficient metric history to compute a baseline? It skips that metric with a `status: "INSUFFICIENT_DATA"` note and does not emit an anomaly.
- How does the system handle a rule evaluation where the referenced metric's dataset is not analytics-ready? The rule is skipped for that metric; no alert fires.
- What happens when the report worker fails mid-generation? The `Report` stays `DRAFT` then transitions to `FAILED` with a sanitized error; the schedule retries next cycle.
- How does the email service behave when a recipient list is empty? The `EmailDelivery` is skipped (no send attempted) and logged; the originating alert/report still records the notification in-app.
- How is a sudden spike in anomalies handled? Recommendations are generated as a bulk read-through of new anomalies + alerts; duplicates across the same metric/period are merged by `source` + key so the surface shows one recommendation per signal.
- What happens if Redis is unavailable? The jobs table remains the system of record; workers poll the table (as in Phase 2). Automation jobs enqueue normally; email and report workers complete without signal but with table polling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST scan analytics-ready datasets and detect metric anomalies, persisting an `AnomalyDetection` row with `kind`, `period`, `baseline`, `observed`, `deviationPct`, `status`.
- **FR-002**: System MUST aggregate anomalies, investigation findings, alert triggers, simulation outcomes, and system signals into a single `Recommendation` surface with `severity`, `source`, `evidence`, and optional `suggestedAction`.
- **FR-003**: Users MUST be able to create, enable/disable, configure (metric, condition, threshold, frequency, recipients) `AlertRule` records and have them evaluated on schedule.
- **FR-004**: System MUST create `Alert` records when a rule condition is met and deduplicate repeated firings within a configurable window.
- **FR-005**: Users MUST be able to create `Report` records (kind, title, metric/widget selection) and `ReportSchedule` records (frequency, cron, timezone, recipients) that auto-generate report content.
- **FR-006**: All email sends MUST go through a `SEND_EMAIL` job persisting `EmailDelivery` (QUEUED/SENT/FAILED/BOUNCED); email templates MUST be separate from business logic.
- **FR-007**: System MUST present an in-app notification inbox for new recommendations and alerts with an unread badge; notifications are tenant-scoped and markable as read.
- **FR-008**: Every automation record (anomaly, recommendation, alert, report, schedule, email delivery) MUST be scoped to `organizationId` and `workspaceId`; cross-tenant access MUST be denied and recorded.
- **FR-009**: In development without SMTP env vars, the email service MUST be a log sink (no real emails sent); the `EmailDelivery` record still shows `SENT`.
- **FR-010**: Anomaly detection MUST use only analytics-ready datasets; non-ready datasets MUST be skipped.
- **FR-011**: System MUST support Redis signal-layer operation (same pattern as Phase 3) while keeping the `jobs` table as the system of record; table-polling fallback when Redis is unavailable.

### Key Entities

- **AnomalyDetection**: a statistical finding that a metric's recent value deviated from its baseline; stores baseline, observed, deviation percentage, period, and status; feeds recommendations and alert rules.
- **Recommendation**: a consolidated actionable item drawn from anomalies, investigations, alerts, simulations, and system signals; carries severity, source tag, evidence, and an optional suggested action; user can open/acknowledge/resolve/dismiss.
- **AlertRule**: a user-defined rule (metric + condition + threshold + frequency + recipients) that evaluates automatically and fires alerts.
- **Alert**: an event emitted when a rule condition is met; carries severity, message, evidence; fires through email and in-app notification.
- **Report**: a generated artifact (weekly/monthly/custom) of dashboard metrics; persisted as structured content.
- **ReportSchedule**: a cron-based schedule for report generation; controls frequency, timezone, recipients.
- **EmailDelivery**: a record of an email send attempt; tracks QUEUED/SENT/FAILED/BOUNCED through the `SEND_EMAIL` job queue.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The anomaly worker completes a full scan of all analytics-ready datasets within a configurable interval (default: every 60 minutes) without manual intervention.
- **SC-002**: Every `AnomalyDetection` record includes `baseline`, `observed`, and `deviationPct` that reconcile to the underlying metric computation (traceable to `calculate_metric`/`compare_periods`).
- **SC-003**: The recommendations surface consolidates all active (`OPEN`) signals from anomalies, alerts, investigations, and simulations into a single list; acknowledging a recommendation updates its status atomically.
- **SC-004**: Alert rules evaluate on schedule with deduplication; no duplicate alerts fire for the same metric within the configured window.
- **SC-005**: Report generation produces `GENERATED` reports whose `content` matches the configured metrics/widgets; failed generations show `FAILED` with a sanitized error.
- **SC-006**: Every email send produces a traceable `EmailDelivery` record; emails are delivered to the configured recipients (alert-rule owner/admin or report-schedule recipients) via SMTP when configured; a development log sink records the same output when SMTP is not configured, ensuring no real email is sent inadvertently.
- **SC-007**: In-app notifications reflect new recommendations and alerts with an unread badge; marking a notification read removes the badge; all resources are tenant-scoped.
- **SC-009**: Generated reports can be exported as PDF (`pdfUrl` populated); PDF rendering completes within the generation timeout.
- **SC-008**: The full automation suite passes the phase gate (unit + integration tests, type-check, lint, migration validity) before the phase is considered complete.

## Assumptions

- The anomaly detection interval, threshold multiplier, and deduplication window are configurable via env vars (with sensible defaults).
- The anomaly worker reads metric values through the existing `calculate_metric`/`compare_periods` tools (same data path as the AI analyst) — it does not query raw customer data directly.
- Recommendations are generated as a bulk read-through pass over newly-detected anomalies + triggered alerts + existing investigation/simulation signals; the generation is a periodic batch, not a real-time push (SSE deferred; push via in-app notification).
- Email templates are simple text/HTML strings stored with the `EmailDelivery` record (template-name reference); the template content is defined at send time by the alert/report service, not a full template engine.
- Recipients on `AlertRule` and `ReportSchedule` are stored as JSON (emails); delivery goes to the email queue for the `SEND_EMAIL` job. When SMTP is configured, emails are delivered in real time; a development log sink records the same output for verification without sending real email.
- Reports support PDF export alongside JSON content (`pdfUrl` field); PDF generation uses `pdfkit` or equivalent.
- In-app notifications are stored as a simple notification record (created by alert/recommendation creation); a dedicated `Notification` model can be added later if the inbox grows richer (out of scope for Spec 4 — the requirement is satisfied by a tenant-scoped list + read status on the recommendation/alert records).
