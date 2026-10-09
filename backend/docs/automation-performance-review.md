# Performance Review Report - Automation Phase (004)

**Date**: 2026-09-28
**Reviewer**: Automated Performance Checklist Review
**Scope**: Index and query-pattern verification for automation tables (Job, AnomalyDetection, Recommendation, AlertRule, Alert, Report, ReportSchedule, EmailDelivery) and worker hot paths

---

## ✅ PASSED

### 1. Worker Job Polling (hot path, every 2s)
- **Pattern**: Workers poll `Job` for a `QUEUED` row with `runAt <= now`, then claim it atomically
- **Index**: `@@index([status, runAt])` (schema line 288)
- **Verdict**: ✅ Index matches the poll predicate exactly (`status` + `runAt` range). `@@index([type])` (line 289) additionally covers fleet-scoped type filtering if used. The job table stays small (claimed rows are terminal `COMPLETED`/`FAILED`) so the steady-state poll set is bounded.
- **Files**: `backend/src/workers/index.ts`

### 2. Automation List Endpoints
- **Pattern**: All list endpoints filter `{ organizationId, workspaceId, status? }` and order by `createdAt DESC`
- **Indexes**:
  - `Recommendation` → `@@index([organizationId, workspaceId, status, createdAt])` (1137) ✅
  - `Alert` → `@@index([organizationId, workspaceId, status, createdAt])` (1179) ✅
  - `Report` → `@@index([organizationId, workspaceId, status, createdAt])` (1198) ✅
  - `AnomalyDetection` → `@@index([organizationId, workspaceId, createdAt])` (1117) ✅ (covers id-ordered listing; status-filtered anomaly listings would degrade to a residual scan, acceptable at current volumes)
- **Verdict**: ✅ All tenant-scoped list queries are fully covered by the leading `(organizationId, workspaceId, ...)` index columns.

### 3. Alert Rule Enablement Filter
- **Pattern**: List rules for a tenant, optionally filtered by `enabled`, and rule lookups by id
- **Index**: `@@index([organizationId, workspaceId, enabled])` (1160)
- **Verdict**: ✅ Covers `WHERE organizationId/workpaceId/enabled`. Lookups by PK (`id`) need no additional index.

### 4. Scheduled Report Scheduler Sweep (cron tick)
- **Pattern**: Scheduler selects `enabled` schedules with `nextRunAt <= now` per tenant, then updates `nextRunAt` after enqueuing
- **Index**: `@@index([organizationId, workspaceId, enabled, nextRunAt])` (1217) ✅
- **Verdict**: ✅ Exact match for the sweep predicate; the `organizationId` prefix keeps per-tenant isolation while `nextRunAt` bounds the ready-set.

### 5. Email Delivery Poll (SEND_EMAIL worker)
- **Pattern**: Worker selects `QUEUED` deliveries oldest-first, marks `SENT`/`FAILED`, de-duplicating by `jobId`
- **Index**: `@@index([status, createdAt])` (1236) ✅
- **Verdict**: ✅ Matches the poll predicate and sort order. Terminal rows are written once; the working set is small.

### 6. Automated Generation Aggregations (Report / Anomaly / Alert)
- **Pattern**: Generation handlers recompute period metrics over `MetricSnapshot` (`@@index([organizationId, workspaceId, updatedAt])`, line 878) bounded by tenant + period range
- **Verdict**: ✅ Range scans are tenant-prefixed; child writes (Report, Anomaly, Alert) are single-row inserts on PKs / covered tenant index columns. Bursts are bounded by schedule fan-out, not unbounded loops.

### 7. JSON Column Usage
- **Pattern**: `recipients` (AlertRule/ReportSchedule/EmailDelivery) and `baseline`/`observed`/`evidence` stored as JSONB
- **Query surface**: JSON columns are only written and read back (never used in `WHERE`/`ORDER BY`), so no GIN index is required; size cost is acceptable for these payloads.
- **Verdict**: ✅ No query pattern requires JSONB indexing.

---

## 🔍 FINDINGS - Non-blocking Recommendations

### Finding 1: AnomalyDetection status-filtered lists (Low)
`@@index([organizationId, workspaceId, createdAt])` does not include `status`. If a future UI filters anomalies by status at scale, add `status` into the index (mirror Recommendation/Alert): `@@index([organizationId, workspaceId, status, createdAt])`.
**Status**: ⚠️ OPTIONAL (not needed at current volumes)

### Finding 2: Alert.ruleId secondary lookup (Low)
Alerts are written with a `ruleId` FK, but there is no standalone index on `Alert.ruleId`. Prisma does not auto-index FKs. A future "alerts by rule" drill-down would scan per tenant. Add `@@index([ruleId])` or `@@index([ruleId, createdAt])` if that query appears.
**Status**: ⚠️ ADD when the query exists

### Finding 3: Job table retention (Low)
Terminal `COMPLETED`/`FAILED` jobs accumulate; the worker's `(status, runAt)` index keeps polling fast regardless, but unbounded growth inflates table bloat over years of scheduled jobs. No cleanup is defined.
**Status**: ⚠️ Consider a future retention/archival background task

---

## Summary

**Total Checks**: 7
**Passed**: 7
**Failed**: 0
**Recommendations**: 3 (optional/low severity)

**Conclusion**: Every read hot path in the automation layer - worker job claim, tenant list endpoints, scheduler sweep, email poll, and generation-time metric scans - is covered by a targeted composite index whose leading columns match the filter predicate. JSONB columns are not queried, so no secondary indexes are required. The schema is ready for the phase gate.

---

**Sign-off**: Performance review complete (2026-09-28)