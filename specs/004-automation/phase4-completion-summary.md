# Phase 4 Completion Summary — Automation

**Feature**: `004-automation`
**Completed**: 2026-09-28
**Branch**: `002-data-layer` (phase work is uncommitted; see Repo note below)

## Scope Delivered

Automation layer on top of Phase 1–3: anomaly detection worker, alert-rule evaluation,
scheduled report generation with PDF export, a jobs table as system of record, an optional
Redis signal layer, email delivery (SMTP → dev log sink), and in-app notifications.

### Delivered components
- `AnomalyDetection` worker (`run-anomaly-detection.ts`) → anomalies persisted, recommendations consolidated.
- Alert evaluation (`evaluate-alert-rules.ts`) → `Alert` records + notifications; per-rule dedup window.
- Scheduled reports (`generate-report.ts`, `report-schedule.*`) → `Report.content` blob + PDF via `pdfkit`; `ReportSchedule.nextRunAt` advance.
- Job orchestration: `backend/src/jobs/queue.ts` (PENDING → RUNNING → COMPLETED/FAILED, `MAX_ATTEMPTS=3`, backoff) + Redis signal consumption (`lib/redis.ts`, BRPOP) in `workers/index.ts`, with table-polling fallback when `REDIS_URL` is unset.
- Email delivery: `lib/email/email.service.ts` (EmailDelivery record + `SEND_EMAIL` job), providers for SMTP and dev log sink; `send-email` handler marks `SENT`/`FAILED` and completes/fails the job.
- Notifications: `notification.service.ts` (inbox, mark-read) + org-scoped fan-out (`createForOrganization`).
- Frontend: recommendations, alert-rules, reports, report-schedules, and notifications surfaces + api-client/types DTOs + polling helper + component tests.
- Tenancy: all automation records scoped `organizationId`/`workspaceId`; cross-tenant reads denied (NOT_FOUND).

## Phase Gate Results

Run: 2026-09-28, backend + frontend at this commit.

| Check | Command | Result |
|---|---|---|
| Prisma schema | `npx prisma validate` | ✅ PASS |
| Migrations applied | `npx prisma migrate status` | ✅ "Database schema is up to date!" (6 migrations, Neon) |
| TypeScript | `npx tsc --noEmit` | ✅ PASS |
| Lint | `npm run lint` (backend) | ✅ PASS (0 problems) |
| Backend unit suite | `npx vitest run tests/unit` | ✅ 36 files / 291/291 passed |
| Automation integration | `npx vitest run tests/integration/queue-automation.test.ts tests/integration/email-delivery.test.ts` | ✅ 2 files / 4/4 passed (real Neon DB, 79s) |
| Full integration run | `npx vitest run tests/integration` | ⚠️ PARTIAL — automation suites green; pre-existing legacy failures (see Known pre-existing failures) |
| Frontend unit | `npx vitest run tests/unit` (frontend) | ✅ 23 files / 113/113 passed |
| Report component tests | recommendations / alert-rules / reports | ✅ added; assert list states, empty/error/loading, PDF link |

Environments for gate: `CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1` set to avoid Prisma
checkpoint hangs; `DATABASE_URL` from `backend/.env` (shared Neon DB).

## Bugs found and fixed during the gate

1. **`prisma generate --no-engine` breaks runtime** — a client generated with `--no-engine` has
   `"copyEngine": false`, so the runtime requires a `prisma://` DataProxy URL and every query fails
   (`Error validating datasource db: the URL must start with the protocol prisma:// or prisma+postgres://`).
   Fixed by a normal `npx prisma generate` (`"copyEngine": true`); verified with a live query (`prisma.user.count()` → 130).
2. **Wrong relative imports in 3 handlers** — `run-anomaly-detection.ts`, `generate-report.ts`,
   `evaluate-alert-rules.ts` imported `../modules/...` (masked with `// @ts-ignore`). Fixed to
   `../../modules/...`; `@ts-ignore` removed; `generate-report` and `evaluate-alert-rules` now use the
   shared `prisma` singleton (`lib/prisma.js`) instead of `new PrismaClient()`.
3. **`Notification_userId_fkey` violation** — handlers passed `organizationId` into `NotificationService.create()`
   (a `userId` FK column) → every automation run that fired a notification failed in production shape.
   Added `NotificationService.createForOrganization()` (resolves org users, `createMany`, cap 20) and switched
   the three handlers to it. Finding 1 in `automation-security-review.md` updated to RESOLVED.
4. **`send-email` handler never completed its job** — the job stayed `RUNNING` forever (all other handlers
   call `completeJob`). Now: `accepted` → `SENT` + `completeJob`; rejected → `FAILED` + `completeJob`
   (delivery carries the failure; job remains terminal); thrown provider errors → `failJob` (retry with backoff).
5. **Lint debt (40 errors)** — pre-existing `no-unused-vars`/`no-require-imports` across 17 src + test files;
   cleaned (unused imports removed, params → `_name`). `npm run lint` now passes.
6. **Test-level issues** — `email-delivery.test.ts`: `signalQueuedJob` mock impl leaked between tests
   (mockReset now restores the inbox-push implementation); `queue-automation.test.ts`: notification
   assertion filters by body to skip the onboarding "Your organization..." record.

## Known pre-existing failures (NOT caused by Phase 4)

Full integration run is slow (>20 min) and still shows legacy Phase 2/3 failures unrelated to automation:

- `tests/integration/agent-runs.test.ts` (T066): expects a STOPPED/FAILED terminal but the worker completes the job (`expected 'COMPLETED' to be 'STOPPED'`).
- `tests/integration/mapping-suggestions.test.ts` (T057): LLM-provider failure-expectation path (`expected null to be 'revenue'`).
- `tests/integration/recommendations.test.ts`: `beforeEach` breaks on `prisma.dataset.create({ dataSourceId: 'ds-source-1' })` — FK to a DataSource that the test never creates (stale against current schema).

These were failing before this phase and are documented for the phase that owns their surfaces.

## Docs produced

- `backend/docs/automation-security-review.md` — 8 checks, 3 findings (notification fan-out now RESOLVED; Redis signal unauthenticated; no per-tenant email volume cap).
- `backend/docs/automation-performance-review.md` — 7 checks PASS, 3 optional index/retention notes.
- `docs/architecture/ADR-005-jobs-table-system-of-record.md` — added "Phase 4 Enhancements (2026-09-28)".
- `docs/architecture/ADR-007-email-delivery-jobs-log-sink-fallback.md` — new ADR.
- `specs/004-automation/quickstart.md` — updated gate commands + `prisma generate` warning.

## Usage tracking (T152)

Best-effort `recordUsage` (Phase 5 enforcement placeholder) is wired in the automation handlers:
`anomaly_detection`, `alerts` (count), `reports`; network ops still record `imports`/`data_sources`/`ai_runs`.

## Next steps / readiness

Phase 4 is feature-complete for its acceptance criteria (SC-005/006/007 pass: report generation +
schedule advance, traceable EmailDelivery, notifications with unread badge). Integration tests now run
against the real Neon DB and the automation suites are green.

### Repo note
All phase work (backend/, frontend/, docs/, specs/) is uncommitted on branch `002-data-layer`. Before
Phase 5 injection starts, create `004-automation` and commit this phase (design docs, source, tests, PRDs).