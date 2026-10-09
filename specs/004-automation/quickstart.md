# Quickstart: Phase 4 — Automation

**Feature**: `004-automation`
**Goal**: Run both apps plus the worker and verify the Phase 4 gate: anomaly worker scans analytics-ready datasets and persists `AnomalyDetection` rows → recommendations consolidate anomalies/alerts/investigations → alert rules evaluate and fire `Alert` records + email (SMTP delivery to configured recipients; dev log sink when SMTP is not configured) + in-app notifications → scheduled reports generate `Report` content with PDF export → all tenant-scoped and cross-tenant-denied.

## Prerequisites

- Phase 1 + Phase 2 + Phase 3 installed and gated (see `specs/003-ai/quickstart.md`)
- Node.js 20 LTS + npm (ESM)
- A PostgreSQL database (Neon)
- Optional: Redis/Upstash `REDIS_URL` for the signal layer (jobs-table polling works without it)
- Optional: SMTP env vars for real email delivery in development (`SMTP_HOST` + credentials; dev log sink when not set)
- Optional: PDF export verification (requires `pdfkit`)

## 1. Environment

Add to `backend/.env` (alongside Phase 1/2/3 vars):

```dotenv
# Automation (Phase 4)
ANOMALY_SCAN_INTERVAL_MS=3600000    # default: every 60 minutes
ANOMALY_DEVIATION_THRESHOLD=30       # percent deviation to emit
ALERT_DEDUP_WINDOW_MS=3600000        # default: 60 minutes
REPORT_MAX_RETRIES=3
EMAIL_FROM="noreply@GrowMetrics.com"
SMTP_HOST="smtp.example.com"         # leave empty for dev log sink
SMTP_PORT=587
SMTP_USER="your-user"
SMTP_PASS="your-password"
```

`frontend/.env.local` — unchanged from Phase 3.

## 2. Backend + Worker

```powershell
cd backend
npx prisma migrate dev --name automation   # +7 models, 12 enums (additive)
npx prisma generate           # do NOT pass --no-engine: it sets "copyEngine": false and the runtime then requires a prisma:// DataProxy URL (breaks every DB query)
npm run seed
npm run dev            # API on :4000
```

In a second terminal (worker):

```powershell
cd backend
npm run worker         # polls jobs table; activates Redis BRPOP when REDIS_URL set
```

## 3. Frontend

```powershell
cd frontend
npm install            # (if new deps)
npm run dev            # on :3000
```

## 4. Manual Verification (Phase Gate)

1. **Anomaly detection**: wait for (or trigger) a scan on an analytics-ready dataset with a spiked metric → confirm `AnomalyDetection` row in DB with `deviationPct`, `baseline`, `observed`.
2. **Recommendations**: open the recommendations surface → confirm `Recommendation` rows appear with severity/source/evidence; acknowledge one → status → `ACKNOWLEDGED`.
3. **Alert rules**: create a rule whose threshold the current metric already exceeds → run the evaluator → confirm `Alert` record + `EmailDelivery` record + notification in inbox with unread badge.
4. **Reports**: create a report + schedule → advance time or trigger → confirm `Report.status: GENERATED` and `content` populated; confirm `ReportSchedule.nextRunAt` advanced.
5. **Email delivery**: with `SMTP_HOST` configured, confirm real email delivery to configured recipients; with no SMTP env vars, confirm the log sink records the send; `EmailDelivery.status` shows `SENT`.
6. **PDF export**: generate a report → confirm `Report.pdfUrl` is populated with a valid PDF file.
7. **Cross-tenant**: attempt to access another org's recommendation → `NOT_FOUND` / `403` + audit recorded.
8. **Redis fallback**: stop Redis → confirm workers continue via table polling; automation jobs complete normally.
## 5. Phase Gate

```powershell
cd backend
npx prisma validate
npx prisma migrate status
npx tsc --noEmit
npm run lint
npx vitest run tests/unit      # full unit suite (incl. report-renderer, pdf-renderer, report-scheduler)
npx vitest run tests/integration   # requires DATABASE_URL + Redis (signal + polling paths)
```

`frontend`: `npx vitest run tests/unit` (component tests incl. recommendations, alert-rules, reports).

**Note**: integration tests and `migrate status` require a reachable database; without one, those steps are reported as skipped rather than failed. Without the worker running, automation jobs stay `QUEUED` and datasets/dashboards never populate — run `npm run worker` alongside the API. Only one backend should listen on `:4000` (a stale server causes 401/422 old-behavior errors).

Full results recorded in `specs/004-automation/phase4-completion-summary.md`.
