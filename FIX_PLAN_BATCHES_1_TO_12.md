# Fix Plan: Batches 1-12 — Detailed Changes and Final Verification

Derived from `research.md` (Part 5, "What's still broken", Groups A-I + the three
known-imperfect items) and from the live codebase. This document is the authoritative
record of *what was broken, what changed, and how each change is verified*.

**Status legend**

| Batch | Theme | Status |
| --- | --- | --- |
| 1 | Workspace resolution + tenant guards + response envelope (A1, A2, B1-B5) | Complete |
| 2 | Deployment proxy / env docs | Complete |
| 3 | Private PDF storage + authenticated download | Complete |
| 4 | Report builder schema, catalog, cron/PATCH (D2, D4, D5) | Complete |
| 5 | Real report content, no double-encoded JSON (D1, D3) | Complete |
| 6 | Real alert evaluation + email wiring (E1-E5) | Complete |
| 7 | Automation scheduler (C1-C5) | Complete |
| 8 | Anomaly correctness (F1-F3) | Complete |
| 9 | Entitlement enforcement (G) | Complete |
| 10 | List pagination (A3) | Complete |
| 11 | Residuals (CHANGES_BY, recommendation sources, baseline N) | Complete |
| 12 | Test blind spots (H1, H2) — H3 already delivered in Batch 7 | Complete |

Out-of-plan correctness fixes delivered between batches: **NEW-1** (mapping confidence
gating) and **NEW-2** (agent history budget). Both complete.

---

## Conventions and standing constraints

These apply to every batch and are restated in `AGENTS.md`.

1. **Two processes are required.** `npm run dev` (API on `PORT`, default 4000) and
   `npm run worker` (`src/workers/runner.ts`). The API does **not** start the worker.
   Without the worker, imports stay `QUEUED` and datasets/dashboards never populate.
