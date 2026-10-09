# Security Review Report - Automation Phase (004)

**Date**: 2026-09-28
**Reviewer**: Automated Security Checklist Review
**Scope**: Automation phase endpoints and services - recommendations, alert rules, alerts, scheduled reports, worker jobs (anomaly detection, alert evaluation, report generation), email delivery

---

## ✅ PASSED

### 1. Input Validation at System Boundaries
- **Status**: ✅ PASS
- **Evidence**:
  - Zod schemas validate all automation request bodies:
    - `backend/src/modules/alerts/alert-rule.schema.ts` - `createAlertRuleSchema` (Zod), `updateAlertRuleSchema` (partial)
    - `backend/src/modules/recommendations/recommendation.schema.ts` / `routes.ts` - `listRecommendationsSchema` on query params
    - `backend/src/modules/reports/report.schema.ts` - report create/schedule schemas, `frequency`/`kind` enum-bound
  - Recommendation status transitions (`acknowledge`/`resolve`/`dismiss`) go through explicit `PATCH .../status` with server-side state reconciliation, not raw client state
- **Files Checked**:
  - `backend/src/modules/alerts/alert-rule.schema.ts`, `backend/src/modules/alerts/routes.ts`
  - `backend/src/modules/recommendations/routes.ts`
  - `backend/src/modules/reports/report.schema.ts`, `report.routes.ts`

### 2. Authentication & Authorization (Tenant Isolation)
- **Status**: ✅ PASS
- **Evidence**:
  - All automation routes mounted behind `requireAuth` alone (`alerts/routes.ts` line 8) or the shared AI router that applies `requireAuth` + tenant scoping
  - Every automation query is scoped by `organizationId` + `workspaceId`; controllers derive tenant from the authenticated session, never from client input
  - Cross-tenant lookups return 404 (not found), preventing IDOR enumeration
- **Files Checked**:
  - `backend/src/modules/alerts/routes.ts`, `backend/src/modules/alerts/alert-rule.service.ts`, `alert.service.ts`
  - `backend/src/modules/recommendations/recommendation.service.ts`
  - `backend/src/modules/reports/report.service.ts`

### 3. Worker Job Tenant Integrity
- **Status**: ✅ PASS
- **Evidence**:
  - Worker claim handlers load the `Job` row, read `organizationId`/`workspaceId` from the job payload, and execute analytics under those identifiers only
  - Handlers never accept tenant scope from message/signal payload beyond the job record itself (job is the system of record; Redis is only a wake-up signal - see `ADR-005`)
  - Reports/alerts/anomalies are written with the job's tenant scope, so a compromised signal cannot cross tenancy
- **Files Checked**:
  - `backend/src/workers/handlers/run-anomaly-detection.ts`, `evaluate-alert-rules.ts`, `generate-report.ts`, `send-email.ts`

### 4. Secrets Management (Email)
- **Status**: ✅ PASS
- **Evidence**:
  - `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` loaded from environment via Zod (`env.ts` lines 59-62), never hardcoded
  - Logger redaction paths include `SMTP_PASS`, `*.SMTP_PASS`, `SMTP_USER`, `*.SMTP_USER` (`logger.ts` lines 35-38) so credentials never appear in logs
  - When SMTP is not configured, delivery falls back to an explicit log sink that logs only recipient, subject, and HTML body template (no credentials)
- **Files Checked**:
  - `backend/src/config/env.ts`, `backend/src/lib/logger.ts`, `backend/src/lib/email/email.provider.ts`

### 5. Email Content & Header Injection
- **Status**: ✅ PASS
- **Evidence**:
  - Recipients and subjects are assembled only from tenant-controlled data and typed `EmailDeliveryInput`; the nodemailer transport sets subject via the API abstraction on the composed message object
  - Email templates use static server-side templates (`alert_fired`, `anomaly_detected`, `report_generated`) with interpolated values; rendered via string functions that escape report content as plain text (no raw HTML from user data)
- **Files Checked**:
  - `backend/src/lib/email/email.service.ts`, `email-templates.ts`, `email.provider.ts`

