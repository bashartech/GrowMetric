# ADR-007: Email Delivery via Jobs Table with Log-Sink Fallback

- **Status:** Accepted
- **Date:** 2026-09-28
- **Feature:** 004-automation
- **Context:** Automated alerts and scheduled reports need to reach users via email. The deployment may run without SMTP credentials (dev, preview, or self-hosted), so delivery must gracefully degrade. Additionally, delivery must be auditable (who/what fired, status) without depending on an external email provider's dashboard, and must be tenant-isolated.

## Decision

Deliver non-interactive email through the **same Jobs table system of record** (ADR-005) via a `SEND_EMAIL` job type, with a per-delivery `EmailDelivery` row as the domain record. The transport layer (`email.provider.ts`) picks between:

- **SMTP** (`nodemailer`) when `SMTP_HOST` is configured, using `SMTP_USER`/`SMTP_PASS` from the environment (Zod-validated in `env.ts`).
- **Log sink** (development fallback): when `SMTP_HOST` is unset, the provider logs the recipient, subject, and rendered HTML body and marks the delivery `SENT`. This keeps the rest of the pipeline (enqueue, job execution, statuses, notifications) identical in every environment.

- **Enqueue**: `sendEmail()` (in `email.service.ts`) inserts an `EmailDelivery` row (`status=QUEUED`) and enqueues a `SEND_EMAIL` job; the delivery row references the job via `jobId`.
- **Execution**: the `send-email` worker handler claims the job, resolves the SMTP-or-log-sink transport, sends, then marks `EmailDelivery` `SENT`; on provider error it stores a sanitized `error` and marks `FAILED` (delivery carries a bounded transit set — no blind retry loop; requeue policy is delegated to job-level retry semantics if added).
- **Templates**: server-side static templates (`alert_fired`, `anomaly_detected`, `report_generated`) interpolate tenant data as plain text/escaped values; no user-supplied HTML is rendered.
- **Tenant scoping**: `EmailDelivery` is keyed by `organizationId`; senders/recipients are always derived from tenant-owned data (alert-rule `recipients`, schedule `recipients`, reporting user), never from client-supplied raw headers.
- **Trigger sources**: alert evaluation and report-generation handlers produce emails; interactive request paths never render mail inline (so HTTP latency is not tied to SMTP timeouts).

## Consequences

### Positive

- Zero external dependency for delivery in environments without SMTP — the feature is fully testable and shippable locally.
- Auditable by construction: `EmailDelivery.status`, timestamps, template, and error are queryable in Postgres.
- Transport swaps are a single provider function (SMTP ↔ sink) with no job/status changes.
- Credentials stay out of the request path and out of logs (redaction paths cover `SMTP_PASS`/`SMTP_USER`).

### Negative

- No real inbox delivery in the sink mode — developer must trust the log output (acceptable for dev/preview).
- Email delivery is best-effort and terminal (`FAILED` on provider rejection) rather than retried over time; acceptable for alert/report fan-out but a future phase may add bounded retries via job requeue.
- PDF attachment support (if added later) must be layered into `EmailDelivery`/transport without breaking the sink path.

## Alternatives Considered

- **Async mail in the request path (fire-and-forget `nodemailer.sendMail`)**: rejected — loses auditability, is hard to test deterministically, and can hang HTTP responses on slow SMTP.
- **Dedicated mail-sending broker (SES/SendGrid direct API)**: rejected — adds an external dependency and per-provider auth handling beyond current scope; the intended production path (SMTP via nodemailer) works with any provider.
- **Email as a strict side-effect with no domain record**: rejected — `EmailDelivery` provides the audit trail and tenant scoping the phase requirements demand.

## References

- Feature Spec: `specs/004-automation/spec.md`
- Implementation: `backend/src/lib/email/{email.service,email-templates,email.provider}.ts`, `backend/src/workers/handlers/send-email.ts`, `backend/src/modules/alerts/*`, `backend/src/modules/reports/*`, `backend/prisma/schema.prisma` (model `EmailDelivery`, `@@index([status, createdAt])`)
- Related ADRs: ADR-005 (jobs table system of record — `SEND_EMAIL` job type), ADR-002 (tenant scoping)