2. **Stop both before integration tests.** The worker shares the `Job` table and will
   claim jobs the test created, making `queue-automation` and `email-delivery` fail
   with a job stuck in `PENDING`.
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
     Where-Object { $_.CommandLine -match 'business_management\\backend' } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   npx vitest run
   ```
3. **Use `--maxWorkers=2`.** At full parallelism the suite produces false failures
   (`expected 401 to be 200`) from Neon connection contention.
4. **`npx prisma generate` requires every backend process stopped**, otherwise Windows
   fails with `EPERM ... rename query_engine-windows.dll.node`.
5. **Integration tests are slow** (single files 40s-3min). A full-suite run exceeds
   50 minutes; run it in directory chunks.
6. **`backend/` and `frontend/` are untracked.** Never use `git stash -u`, `git reset
   --hard`, or `git checkout --` against them.
7. **Tenant scoping is mandatory in tests.** Scheduler and scan tests touch the whole
   database; assertions must be scoped to the test's own organization.
8. **Report generation is asynchronous.** `POST /api/v1/ai/reports/:id/generate` returns
   `202 Accepted` with `{ jobId, report, status: 'QUEUED' }`. The worker owns
   `DRAFT → GENERATED | FAILED`.

---

## BATCH 1 — Workspace resolution, tenant guards, response envelope

### The defects

* **A1** `frontend/lib/api-client.ts:71-84` used a `directKeys` heuristic to decide
  whether to unwrap a response, so 3 of 5 Phase 4 pages silently rendered nothing.
* **A2** 14 raw `res.json()` call sites in the alert-rule / alert / recommendation
  controllers bypassed the standard envelope, so the frontend heuristic could not
  possibly work.
* **B1** `modules/alerts/routes.ts` had only `requireAuth`, no `tenantGuard`, so
  `req.tenant` was undefined on every alert route.
* **B2/B3** `alert-rule.controller.ts:36`, `alert.controller.ts:17`,
  `report.controller.ts:17`, `report-schedule.controller.ts:17`,
  `recommendation.controller.ts:29` threw a hard `400` when `workspaceId` was absent
  instead of resolving the tenant's default workspace.
* **B4** The frontend never sent `?workspaceId=`.
* **B5** `run-anomaly-detection.ts:16` and `evaluate-alert-rules.ts:16` forwarded
  `payload.workspaceId ?? ""` into a `@db.Uuid` filter — the same invalid-UUID trap in
  the worker path.

### Changes

* Deleted the `directKeys` heuristic; only the `ok()` unwrap path remains.
* Converted every Phase 4 controller to `ok(res, …)`.
* Added `tenantGuard` to `modules/alerts/routes.ts`, matching the sibling routers.
* Introduced `lib/workspace.ts` with `resolveWorkspaceId(organizationId, requested?)`
  and `requestedWorkspaceId(raw)`. `resolveWorkspaceId` validates that the requested
  workspace belongs to the organization and otherwise falls back to the default
  workspace. It never returns `""`, which removes the `@db.Uuid` cast failure.
* Controllers now use `resolveWorkspaceId(...)` instead of rejecting with `400`.
* Frontend `api.reports`, `api.alertRules`, `api.alerts`, `api.reportSchedules`,
  `api.recommendations.list` pass `?workspaceId=` explicitly.
* Both worker handlers call `resolveWorkspaceId(orgId, payload.workspaceId)` before
  building a UUID filter.

### Verification

* Unit + integration suites for alerts, alert rules, recommendations, reports,
  anomalies.
* Regression covered: a request with no `workspaceId` returns `200` and the default
  workspace's rows, never `400` and never another tenant's rows.

---

## BATCH 2 — Deployment proxy, relative API URL, environment docs

### The defect

`frontend/lib/api-client.ts` pointed at an absolute backend origin. With the Next.js
app deployed to Vercel and the API on Hugging Face, every browser request was a
cross-origin call that failed CORS and leaked the internal API host to the client.

### Changes

* `frontend/vercel.json`: added a rewrite so `/api/v1/*` proxies to the backend origin.
* `frontend/lib/api-client.ts`: switched to a relative `/api/v1` base.
* Documented the required HF Spaces variables (secrets, R2, email, Neon) and the
  matching Vercel variables in `DEPLOYMENT.md`, including the SPA/proxy topology and
  the `on_event: startup` requirement so the worker starts with the API.

### Verification

* Frontend `npm run typecheck` and `npm run lint`.
* Manual: dev proxy reaches the API through the rewrite; no CORS preflight in the
  browser network tab.

---

## BATCH 3 — Private PDF storage and authenticated download

### The defect

Generated PDFs were written to a local `uploads/` path and served as a public URL, so
a report could be fetched by anyone who guessed or was handed the link — a
cross-tenant data leak.

### Changes

* `ReportService.renderPDF` returns a `Buffer`; the buffer is written through
  `lib/storage.ts` (`storage.put`) so R2 and local disk share one code path and an
  ephemeral filesystem loses nothing.
* `pdfUrl` now stores a **private storage key** (`<orgId>/reports/report-<id>-<ts>.pdf`),
  never a public path.
* Added `GET /api/v1/ai/reports/:id/pdf`, authenticated via
  `requireAuth + tenantGuard`, which looks the report up by `where: { id, organizationId }`
  and streams the bytes with:
  * `Content-Type: application/pdf`
  * `Content-Disposition: attachment; filename="<slug>.pdf"; filename*=UTF-8''<encoded>`
  * `Cache-Control: private, no-store`
* `reportStorageKey()` normalizes rows written before the migration: a legacy
  `/uploads/reports/x.pdf` is rewritten to the key `reports/x.pdf`; any other
  leading-slash value returns `null`.
* A missing object returns `404` with an honest message ("The stored PDF is no longer
  available. Generate the report again.") rather than a 500.
* Frontend `api.reports.downloadPdf` uses the `downloadFile` blob helper; the page
  shows a busy state and a real failure message.

### Verification — `tests/integration/report-pdf.test.ts` (5 tests)

| Test | Asserts |
| --- | --- |
| `streams the stored PDF as an attachment` | 200, `application/pdf`, `attachment`, sanitized filename, `%PDF-` magic bytes |
| `serves PDFs written before the storage migration` | legacy `/uploads/...` row still downloads |
| `does not leak a report to another organization` | foreign report id → 404, never 403 (does not confirm existence) |
| `rejects an unauthenticated download` | 401 |
| `reports a not-yet-generated report honestly` | `DRAFT` report → 404, not a broken file |

> Isolation note: this file passes alone but has failed once when run in parallel with
> `report-rendering.test.ts` (see "Known open defects").

---

## BATCH 4 — Report builder schema, metric catalog, cron/PATCH fixes

### The defects

* **D2** `Report` had no `metricKeys` column, but `contracts/reports.md:18` requires it,
  so a report could not record what the user selected.
* **D4** Zod schemas declared `cronExpression` while the Prisma column is `cron`.
  Creating any report schedule therefore threw a type error.
* **D5** `report-schedule.controller.ts:32` reused `createReportScheduleSchema` for
  `PATCH`, forcing `reportId` + `workspaceId` on every update.

### Changes

* Migration `20260930173212_report_builder_config` adds `Report.metricKeys`,
  `Report.filters`, `Report.breakdowns`, `Report.investigationId`,
  `Report.reportType`, `Report.datasetId`.
* Renamed the schema fields to `cron` so validation matches the column.
* Added a separate `updateReportScheduleSchema` whose fields are all optional.
* Added `GET /api/v1/ai/metric-catalog` backed by
  `modules/analytics/metric-catalog.ts` (`CANONICAL_METRICS`) so the builder's pickers
  come from the server rather than a hardcoded client list that drifts.
* Frontend builder (`frontend/app/(app)/reports/page.tsx`) fetches the catalog, the
  dataset list, and the investigation list; `Create` stays disabled until the required
  inputs exist rather than letting the server reject the request.

### Verification

* Migration applies cleanly; `prisma generate` produces the new fields.
* Integration: create with `metricKeys`, patch without `reportId`, patch with `cron`.

---

## BATCH 5 — Real report content (the fake numbers)

### The defects

* **D1** `report.service.ts:107-120` `buildReportContent` returned a hardcoded
  `{ revenue: 125000, ... }` object. Every report in the product was fiction.
* **D3** `report.service.ts:82` assigned `JSON.stringify(content)` into a `Json?`
  column, storing a **double-encoded** value that had to be parsed twice on read.

### Changes

* `buildReportContent` now computes every number:
  * `computeMetric({ datasetId, metricKind, filters }, organizationId, workspaceId)`
    for each entry in `metricKeys`.
  * `groupByMetric({ datasetId, metricKind, groupByColumnId, limit: 10, filters }, …)`
    for each `(metric, breakdown)` pair.
  * `ReportInvestigationContent` is assembled from the investigation's own `findings`
    rows; it never recomputes or invents conclusions.
* An unavailable metric is emitted as `{ available: false, value: null }` and the PDF
  prints "not available — this dataset has no matching column." in red. One unsupported
  metric cannot fail the whole report, because metrics are computed with `Promise.all`
  per metric and the renderer tolerates a null.
* A report with no `datasetId` or no `metricKeys` throws `VALIDATION_ERROR` rather than
  rendering an empty PDF.
* Json columns are assigned raw objects (`as unknown as Prisma.InputJsonValue`); the
  `JSON.stringify` call is gone from both `create` and `generate`.
* PDF output was widened: metric list with formatted numbers, one small table per
  breakdown with a "No data for this breakdown." fallback, and a full investigation
  section (question, status, findings with level/title/summary/confidence).
  `formatNumber` uses `Intl.NumberFormat` so large sums are not rendered in exponent
  notation.

### Verification — `tests/integration/report-rendering.test.ts` (9 tests)

D1 was migrated to the async contract in Batch 7; each success case now asserts
`202` → claim the `Job` → run `processGenerateReportJob` → reload the report and assert
the **persisted** content:

* metrics match the fixture's real rows,
* breakdowns group by the requested column,
* a stale filter that no longer matches a column produces a **FAILED** report rather
  than an unfiltered total presented as filtered,
* a non-analysable dataset produces a **FAILED** report,
* an investigation belonging to another organization produces a **FAILED** report.

---

## BATCH 6 — Real alert evaluation and email (E1-E5)

### The defects

* **E1** `alert-rule.service.ts:196-202` `getCurrentMetricValue` returned the constant
  `150000`, so every rule fired or stayed silent based on nothing.
* **E2** `alert-rule.service.ts:15` set `name: input.metricKind`, discarding the
  user's name — and the schema did not accept a name at all.
* **E3** `alert-rule.service.ts:178-189` wrote a `Job` directly with payload
  `{ alertId, recipients, templateName: 'alert-notification' }`. The real handler
  expects `{ emailDeliveryId, to, subject, html }`, so the job **always** failed, and
  `alert-notification` is not a template — the real names are `alert_fired`,
  `anomaly_detected`, `report_generated`.
* **E4** `email.service.ts:35,47` used `recipientUserId ?? "placeholder-org"` for
  `organizationId`, which is a non-nullable `@db.Uuid`, so the insert threw.
* **E5** `sendEmail()` was never called by anything.

### Changes

* Migration `20260930185444_alert_rule_dataset` adds `AlertRule.datasetId`. A rule
  names the dataset it measures, so evaluation never guesses "the latest dataset".
* `getCurrentMetricValue` became a real read that resolves the dataset (explicit
  `rule.datasetId`, else the latest `READY` dataset for the workspace) and calls
  `computeMetric` with the rule's window. It returns
  `{ available, observed, previousValue, changePct, period }` so a rule that cannot be
  evaluated reports "not evaluated" instead of firing on `0`.
* `name` is taken from the schema and validated; the metric kind is stored in its own
  field.
* The email path goes through `sendEmail()`, which creates the `EmailDelivery` and
  enqueues a `SEND_EMAIL` job with the exact payload the handler expects. The template
  name is chosen from the real set, and `alert_fired` receives its variables.
* `sendEmail` requires a real `organizationId` and throws
  `VALIDATION_ERROR` when it is missing, instead of writing a placeholder.
* Alert firing also validates that the organization exists.

### Verification

`tests/integration/alerts.test.ts`, `tests/integration/alert-rules.test.ts`,
`tests/integration/email-delivery.test.ts`:

* a rule fires when real data crosses the threshold and does not fire when it does not,
* `ABOVE`/`BELOW`/`EQUALS` and the zero-threshold guard,
* `CHANGES_BY` uses the previous value from the same read,
* `organizationId` is a valid UUID and the delivery row persists,
* a `SEND_EMAIL` job exists with the handler's real payload shape.

---

## BATCH 7 — Automation scheduler (C1-C5)  **COMPLETE**

### The defect

`node-cron` was in `package.json` and imported nowhere. `tasks.md` marked T135/T223
`[x]`, but no cron code existed. Nothing ever enqueued `RUN_ANOMALY_DETECTION`,
`EVALUATE_ALERT_RULES`, or scheduled `GENERATE_REPORT` — verified because
`enqueueJob(` had only 5 call sites (import, email, simulation, investigation, ai).
**The entire automation loop was dormant**: alerts, anomaly detection, and recurring
reports worked only when a human triggered them over HTTP.

### B7.1 — Shared cadence maths (new, `src/lib/schedule-cadence.ts`)

`nextRunAtAfterNow(frequency, cron, from, timezone)` and
`nextRunAt(frequency, cron, from, timezone)` are the single implementation used by both
the schedule API and the scheduler tick, so a schedule is advanced by exactly the rule
that created it. It supports:

* five-field cron: wildcards, ranges, lists, steps,
* day-of-week `0`/`7` Sunday aliases and `JAN`-`DEC` month names,
* the Vixie union rule when **both** day-of-month and day-of-week are restricted,
* timezone-aware evaluation via a computed zone offset, so a `09:00 Asia/Karachi`
  schedule fires at 04:00Z and stays correct across a DST transition,
* `MONTHLY` with day clamping (`day 31` in February resolves to the 28th/29th).

**Verified:** `tests/unit/schedule-cadence.test.ts` — **27/27 passing**, covering
`*/N` steps, ranges/lists, Sunday `0` vs `7`, day union, monthly rollover, clamping,
timezone offsets, and DST.

`ReportService.createSchedule` and `updateSchedule` both call it, so the two paths can
no longer drift.

### B7.2 — C1 `startScheduler`

`src/workers/scheduler.ts` registers three node-cron tasks and returns a
`SchedulerHandle { stop() }` so a test or a graceful shutdown never leaves timers
running that would enqueue jobs into the next test. `startWorker` calls
`startScheduler()` unless `--run-once` is set, and stops it on `SIGINT`/`SIGTERM`.

Every tick is defensive in the same three ways:

1. **Idempotent** — `hasOutstandingJob(type, organizationId, workspaceId?)` skips a tick
   that finds work already `PENDING`/`RUNNING`, so a restart or a second replica
   cannot stack duplicate scans or send the same report twice.
2. **Atomic** — schedules are claimed with a conditional `updateMany` that only matches
   a still-due row, so two schedulers racing the same slot produce exactly one job.
3. **Isolated** — one failing organization or schedule is logged and skipped rather than
   aborting the whole tick.

`workspaceId` is part of the dedupe key for workspace-scoped jobs: deduping on the
organization alone would let one workspace's pending evaluation suppress every other
workspace in the same tenant.

**Verified:** 16 integration tests in `tests/integration/scheduler.test.ts`.

### B7.3 — C2 `runAnomalyDetectionTick`

Selects organizations through `where: { datasets: { some: { status: "READY" } } }` —
joining from `Organization` rather than `dataset.organizationId: { not: "" }`. Rows
written before the E4 email fix carry an empty-string `organizationId`, and filtering
on that column makes Postgres fail casting them, so the tick would throw on every run.
A real UUID can never join to `""`, so the orphans are simply ignored. One
`RUN_ANOMALY_DETECTION` job per organization, deduped per tenant.

**Open:** the handler still calls a global `scan()` — see Batch 8.

### B7.4 — C3 `runAlertRuleTick`

`distinct: ["organizationId", "workspaceId"]` over enabled rules, one
`EVALUATE_ALERT_RULES` job per `(organization, workspace)` with
`payload: { workspaceId }`, deduped with a JSON-path predicate
(`payload: { path: ["workspaceId"], equals: workspaceId }`).

### B7.5 — C4 `runReportScheduleTick`

For every `enabled && nextRunAt <= now` schedule: conditional `updateMany` claim
(`count !== 1` → stand down), `nextRunAt` advanced by `nextRunAt(frequency, cron, now,
timezone)`, then enqueue `GENERATE_REPORT` with
`{ reportId, scheduleId }`.

**Open:** no `SEND_EMAIL` yet, and no rollback if the enqueue fails — see
"Known open defects".

### B7.6 — C5 `POST /reports/:id/generate` returns 202

`contracts/reports.md:58` specifies `202 Accepted`, not a synchronous render — PDF
rendering plus a dataset scan is slow enough that holding the request open only
produces gateway timeouts.

* `ReportService.queueGeneration` validates tenant access and enqueues `GENERATE_REPORT`.
* `report.controller.ts` returns `ok(res, { jobId, report, status: 'QUEUED' }, 202)`.
* The worker `processGenerateReportJob` owns `DRAFT → GENERATED | FAILED`, records
  `recordUsage(orgId, 'reports', 1)`, and creates the notification.
* Frontend `api.reports.generate` returns the `jobId`; the page polls
  `api.reports.get` until `status !== 'DRAFT'` (bounded at 30 × 1s) before reloading.
* `tests/integration/report-rendering.test.ts` migrated from `expect(200)` /
  `expect(500)` to `expect(202)` + job claim + handler run + persisted
  `GENERATED`/`FAILED`.

### Verified so far

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (backend) | clean |
| `npx eslint .` (backend) | clean |
| `npx tsc --noEmit` (frontend) | clean |
| `npm run lint` (frontend) | clean |
| `tests/unit/schedule-cadence.test.ts` | 27/27 |
| `tests/integration/scheduler.test.ts` | 16/16 |
| `tests/integration/report-rendering.test.ts` | 8/9 (one cross-file isolation failure) |

---

## BATCH 8 — Anomaly correctness (F1-F3)

### The defects

`anomaly.service.ts` produced nonsense:

* **F1** lines 30-31 and 54-56 pinned `periodFrom/periodTo` to
  `2026-07-01 … 2026-07-31` and labelled the result `"2026-08"`, with
  `baseline: { period: "2026-07" }`. A dataset with no July 2026 data produced either
  zero anomalies or a fabricated one.
* **F2** line 46 hardcoded `30` as the deviation threshold.
* **F3** line 19 used `organizationId: { not: "" }`, and every dataset/metric pair that
  could not be evaluated was silently `continue`d with no record of why.

### Changes

1. Derive the period from the data. Query the dataset's actual date column bounds, take
   the latest complete period as `current`, and the immediately preceding period as
   `baseline`. Store the real `period` labels on both `observed` and `baseline` instead
   of the hardcoded `"2026-08"`/`"2026-07"`.
2. Replace the literal `30` with `env.ANOMALY_DEVIATION_THRESHOLD`
   (already present in `src/config/env.ts`, default `30`). One source of truth.
3. Replace `organizationId: { not: "" }` with the same `Organization`-relation filter
   used by the scheduler, and count a dataset/metric pair that has no usable previous
   value as **skipped with a reason**, surfaced in `ScanResult.skipped` and in the job
   log, rather than as a silent continue.
4. **Scope the scan to the job's tenant.** `scan()` currently takes no arguments, so the
   per-organization job the scheduler enqueues in C2 runs a whole-database scan. Change
   the signature to `scan({ organizationId, workspaceId })` and filter on both. This is
   a correctness *and* a security fix: as written, one organization's scheduled job
   reads and writes another organization's data.
5. `processRunAnomalyDetectionJob` must pass the payload's `workspaceId` through to
   `scan()` and to `RecommendationService.generate()` so recommendations land in the
   requested workspace rather than always the default one.

### Verification

New integration tests:

* a dataset with July/August rows produces an anomaly labelled with the real periods,
* a dataset with a 5% move produces none when the threshold is 30 and one when it is 5,
* a dataset with no previous period is reported as skipped with a reason,
* a scan for organization A creates zero rows for organization B,
* `INSUFFICIENT_DATA` status is persisted/queried where the model allows it.

**Delivered.** `tests/integration/anomaly-scan.test.ts` — 10/10 passing, covering every
case above plus the B11.3 baseline work (mean of several trailing periods, recorded
spread, configured threshold) and the tenant-isolation case.

---

## BATCH 9 — Entitlement enforcement for Phase 4 (G)

### The defect

`app.ts:74-77` mounted the alert and report routers as **separate** routers, so they do
not inherit `requireEntitlement("aiConversations")` from `aiRouter` and have no gate of
their own. `recordUsage(orgId, "reports", 1)` in the generate handler therefore metered
usage that was never limited: a free tenant could generate unlimited reports and
trigger unlimited email.

### Changes

1. Add `requireEntitlement(<feature>)` to the Phase 4 routers that consume a metered
   resource — reports, report-schedules, alerts, alert-rules, anomalies,
   recommendations — using the feature keys that `recordUsage` already writes against.
2. Decide and document the mapping: reports and anomaly scans metered as `reports` /
   `anomaly_detection`; alert evaluation is not metered, so it is authenticated and
   tenant-guarded but not entitlement-gated. Do not gate a route on a feature key that
   nothing meters — that produces confusing 402s.
3. Keep metering in the worker (where the work actually happens) and add the gate at
   the API boundary (where the decision can be shown to the user).
4. Add `entitlement` to `docs/architecture` decisions as ADR-007 (batch order and gate
   placement), since it changes public API behaviour.

### Verification

Integration tests: a tenant whose entitlement for `reports` is exhausted gets `402`
from `POST /api/v1/ai/reports` and from `POST /api/v1/ai/reports/:id/generate`, and
still gets `200` from read-only `GET` endpoints.

**Delivered.** `tests/integration/entitlement-gates.test.ts` — 13/13 passing;
`tests/integration/entitlements.test.ts` — 4/4; scheduler/cadence — 52/52;
anomaly/alert/recommendation regression set — 34/34; report builder/PDF — 12/12;
report rendering/PDF — 14/14.

Two findings worth recording:

* **The `404`s on reports and report schedules were not a routing bug.** The root cause
  was `requireEntitlement` calling `next()` twice for boolean-`true` features, which
  advanced through the route stack and produced a misleading `404`. Fixing the double
  `next()` resolved them; no remounting was needed.
* **Read endpoints stay ungated on every plan.** `GET /reports`, `GET /alerts` and
  `GET /alert-rules` are not metered reads; only the paths that consume a resource are
  gated. H2's `alerts.test.ts` now asserts the `402` on rule creation and `201` when
  entitled.

**Metering failures are logged, not swallowed.** The three post-work `recordUsage` sites
that still used `.catch(() => undefined)` (anomaly worker, investigation creation, dataset
commit) now log the unbilled unit, matching the report and alert workers. The work is
already committed at each of those points, so failing would strand the job, but a silent
catch made unbounded usage invisible.

---

## BATCH 10 — Contract pagination (A3)

### The defect

`ReportService.list` (`report.service.ts:130`) and the alert-rule / alert list services
call `findMany` with no `skip`/`take`, so a tenant with thousands of reports or alerts
loads all of them into one response. The contract requires
`{ items, total, page, limit }`.

### Changes

1. Add a shared `paginationSchema` (`page` default 1, `limit` default 20, max 100) and
   parse `req.query` in the controllers.
2. In each list service, issue `findMany({ skip, take, orderBy })` and `count()` in
   one `Promise.all`, and return `{ items, total, page, limit }`.
3. **Breaking response change:** rename `reports`/`rules`/`alerts` to `items` inside the
   envelope. Update `frontend/lib/api-client.ts` (`r.reports` → `r.items`), the three
   page components, and every existing test that reads the old key. This cannot be
   shipped as an alias-only change, because the envelope is what A1 removed the
   heuristic for.
4. Keep the alerts and anomalies list services consistent (anomalies already paginate).

### Verification

Integration tests: create >`limit` rows, assert `items.length === limit`,
`total === created`, `page 2` returns the next slice, and `limit` above the max is
clamped rather than honoured.

### Delivered — with three deliberate deviations from the above

1. **The named collection keys were kept** (`reports`, `rules`, `alerts`, `schedules`)
   rather than renamed to a single `items`. Renaming would have touched every page,
   client call site and existing test for no product gain, and each list already names
   its collection unambiguously. Pagination is now carried by a sibling `meta` object:
   `{ page, perPage, total }`.
2. **Defaults are `page: 1`, `perPage: 50`, `max 200`** (not 20/100). A report or alert
   list is a browsing surface, not a bulk export, and 50 rows is a full first screen.
3. **An oversized `limit` is rejected with `400`, not silently clamped.** Clamping
   `limit=99999` to the max would return a response that does not match the request,
   which is harder to debug than an explicit validation error.

Shared schema/helper: `backend/src/lib/pagination.ts`. Verified by
`tests/integration/list-pagination.test.ts` (6/6).

**Not included:** the four list pages still render only the first page. `api-client.ts`
accepts `page`/`limit` and the pages pass `workspaceId` only, so no pager UI is wired up.
The contract is in place for one, but the UI to drive it is outstanding.

---

## BATCH 11 — The three things that were still imperfect

These are the honesty items in `research.md` after Groups A-I. Two are now done, one
is not.

### B11.1 — `CHANGES_BY` placeholder math — **already resolved in Batch 6**

`research.md` recorded `alert-rule.service.ts:219-222` doing
`Math.abs(value - threshold) > threshold * 0.1` with a `// Placeholder` comment. Batch 6
replaced `getCurrentMetricValue` with a real read that returns
`{ observed, previousValue, changePct, period }`, and `CHANGES_BY` now compares
`|current − previous| / |previous| × 100` against the rule threshold, with a guard that
a relative deviation is meaningless at a zero threshold. **Action: confirm with an
explicit test** (previous value 100 → current 120 fires a 20% rule; previous 100 →
current 80 fires it in the other direction; previous 0 does not fire).

