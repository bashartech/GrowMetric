---
description: "Task list for Phase 2 — Data Layer"
---

# Tasks: Phase 2 — Data Layer

**Input**: Design documents from `/specs/002-data-layer/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: INCLUDED — the phase gate (plan.md) and FR-031 require unit + integration tests in every phase.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7, mapping to the spec's user stories
- Exact file paths are included in every task

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`, `backend/prisma/`, `backend/uploads/`
- Frontend: `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add Phase 2 dependencies and environment plumbing on top of the Phase 1 foundation.

- [x] T001 Add Phase 2 backend dependencies to `backend/package.json`: `exceljs`, `csv-parse`, `multer`, `file-type`, `pg`, `@aws-sdk/client-s3`, `ioredis`
- [x] T002 [P] Add `recharts` to `frontend/package.json`
- [x] T003 Extend `backend/src/config/env.ts` and `backend/.env.example` with zod-validated vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `UPLOAD_DIR`, `IMPORT_ROW_CAP`, `IMPORT_MAX_FILE_BYTES`, `DATA_SOURCE_ENCRYPTION_KEY`, `REDIS_URL` (fail-fast; secrets redacted in errors)
- [x] T004 [P] Add `backend/uploads/` to `.gitignore` (dev storage fallback; never committed)
- [x] T005 Add `worker` script to `backend/package.json` (`tsx src/workers/index.ts`)
- [x] T006 [P] Create test fixtures in `backend/tests/fixtures/` (small valid CSV, invalid CSV, valid XLSX generated via exceljs, oversize stub) and a shared `backend/tests/helpers/storage-mock.ts`

**Checkpoint**: ✅ Both apps install; env loader validates new vars; worker script resolves.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database models, core ingestion/analytics libraries, and worker skeleton. Blocks all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database

- [x] T007 Extend `backend/prisma/schema.prisma` with the 18 Phase 2 models and enums from data-model.md (DataSource → DashboardWidget; split value tables with composite `@@id([rowId, columnId])`)
- [x] T008 Generate and apply the new migration: `npx prisma migrate dev --name data_layer` and `npx prisma generate`
- [x] T009 [P] Update `backend/prisma/seed.ts`: seed canonical BusinessMetric definitions (revenue, orders, customers, expenses, profit, inventory) idempotently by `kind`

### Backend core libs (block all workers/modules)

- [x] T010 [P] Implement `backend/src/lib/storage.ts` — object-storage interface (`put`, `getObjectMetadata`) with R2 (AWS SDK S3 client) and local `uploads/` fallback based on `UPLOAD_DIR`/R2 envs (R1)
- [x] T011 [P] Implement `backend/src/lib/files.ts` — file validation: size ≤ 25 MB, extension allowlist (`.csv`, `.xlsx`), magic-byte/content check, SHA-256 checksum
- [x] T012 [P] Implement `backend/src/lib/parser.ts` — streaming CSV (`csv-parse`) and XLSX (`exceljs`, streaming mode) to rows+headers; one file → one sheet (first/default); 200k row cap (R2)
- [x] T013 [P] Implement `backend/src/lib/infer.ts` — 200-row sampled type voting; per-column `ColumnType` inference (TEXT/INTEGER/DECIMAL/BOOLEAN/TIMESTAMP/DATE/TIME); ≥95% confidence; mixed → TEXT + warning (R3)
- [x] T014 [P] Implement `backend/src/lib/mapping-rules.ts` — deterministic canonical-meaning rules (revenue, orders, customers, products, inventory, expenses, order_date, region, ...) with confidence; emits candidate list + low-confidence flag (R4)
- [x] T015 [P] Implement `backend/src/lib/quality.ts` — quality metrics computation: missing%, duplicate%, invalid number/date%, IQR numeric outlier count, per-column warnings → `DataQualityReport` payload
- [x] T016 Implement `backend/src/lib/external-db.ts` — `pg` connector with read-only enforcement (`default_transaction_read_only=on` + verify `SHOW transaction_read_only`), `information_schema` table discovery, streaming SELECT with row cap (R6)
- [x] T017 Implement `backend/src/lib/analytics-sql.ts` — column-pruned SQL builders for SUM/AVG/COUNT/MIN/MAX, group-by, and compare-periods (no raw string interpolation of identifiers; parameterized values) (R5)
- [x] T018 Implement `backend/src/middleware/upload.ts` — multer config: 25 MB limit, temp/memory handling, wires `files.ts` validation result into the request
- [x] T019 [P] Add foundation unit tests (write first, must fail): `backend/tests/unit/infer.test.ts`, `backend/tests/unit/mapping-rules.test.ts`, `backend/tests/unit/quality.test.ts`, `backend/tests/unit/files.test.ts`
- [x] T020 [P] Add unit tests (write first, must fail): `backend/tests/unit/analytics-sql.test.ts` (QUERY TEXT only, no exec), `backend/tests/unit/storage.test.ts` (local fallback round-trip), `backend/tests/unit/parser.test.ts`
- [x] T021 Implement worker loop + registry: `backend/src/workers/index.ts`, `backend/src/workers/registry.ts` (job type → handler: `IMPORT_DATA`, `SYNC_DATABASE`); polls the Phase 1 `jobs` table and offers optional Redis `BRPOP` signal when `REDIS_URL` set (R7)
- [x] T022 [P] Extend entitlement/usage enforcement: add feature keys for `data_sources`, `imports`, `datasets` to the Free plan limits; hook usage recording + `ENTITLEMENT_REQUIRED` checks into data-source/import creation (FR-032)

**Checkpoint**: ✅ DB migrates + seeds; core libs unit-tested; worker boots and completes a stubbed queued job.

---

## Phase 3: User Story 1 — Upload Business Data Files and Track Processing (Priority: P1) 🎯 MVP

**Goal**: File upload → data source + import created atomically; async processing with visible status; validation rejections.
**Independent Test**: Upload a valid CSV and XLSX; each is accepted with an immediate QUEUED import; import completes with row count. Oversize/bad-type rejected with a clear message.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T023 [P] [US1] Integration test: `POST /data-sources` (multipart) creates DataSource + ImportJob (`QUEUED`) + Job atomically, returns immediately in `backend/tests/integration/data-sources-upload.test.ts`
- [x] T024 [P] [US1] Integration test: file validation rejections (oversize, bad extension, magic-byte mismatch, empty) in `backend/tests/integration/data-sources-upload.test.ts`
- [ ] T025 [P] [US1] Component test: upload dropzone accepts/rejects files and shows import status in `frontend/tests/unit/upload-form.test.tsx`

### Implementation for User Story 1

- [x] T026 [US1] Implement `backend/src/modules/data-sources/data-source.schema.ts` (multipart + name) and `data-source.service.ts` — `createFileSource()`: validate via `files.ts`, store via `storage.ts`, create ImportFile + Job + ImportJob + DataSource in one transaction, write `data-source.create` / `import.create` audit
- [x] T027 [US1] Implement `import-data` worker handler `backend/src/workers/handlers/import-data.ts`: `QUEUED → RUNNING` → parse → profile → store import-file row/column summaries → `COMPLETED`/`FAILED` (partial pipeline; dataset building lands in US2)
- [x] T028 [US1] Implement `data-source.controller.ts` + `routes.ts`: `POST /data-sources`, `GET /data-sources`, `GET /data-sources/:id`, `PATCH /data-sources/:id`, `DELETE /data-sources/:id`
- [x] T029 [US1] Implement `backend/src/modules/imports/import.controller.ts` + `routes.ts`: `GET /imports`, `GET /imports/:id`, `POST /imports/:id/cancel`, `POST /imports/:id/retry`
- [x] T030 [US1] Mount `data-sources` and `imports` routers under `/api/v1` in `backend/src/app.ts`; apply upload middleware to `POST /data-sources`
- [x] T031 [P] [US1] Extend `frontend/lib/api-client.ts` (multipart upload support, poll helper) and mirror Phase 2 DTOs in `frontend/lib/types.ts`
- [x] T032 [US1] Implement Datasets shell entry: `frontend/app/(app)/data-hub/data-sources/page.tsx` (list data sources + create FILE source via dropzone with RHF name field)
- [x] T033 [US1] Implement `frontend/components/data/import-status.tsx` (poll QUEUED/RUNNING/COMPLETED/FAILED) and `frontend/app/(app)/data-hub/imports/page.tsx` (import history list)
- [x] T034 [US1] Run and fix US1 tests; verify upload never blocks the request path (returns import ID < 2 s) (SC-002)

**Checkpoint**: ✅ US1 backend + frontend complete; tests written, execution pending.

---

## Phase 4: User Story 2 — Explore Datasets with Schema and Quality Status (Priority: P1)

**Goal**: Completed imports become versioned datasets with visible columns/types, row count, readiness, and quality report.
**Independent Test**: With a completed import, Datasets area shows name/status/rows/columns; quality view renders from real import data; cross-tenant access denied.

### Tests for User Story 2 ⚠️

- [x] T035 [P] [US2] Integration test: dataset list/detail + column types after import in `backend/tests/integration/datasets.test.ts`
- [x] T036 [P] [US2] Integration test: data-quality report endpoint (current + versioned) in `backend/tests/integration/data-quality.test.ts`
- [x] T037 [P] [US2] Integration test: tenant isolation for datasets/quality/imports (cross-tenant → 404 + recorded) in `backend/tests/integration/tenant-isolation-data.test.ts`
- [x] T038 [P] [US2] Component test: dataset detail/schema view in `frontend/tests/unit/dataset-view.test.tsx`

### Implementation for User Story 2

- [x] T039 [US2] Implement `backend/src/modules/datasets/dataset.repo.ts` — versioned creation in one transaction (Dataset + DatasetVersion + DatasetColumns + split value-table rows), scoped queries by org/workspace
- [x] T040 [US2] Implement `dataset.service.ts` + `controller.ts` + `routes.ts`: `GET /datasets`, `GET /datasets/:id`, `PATCH /datasets/:id`, `GET /datasets/:id/versions`, `GET /datasets/:id/rows`
- [x] T041 [US2] Wire `import-data` handler to call `dataset.repo` on completion (build Dataset + Version 1 + columns + rows from parsed data); set status from quality result
- [x] T042 [US2] Implement `backend/src/modules/data-quality/quality.service.ts` + routes: `GET /datasets/:id/quality`, `?version=`, `POST /.../recompute`; attach a `DataQualityReport` per version (R3/R5)
- [x] T043 [US2] Implement `frontend/app/(app)/data-hub/datasets/page.tsx` (list) + dataset detail panel (columns, types, samples, status, row count)
- [x] T044 [US2] Implement `frontend/app/(app)/data-hub/data-quality/page.tsx` (report view: totals + per-column warnings + READY_WITH_WARNINGS banner)
- [x] T045 [US2] Run and fix US2 tests

**Checkpoint**: ✅ US2 backend + frontend complete; datasets + quality visible and isolated (tests pending).

---

## Phase 5: User Story 3 — Confirm Column Mapping When Confidence Is Low (Priority: P2)

**Goal**: Imports with ambiguous/low-confidence mappings pause for user confirmation before analytics-readiness.
**Independent Test**: Import a file with an ambiguous column; system pauses `REQUESTING_MAPPING`; confirmation applies the mapped meaning and marks the dataset analytics-ready.

### Tests for User Story 3 ⚠️

- [x] T046 [P] [US3] Integration test: import pauses `REQUESTING_MAPPING`; `POST /datasets/:id/confirm-mapping` completes import + applies mappings in `backend/tests/integration/mapping-confirm.test.ts`
- [x] T047 [P] [US3] Unit test: `mapping-rules` emits candidate list + confidence for an ambiguous column (extend `backend/tests/unit/mapping-rules.test.ts`)
- [x] T048 [P] [US3] Component test: mapping confirmation dialog in `frontend/tests/unit/mapping-dialog.test.tsx`

### Implementation for User Story 3

- [x] T049 [US3] Extend `import-data` handler: when mappings low-confidence/ambiguous, transition import to `REQUESTING_MAPPING` (persist candidate mappings in the ImportJob/version summary) and do NOT mark the dataset analytics-ready (FR-009/FR-010)
- [x] T050 [US3] Implement `POST /datasets/:id/confirm-mapping` in `dataset.service.ts` + controller: apply `semanticKey`/`businessMeaning` per column; transition import `REQUESTING_MAPPING → COMPLETED`, dataset → `READY`/`READY_WITH_WARNINGS`
- [x] T051 [US3] Include `semanticKey`/`businessMeaning`/`representativeSample` in dataset DTOs for mapping UX + `analytics` quality gate
- [x] T052 [US3] Implement `frontend/components/data/mapping-confirm.tsx` (candidates + sample values) wired into the import/dataset flow
- [x] T053 [US3] Run and fix US3 tests

**Checkpoint**: US1–US3 independently functional; ambiguous data is never silently treated as analytics-ready.

---

## Phase 6: User Story 4 — Review Import History and Dataset Versions (Priority: P2)

**Goal**: Full provenance: import history (metadata, ordering, safe failures) + dataset version history with commit strategies.
**Independent Test**: Two imports into one dataset → both appear in Import History and version history with correct metadata; neither overwrote the other silently.

### Tests for User Story 4 ⚠️

- [x] T054 [P] [US4] Integration test: import history list order/metadata + failed import safe summary in `backend/tests/integration/imports-history.test.ts`
- [x] T055 [P] [US4] Integration test: dataset version list reflects every import with commit/source in `backend/tests/integration/versions.test.ts`
- [x] T056 [P] [US4] Component test: versions + history view in `frontend/tests/unit/history-view.test.tsx`

### Implementation for User Story 4

- [x] T057 [US4] Ensure `import-data` records full metadata (filename, source, row counts, error summary, started/completed timestamps) on the ImportJob and creates one DatasetVersion per import (FR-012/SC-005)
- [x] T058 [US4] Extend import service query layer: `GET /imports` reverse-chronological with `status`/`dataSourceId` filters and `meta` pagination (FR-022)
- [x] T059 [US4] Implement `frontend/app/(app)/data-hub/imports/page.tsx` full view: source, filename, rows, status, timestamps, safe error display
- [x] T060 [US4] Implement dataset version history panel in `frontend/components/data/version-list.tsx` (current version + commit badge + per-version metadata)
- [x] T061 [US4] Run and fix US4 tests

**Checkpoint**: US1–US4 independently functional; provenance is transparent and complete.

---

## Phase 7: User Story 5 — View a Workspace-Level Dashboard with KPIs, Charts, and Filters (Priority: P2)

**Goal**: Dashboard renders real KPIs/charts; filters recompute everything; missing data shows honest empty states.
**Independent Test**: With a supported dataset, dashboard shows KPIs+charts from real data; filters update widgets; a missing metric area shows an honest empty state.

### Tests for User Story 5 ⚠️

- [x] T062 [P] [US5] Integration test: `POST /analytics/metrics`, `compare-periods`, `group-by` return correct aggregates + `changeAvailable` semantics in `backend/tests/integration/analytics.test.ts`
- [x] T063 [P] [US5] Integration test: dashboard preview applies filters and returns `no_data` state for missing metrics in `backend/tests/integration/dashboard-preview.test.ts`
- [x] T064 [P] [US5] Unit test: analytics SQL builder correctness with filters/periods (extend `backend/tests/unit/analytics-sql.test.ts`)
- [x] T065 [P] [US5] Component test: dashboard renders KPI/line/bar/pie + empty states in `frontend/tests/unit/dashboard-render.test.tsx`

### Implementation for User Story 5

- [x] T066 [US5] Implement `backend/src/modules/analytics/metrics.service.ts` — compute (SUM/AVG/COUNT/MIN/MAX), compare-periods, group-by using `analytics-sql.ts`; enforce the READY_WITH_WARNINGS quality gate → `CONFLICT` (FR-015)
- [x] T067 [US5] Implement `metrics.controller.ts` + `routes.ts`: `POST /analytics/metrics`, `POST /analytics/compare-periods`, `POST /analytics/group-by`
- [x] T068 [US5] Implement `backend/src/modules/dashboards/dashboard.service.ts` + `controller.ts` + `routes.ts`: default dashboard per workspace, widget CRUD, `POST /dashboards/:id/preview` (compute widget data live) (R8)
- [x] T069 [US5] Add dashboard/seed wiring: create default Dashboard + default KPI/widget set for a workspace when its first READY dataset lands
- [x] T070 [P] [US5] Implement `frontend/components/charts/` recharts wrappers: `kpi-card.tsx`, `line-chart.tsx`, `bar-chart.tsx`, `pie-chart.tsx`, `data-table.tsx` (typed, responsive)
- [x] T071 [US5] Implement `frontend/app/(app)/dashboard/page.tsx`: load preview, render widget grid, filter bar (date/product/category/region/customer), honest no_data/empty/error states (FR-026/FR-027)
- [x] T072 [US5] Run and fix US5 tests

**Checkpoint**: ✅ US1–US5 independently functional; dashboard delivers visible business insight from real data.

---

## Phase 8: User Story 6 — Connect an External Database (Read-Only) and Select Tables (Priority: P3)

**Goal**: EXTERNAL_DB data sources: connect, verify read-only, list tables, select, sync into datasets; credentials never exposed.
**Independent Test**: Connect a read-only PostgreSQL; verify read-only; list+select tables; sync produces datasets; credentials absent from API/logs/audit.

### Tests for User Story 6 ⚠️

- [x] T073 [P] [US6] Integration test: create EXTERNAL_DB source → read-only verified → tables listed → sync creates datasets (uses a test PG or mocked driver behind `external-db.ts`) in `backend/tests/integration/external-db.test.ts`
- [x] T074 [P] [US6] Integration test: credential is never present in any API response/error; read-only refusal returns `EXT_DB_NOT_READ_ONLY` in `backend/tests/integration/external-db.test.ts`
- [x] T075 [P] [US6] Unit test: credential encryption round-trip via `lib/crypto.ts` (AES-256-GCM) in `backend/tests/unit/external-db-crypto.test.ts`
- [x] T076 [P] [US6] Component test: external-db connection form + table selection in `frontend/tests/unit/external-db-form.test.tsx`

### Implementation for User Story 6

- [x] T077 [US6] Implement `external-db.ts` full path: connect, verify read-only, discover tables (`information_schema`, exclude system schemas), streaming SELECT with cap (R6)
- [x] T078 [US6] Implement `POST /data-sources/external-db` schema/service: encrypt credentials (AES-256-GCM), verify read-only before storing, set `CONNECTED`, write `data-source.create` audit, NEVER return credentials (FR-019/FR-021)
- [x] T079 [US6] Implement `GET /data-sources/:id/tables`, `PATCH /data-sources/:id/tables` (isSelected update; FR-020)
- [x] T080 [US6] Implement `POST /data-sources/:id/sync`: create sync Job + per-table ImportJobs (`SYNC_DATABASE`), respond immediately with import IDs (FR-005/R7)
- [x] T081 [US6] Implement `backend/src/workers/handlers/sync-database.ts`: per-table read-only SELECT → same profile/infer/map/store pipeline → datasets with `sourceTable` provenance
- [x] T082 [US6] Implement external-db create form + table selection + sync button in `frontend/app/(app)/data-hub/data-sources/page.tsx` (SSL mode, PG-only in Phase 2)
- [x] T083 [US6] Run and fix US6 tests

**Checkpoint**: ✅ US1–US6 independently functional; external DB sync works with zero credential exposure (SC-010).

---

## Phase 9: User Story 7 — Update Existing Datasets without Losing History (Priority: P3)

**Goal**: Re-import with append/replace/upsert; version history preserves every operation.
**Independent Test**: Append then replace a dataset; history shows both versions; current data matches the last operation.

### Tests for User Story 7 ⚠️

- [x] T084 [P] [US7] Integration test: re-import append/replace/upsert produce correct version rows in `backend/tests/integration/reimport.test.ts`
- [x] T085 [P] [US7] Unit test: commit-strategy merge (append rows, replace current, upsert-by-key) in `backend/tests/unit/commit-strategy.test.ts`
- [x] T086 [P] [US7] Component test: re-import form (file + commit strategy selector) in `frontend/tests/unit/reimport-form.test.tsx`

### Implementation for User Story 7

- [x] T087 [US7] Extend `import-data` handler + `dataset.repo`: commit strategy handling on re-import (APPEND new rows; REPLACE current-version rows; UPSERT by a validated key column) creating a new DatasetVersion per operation (FR-012/SC-005)
- [x] T088 [US7] Implement `POST /datasets/:id/re-import` schema/service/controller: multipart file + `commit` + `upsertKey` (required for UPSERT), returns QUEUED import
- [x] T089 [US7] Implement re-import dialog + current version/commit badge in `frontend/components/data/reimport-form.tsx` and dataset detail
- [x] T090 [US7] Run and fix US7 tests

**Checkpoint**: ✅ US1–US7 — all seven user stories independently functional; data stays current without loss.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Harden, document, and pass the phase gate.

- [x] T091 [P] Create `docs/architecture/ADR-004` (relational-split value storage) and `docs/architecture/ADR-005` (jobs table as system of record with Redis as signal layer) with user consent (Principle XXV)
- [x] T092 [P] Run security review against `.opencode/skills/code-quality/references/security-checklist.md`; fix findings (file upload validation, credential handling, SQL injection in analytics builders, tenant isolation, R2 key handling)
- [x] T093 [P] Add structured logging on worker handlers + analytics service; verify pino redaction of credentials/file payloads with a test in `backend/tests/unit/logger.test.ts`
- [x] T094 Verify quickstart.md end-to-end manually and record results in `specs/002-data-layer/quickstart-verification.md`
- [x] T095 Run the full phase gate: backend `typecheck` + `lint` + `test`; frontend `typecheck` + `lint` + `test` + `build`; record output
- [x] T096 Fix any gate failures and re-run until green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies beyond Phase 1 foundation.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–9)**: Depend on Foundational. US1 precedes US2 (dataset building consumes imports); US3 depends on US1/US2 pipeline; US4 can run parallel to US3; US5 depends on US2 (datasets) + US4 (versions for change indicators); US6/US7 build on US1–US4 pipeline.
- **Polish (Phase 10)**: Depends on all targeted stories.

### User Story Dependencies

- **US1 (P1)**: No story dependencies — MVP; needs Foundational core libs.
- **US2 (P1)**: Depends on US1 (import completion builds datasets).
- **US3 (P2)**: Depends on US1+US2 (worker pipeline + dataset status).
- **US4 (P2)**: Depends on US1 (imports exist); partly parallel with US3.
- **US5 (P2)**: Depends on US2 (ready datasets) and US4 (period/version data for change indicators).
- **US6 (P3)**: Depends on US2 (dataset store) and US1 (import/job wiring); sync reuses the worker pipeline.
- **US7 (P3)**: Depends on US2 (dataset versions).

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Libs/services → controllers/routes → frontend → integration.
- Spikes/helpers (storage-mock, fixtures) precede tests where tests need them.

### Parallel Opportunities

- Setup: T002, T004, T006.
- Foundational: T009, T010–T015, T017, T019–T020, T022.
- US1: T023–T025, T031.
- US2: T035–T038.
- US3: T046–T048.
- US4: T054–T056.
- US5: T062–T065, T070.
- US6: T073–T076.
- US7: T084–T086.
- Polish: T091, T092, T093.

---

## Parallel Example: Foundational Phase

```bash
Task: "Implement backend/src/lib/storage.ts (R2 + local fallback)"
Task: "Implement backend/src/lib/files.ts (size/ext/magic/checksum)"
Task: "Implement backend/src/lib/parser.ts (CSV+XLSX streaming)"
Task: "Implement backend/src/lib/infer.ts (type voting)"
```

## Parallel Example: User Story 1

```bash
Task: "Integration test POST /data-sources upload lifecycle in backend/tests/integration/data-sources-upload.test.ts"
Task: "Integration test file validation rejections in backend/tests/integration/data-sources-upload.test.ts"
Task: "Extend frontend/lib/api-client.ts multipart + types.ts DTOs"
Task: "Implement data-source.schema.ts + service.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1) and STOP to validate upload → QUEUED → COMPLETED independently.
3. Then proceed US2 → US3/US4 → US5 (dashboard) → US6/US7.

### Incremental Delivery

Each story is a testable increment; the phase gate (T095) must pass before Phase 3 (AI) begins.

---

## Notes

- [P] tasks touch different files with no incomplete dependencies.
- Story labels provide traceability to spec.md.
- No fake data in any UI state (FR-026/FR-027); dashboards show honest empty states.
- Credentials never logged, returned, or audited (FR-021); redaction test T093 enforced.
- Commit after each task or logical group; never commit secrets, `.env`, or `backend/uploads/`.
- Total tasks: **96** (Setup 6, Foundational 16, US1 12, US2 11, US3 8, US4 8, US5 11, US6 11, US7 7, Polish 6).