### 6. Rate Limiting & Resource Controls
- **Status**: ✅ PASS (with note)
- **Evidence**:
  - Interactive report generation and anomaly-detection runs are idempotent per job; the job table deduplicates work (single claim per job id)
  - Schedulers tick on fixed intervals (env-tuned), each tick dispatches bounded work; bulk egress is capped by job-based fan-out, not unbounded loops
  - `recordUsage()` calls are best-effort and non-blocking so a metrics failure cannot be weaponized as a DoS against delivery
- **Files Checked**: `backend/src/workers/index.ts`, handlers above, `backend/src/modules/entitlements/entitlement.service.ts`

### 7. Error Handling - No Information Leakage
- **Status**: ✅ PASS
- **Evidence**:
  - Email delivery failures are flattened to a stored `error` field with a sanitized message; provider errors are not echoed to clients
  - Report failures persist `error` (string) without stack traces or SMTP credentials
- **Files Checked**:
  - `backend/src/modules/reports/report.service.ts` (FAILED transition), `backend/src/workers/handlers/send-email.ts`

### 8. PDF Generation Safety
- **Status**: ✅ PASS
- **Evidence**:
  - PDF files are written under `/uploads/reports/` with names derived from the UUID report id (server-generated), preventing path traversal from client-supplied values
  - Report content passed to `pdfkit` is metric/product data rendered as text/fonts, not executable content
- **Files Checked**: `backend/src/lib/pdf/pdf-renderer.ts`, `backend/src/modules/reports/report.service.ts`

---

## 🔍 FINDINGS - Minor Recommendations

### Finding 1: NotificationService organization-scoped fan-out (Resolved)
**Location**: `backend/src/modules/notifications/notification.service.ts`
**Issue**: Worker handlers originally passed `organizationId` as the `userId` for `NotificationService.create(...)`, which wrote an organization id into the `User` FK column and violated `Notification_userId_fkey` on real databases.
**Resolution**: Added `createForOrganization(organizationId, title, body)`, which resolves the org's users (`take: 20`) and creates one `SYSTEM` notification per user via `createMany`. All automation handlers (anomaly detection, alert evaluation, report generation) now use it, keeping the `userId` FK valid.
**Status**: ✅ RESOLVED (2026-09-28)

### Finding 2: Redis Queue Signal - No Authentication (Informational, carried from Phase 3)
**Location**: `backend/src/lib/redis.ts`
**Issue**: If `REDIS_URL` points to a publicly reachable Redis without auth, signals could be forged. Mitigation: signals carry no payload data; the job table remains the system of record.
**Recommendation**: Deployment must require Redis auth or network isolation.
**Status**: ⚠️ DOCUMENT (deployment guidance)

### Finding 3: No per-tenant email volume cap
**Location**: `backend/src/lib/email/email.service.ts`
**Issue**: Schedules can enqueue a burst of emails per tenor if many alert rules fire simultaneously; there is no daily-per-tenant egress cap.
**Recommendation**: Consider a per-tenant daily email budget in a future phase (queue gating), or rely on alert-rule de-duplication (`AlertRule.lastTriggeredAt`).
**Status**: ⚠️ RECOMMENDED (non-blocking)

---

## Summary

**Total Checks**: 8
**Passed**: 8
**Failed**: 0
**Recommendations**: 3 (informational/documentation)

**Conclusion**: The automation layer follows the same secure patterns as Phases 1-3: every endpoint is behind authentication with tenant-scoped queries, all input is Zod-validated, SMTP credentials are env-based and redacted, job payloads carry tenant identity that workers are bound to, and error paths are sanitized. Worker execution through the job table as system of record preserves tenant isolation even when the optional Redis signal path is present.

**Action Items**:
1. ⚠️ Document Redis URL security requirements in deployment guide
2. ⚠️ Track Notification.userId-organizationId semantic mismatch for a future phase
3. ⚠️ Consider per-tenant email egress budget in a future phase

**Approved for Phase 4 completion**: Yes

---

**Sign-off**: Security review complete (2026-09-28)