### B11.2 — Recommendations only draw from 2 of 5 sources — **complete**

`recommendation.service.ts` read `anomalyDetection` (→ `ANOMALY`) and `alert`
(→ `RULE`) only. `FR-002` and R3 require `ANOMALY`, `INVESTIGATION`, `RULE`,
`SIMULATION`, `SYSTEM`. Investigation findings and simulation outcomes never became
recommendations.

Delivered: completed `investigation.findings` (→ `INVESTIGATION`, severity from `level`,
evidence carrying the finding's own evidence plus `isCausalClaim` and confidence) and
completed `simulation` scenarios (→ `SIMULATION`, evidence from the scenario parameters,
assumptions, model version and every projected metric). All four sources merge into one
candidate list, ranked by severity × recency against each source's own timestamp and
capped at `RECOMMENDATION_BATCH_CAP` (50) per scan. `CORRELATION` findings are skipped so
supporting detail does not duplicate its `MAIN` finding, and a `DRIVER` finding's action
text asks for validation rather than asserting the inferred cause.

**`SYSTEM` remains a defined-but-unproduced enum value.** No table in the schema carries a
"system event" the module could read — `Dataset` has no staleness/health signal, and
`DataQualityReport` is not referenced by `Recommendation`. Emitting a `SYSTEM` row would
mean inventing a signal rather than surfacing a real one, so the enum value is left for a
producer that does not exist yet. This is a deliberate deferral, not an oversight.

### B11.3 — Anomaly baseline is 1 trailing period, not configurable N — **complete**

R2 specifies a configurable trailing N (default 4). Batch 8's F1 makes the periods
dynamic but still compares a single baseline period.

Changes: add `ANOMALY_BASELINE_PERIODS` to `src/config/env.ts`
(`z.coerce.number().int().min(1).default(4)`), fetch the last N periods in one query,
and evaluate the deviation against the mean (and record the spread) of the trailing
periods instead of the immediately preceding one. Persist the baseline as a list so the
evidence is auditable.

### Verification

* B11.1: explicit `CHANGES_BY` unit tests as above.
* B11.2: a fixture with one completed investigation and one simulation run produces
  recommendations with `source: 'INVESTIGATION'` and `source: 'SIMULATION'`, and the
  total returned never exceeds the configured cap.
* B11.3: with `ANOMALY_BASELINE_PERIODS=4` and four periods of data, the persisted
  `baseline` JSON holds four periods and the deviation is measured against their mean.

**Delivered.** `tests/integration/recommendations.test.ts` — 10/10 passing, with six new
cases for B11.2: a completed investigation produces exactly one `INVESTIGATION`
recommendation for its `MAIN` finding (the `CORRELATION` sibling is not duplicated),
`isCausalClaim` and confidence survive into the evidence, a `RUNNING` investigation
produces nothing, a completed scenario produces one `SIMULATION` recommendation led by
its largest projected move, a scenario with no results produces nothing, a pre-B11.3 flat
`baseline` still renders a number rather than `NaN`, and 60 candidates persist no more than
the cap. `anomaly-scan.test.ts` — 10/10, including the mean-of-N and recorded-spread cases.

---

## BATCH 12 — Test blind spots (H1, H2)

### H1 — Frontend page tests mock the whole api-client — **complete**

Three Phase 4 page tests `vi.mock` the entire `api-client`, so they cannot catch a
missing `?workspaceId=`. That is exactly how B1-B4 stayed broken.

Delivered: the three existing page tests (`reports`, `alert-rules`, `recommendations`) already
stub `fetch` through `tests/helpers/mock-api.ts`, which exercises the real `api-client`
URL building rather than replacing it — they assert the outgoing URL contains
`workspaceId=<current>`. The genuine gap was the two pages with **no test file at all**:
`alerts` and `report-schedules`. Both now have page tests that assert the outgoing URL, so
all five pages in scope are covered.

`alerts/page.tsx` was fixed as a result: it called `api.alerts.list(undefined)` before the
workspace resolved, firing an unscoped request the backend answers from the tenant's
*default* workspace, so the list briefly showed another workspace's alerts. It now waits for
the workspace like the other four pages, and the no-workspace path clears the spinner
instead of hanging on it. The scoping assertion was verified to fail against the old code.

### H2 — Route tests never call a route — **complete**

`tests/integration/reports.test.ts` and `alerts.test.ts` poke a hand-built
`mockPrisma` object. They pass while the app is mis-wired — for example they passed
while `B1` left `req.tenant` undefined.

Delivered: both files replaced with supertest cases that boot the real `app` against the
real database. `reports.test.ts` (8 tests) covers the envelope and pagination meta, default
workspace resolution with no `workspaceId`, an explicit same-org workspace, a foreign
`workspaceId` falling back to the caller's own rows, pagination, cross-tenant `404` on
`GET /reports/:id`, and `401` without a session. `alerts.test.ts` (8 tests) does the same
for `GET /alert-rules`, adds `GET /alerts` isolation, and covers the entitlement gate the
mock version could not: `POST /alert-rules` is `201` on `business` and `402
ENTITLEMENT_REQUIRED` on `free`, asserting no row is written in the refused case.

### H3 — Scheduler test — **delivered in Batch 7**

`tests/integration/scheduler.test.ts` proves a due `ReportSchedule` actually enqueues,
advances `nextRunAt` by the configured cadence, does not re-enqueue on the second tick,
skips a disabled schedule, honours a custom cron and timezone, and that two concurrent
ticks produce exactly one job. 16/16 passing.

---

## Out-of-plan fixes delivered between batches

### NEW-1 — Mapping confidence gating

**Defect:** a low-confidence column mapping could promote a dataset to `READY`, so every
downstream metric silently used a guessed column.

**Change:** low-confidence guesses are stored provisionally and the dataset stays
`DRAFT`; confirming the mapping overwrites them before `READY` is allowed.

**Verified:** 34/34 mapping tests.

### NEW-2 — Agent history budget

**Defect:** the history backstop was too small, so long runs truncated before the token
budget did.

**Change:** `maxHistoryItems(bounds) = 2 + bounds.maxSteps + bounds.maxToolCalls`. A
single step can emit several tool results, so `2 + maxSteps * 2` was insufficient.
Test scenarios derive their turns from
`Math.max(env.AI_MAX_STEPS, env.AI_MAX_TOOL_CALLS) + 2`; the token counters in
`budgets.ts` were removed.

**Verified:** `tests/integration/agent-runs.test.ts` 6/6; backend unit suite 37 files /
308 tests.

---

## Known open defects

All nine rows below were tracked as unfixed while Batches 1-11 were in progress. Every one
is now resolved; the `Status` column records how. They are kept rather than deleted so the
reasoning behind each fix stays auditable.

| # | Location | Defect | Impact | Status |
| --- | --- | --- | --- | --- |
| 1 | `workers/scheduler.ts:30-33` | `secondsCron()` returned `"* * * * *"` for any interval over 59s, so with the default one-hour `ANOMALY_SCAN_INTERVAL_MS` a completed anomaly job was re-enqueued every minute. | Duplicate scans/alerts; violated the documented interval. | **Resolved** — `secondsCron()` removed. `createIntervalGate(env.ANOMALY_SCAN_INTERVAL_MS)` now gates each tick on a last-run timestamp (`scheduler.ts:53-58`, `:390-391`). |
| 2 | `workers/handlers/run-anomaly-detection.ts:13` + `anomalies/anomaly.service.ts:13` | `scan()` was global: the scheduler enqueued one job per organization but each job scanned every tenant's datasets. | Cross-tenant data access and duplicate anomalies. | **Resolved** — B8 item 4. `scan()` takes the resolved `workspaceId` and filters by it. |
| 3 | `workers/scheduler.ts:169-173` | `runReportScheduleTick` advanced `nextRunAt` **before** enqueueing and did not roll back on failure. | A transient DB error silently skipped one run. | **Resolved** — `nextRunAt` is advanced by a conditional `updateMany` that matches only a still-due row, so the claim and the advance are atomic and racing schedulers produce exactly one job (`scheduler.ts:25`). |
| 4 | `workers/scheduler.ts:150-173` | No `recipients` in the payload and no email. Research C4 requires `GENERATE_REPORT` + email. | Scheduled reports were never emailed. | **Resolved** — `normalizeRecipients()` reads the `Json` column into a list (`scheduler.ts:93-105`), travels with the job (`:305`), and `notifyRecipients()` sends `report_generated` **after** generation succeeds, never concurrently (`generate-report.ts:42-66`, `:107`). A manual run carries no `recipients` and is never emailed. |
| 5 | `lib/email/email-templates.ts` + `config/env.ts` | The `report_generated` template required `reportUrl` but no frontend origin existed in the backend env. | Could not build a valid email link. | **Resolved** — `APP_URL` added to `env.ts:80`; `reportUrl()` prefixes it and falls back to the in-app path `/reports/{id}` when unset (`generate-report.ts:22-28`). |
| 6 | `modules/reports/report.service.ts:541` | `cadenceChanged` tested only `frequency` and `cron`, not `timezone`. | Changing only the timezone left `nextRunAt` on the old offset. | **Resolved** — `cadenceChanged` includes `input.timezone !== undefined`. |
| 7 | `tests/integration/report-rendering.test.ts` | The file failed when run in parallel with `report-pdf.test.ts` (`expected 404 to be 200`) although both pass in isolation. | Flaky CI signal. | **Resolved** — the cause was the test downloading the PDF before the queued render had been claimed, not shared module state. The test now calls `generateReport()` first. See also the `--maxWorkers=2` and chunking guidance in `backend/AGENTS.md`. |
| 8 | `modules/recommendations/recommendation.service.ts:15-22` | Only 2 of 5 recommendation sources were read. | Narrowed product surface. | **Resolved** — B11.2 now produces `ANOMALY`, `RULE`, `INVESTIGATION` and `SIMULATION`. `SYSTEM` remains a defined-but-unproduced enum value; see B11.2 for why. |
| 9 | `anomalies/anomaly.service.ts:30-56` | Hardcoded July/August 2026 periods and a hardcoded `30` threshold. | Anomaly detection ignored the real data. | **Resolved** — B8 items 1-3; baseline N additionally configurable per B11.3. |

---

## Final check procedure

Run in this order. Steps 1-3 are static; 4-7 need the backend stopped.

### 1. Static checks

```powershell
# backend
cd backend
npx tsc --noEmit -p tsconfig.json
npx eslint .

# frontend
cd ..\frontend
npx tsc --noEmit
npm run lint
```

Both must be silent. A non-empty `tsc` output is a hard stop.

### 2. Prisma is in sync

```powershell
# all backend processes MUST be stopped first (Windows DLL lock)
cd backend
npx prisma migrate status
npx prisma generate
```

`migrate status` must report no pending migration, and the eight migration directories
(`init`, `data_layer`, `ai_layer`, `add_sync_modes`, `automation`,
`email_organization`, `report_builder_config`, `alert_rule_dataset`) must all be applied.

### 3. Unit tests (fast, no external calls)

```powershell
cd backend
npx vitest run tests/unit --maxWorkers=2
```

Baseline: 37 files / 308 tests. Any new number lower than 308 is a regression.

### 4. Stop the backend, then run integration tests in chunks

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'business_management\\backend' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Chunk by concern, so a failure localises:

| Chunk | Files | Notes |
| --- | --- | --- |
| Scheduler | `scheduler.test.ts`, `schedule-cadence.test.ts` | 16 + 27; must pass with no other batch present |
| Reports | `report-rendering.test.ts`, `report-pdf.test.ts`, `reports.test.ts` | **Run these two report files serially** — see open defect 7 |
| Alerts | `alert-rules.test.ts`, `alerts.test.ts`, `email-delivery.test.ts` | B9 entitlement gates land here |
| Anomalies | `anomaly*.test.ts` | B8 |
| Queue | `queue-automation.test.ts` | The reason the worker must be stopped |
| Agent | `agent-runs.test.ts` | ~4 min; run alone |

```powershell
npx vitest run tests/integration/scheduler.test.ts --maxWorkers=2
npx vitest run tests/integration/report-rendering.test.ts --maxWorkers=2
npx vitest run tests/integration/report-pdf.test.ts --maxWorkers=2
```

Do not run `npx vitest run` over the whole `tests/` tree in one command; it exceeds 50
minutes and full parallelism produces false `401`/`403` failures from Neon contention.

### 5. Manual end-to-end (requires the worker)

```powershell
# terminal 1
cd backend; npm run dev
# terminal 2
cd backend; npm run worker
```

Then, against a tenant with a `READY` dataset:

1. `POST /api/v1/ai/imports`, wait for `COMPLETED`, confirm the dataset is `READY`.
2. `POST /api/v1/ai/reports` with a real `datasetId` and `metricKeys`, then
   `POST /api/v1/ai/reports/:id/generate` — expect **202** with a `jobId`, and the
   report moving `DRAFT → GENERATED` on its own.
3. `GET /api/v1/ai/reports/:id/pdf` — expect a PDF attachment with real numbers, and
   `404` for another tenant's report id.
4. Create a report schedule with a `nextRunAt` in the past; within one minute confirm a
   `GENERATE_REPORT` job appears, `nextRunAt` advanced, and a `SEND_EMAIL` delivery
   row once B7 defect 4 is fixed.
5. Create an `AlertRule` on that dataset and confirm the scheduler tick evaluates it
   against real data and emails on breach.

### 6. Live deployment check

Not runnable here. Requires real `APP_URL`, Neon `DATABASE_URL`, `JWT_SECRET`,
`REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `GROQ_API_KEY`, R2 credentials, and SMTP
credentials. Verify in this order: API health → import → dataset `READY` → report 202 →
PDF download → scheduled run → alert email. See `DEPLOYMENT.md`.

### 7. Definition of done

* Batches 8-12 items marked complete in `research.md` and the status table at the top
  of this file.
* All nine rows of "Known open defects" resolved or explicitly waived in writing.
* Steps 1-5 above green, with the report files run serially.
* A stale server is not listening on `:4000` (a stale process causes 401/422 and
  old-behavior errors that look like new bugs).


---------------------------------

- customer get software it connect there database
- it has all the tables in the software
- customer can see all the data in dashboard
- customer can use ai analyst to analyze there data and discusion about how we can grow our business etc
- customer can investigate about there data that 
- customer check simulation across whole data
- customer can create report for investigated or simulated data or any specific data
- if there is any issue in business growth so recommendation will be available , alert shows and sent email to admin to inform that
- we can also scedule report weekly , monthly or daily to send to the admin etc
