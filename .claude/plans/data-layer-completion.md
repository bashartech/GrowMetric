# Data Layer Implementation Plan

## Current State Analysis

### Completed Work (~22 tasks)
✅ **Phase 1 - Setup (T001-T006)**: All dependencies, env config, fixtures, gitignore complete
✅ **Phase 2 - Database (T007-T009)**: 18 models + migration + seed structure
✅ **Phase 2 - Core Libraries (T010-T018)**: 9 foundational libs fully implemented
  - storage.ts (132 lines): R2 + local fallback
  - files.ts (95 lines): file validation
  - parser.ts (143 lines): CSV/XLSX streaming
  - infer.ts (202 lines): type inference with 200-row sampling
  - mapping-rules.ts (178 lines): semantic mapping rules
  - quality.ts (156 lines): quality metrics computation
  - external-db.ts (199 lines): PostgreSQL read-only connector
  - analytics-sql.ts (159 lines): SQL query builders
  - upload.ts: multer middleware
✅ **Worker Infrastructure (T021)**: registry + runner + IMPORT_DATA handler (145 lines)
✅ **Dataset Repository (T039)**: Versioned dataset creation with split value tables

### Critical Gaps Identified
❌ **crypto.ts**: Only 9 lines - missing AES-256-GCM for credential encryption (required for US6)
❌ **respond.ts**: Only 5 lines - likely incomplete
❌ **sync-database handler**: Only 5 lines stub
❌ **All API routes/controllers/services**: data-sources, imports, datasets, quality, analytics, dashboards
❌ **All tests**: Unit tests for libs, integration tests for user stories
❌ **All frontend**: components and pages for data hub
❌ **BusinessMetric seed**: Not extended with canonical metrics

### Remaining Work (~74 tasks)

## Implementation Strategy

### Phase-by-Phase Approach

#### **PHASE A: Complete Foundational Infrastructure (4 tasks)**
*Goal: Finish the blocking prerequisites before user stories*

1. **T-CRYPTO**: Implement full AES-256-GCM encryption in crypto.ts
   - encrypt(plaintext, key): { ciphertext, iv, authTag }
   - decrypt(ciphertext, iv, authTag, key): plaintext
   - Required for T078 (external DB credentials)

2. **T019-T020**: Core library unit tests (6 test files)
   - infer.test.ts: type inference with confidence thresholds
   - mapping-rules.test.ts: semantic key detection
   - quality.test.ts: metrics computation
   - files.test.ts: validation logic
   - analytics-sql.test.ts: SQL query builders (no execution)
   - parser.test.ts: CSV/XLSX streaming

3. **T009**: Extend seed.ts with BusinessMetric canonical definitions
   - revenue, orders, customers, expenses, profit, inventory
   - Upsert by kind field

4. **T022**: Extend entitlements for data features
   - Add data_sources, imports, datasets to plan limits
   - Hook into creation endpoints

**Checkpoint A**: All libs tested, seed complete, crypto ready for credentials

---

#### **PHASE B: User Story 1 - File Upload (MVP) (12 tasks)**
*Goal: End-to-end file upload → import → dataset*

**Tests First (T023-T025):**
- T023: Integration test - POST /data-sources creates source + import atomically
- T024: Integration test - file validation rejections
- T025: Component test - upload form

**Backend (T026-T030):**
- T026: data-source module (schema, service, controller)
  - createFileSource: validate → storage.put → create records in transaction
  - list, get, update, delete endpoints
- T027: Complete import-data handler (already ~done, verify completeness)
- T028: data-source routes mounted
- T029: import module (controller, routes, service)
  - GET /imports, GET /imports/:id
  - POST /imports/:id/cancel, POST /imports/:id/retry
- T030: Mount both routers in app.ts with upload middleware

**Frontend (T031-T034):**
- T031: Extend api-client.ts with multipart + polling helper
- T032: data-sources/page.tsx - list + create FILE source via dropzone
- T033: import-status.tsx component + imports/page.tsx history
- T034: Run and fix all US1 tests

**Checkpoint B**: Upload CSV/XLSX → import completes → ready for dataset view

---

#### **PHASE C: User Story 2 - Dataset Exploration (11 tasks)**
*Goal: View datasets with schema, quality, and isolation*

**Tests First (T035-T038):**
- T035: Integration test - dataset list/detail + columns
- T036: Integration test - quality report endpoint
- T037: Integration test - tenant isolation (cross-tenant 404)
- T038: Component test - dataset detail view

**Backend (T040-T042):**
- T040: dataset module (service, controller, routes)
  - GET /datasets, GET /datasets/:id, PATCH /datasets/:id
  - GET /datasets/:id/versions, GET /datasets/:id/rows
- T041: Wire import-data handler to dataset.repo (already done, verify)
- T042: quality module (service, routes)
  - GET /datasets/:id/quality, ?version=
  - POST /datasets/:id/quality/recompute

**Frontend (T043-T045):**
- T043: datasets/page.tsx - list + detail panel
- T044: data-quality/page.tsx - report view with warnings
- T045: Run and fix all US2 tests

**Checkpoint C**: Datasets visible with schema, types, quality, isolation verified

---

#### **PHASE D: User Story 3 - Mapping Confirmation (8 tasks)**
*Goal: Pause for user confirmation on low-confidence mappings*

**Tests First (T046-T048):**
- T046: Integration test - import pauses REQUESTING_MAPPING
- T047: Unit test - mapping-rules emits candidates + confidence
- T048: Component test - mapping dialog

**Implementation (T049-T053):**
- T049: Extend import-data handler (already done, verify pausing logic)
- T050: POST /datasets/:id/confirm-mapping endpoint
- T051: Include semanticKey/businessMeaning in dataset DTOs
- T052: mapping-confirm.tsx component
- T053: Run and fix all US3 tests

**Checkpoint D**: Ambiguous data pauses for confirmation

---

#### **PHASE E: User Story 4 - Import History (8 tasks)**
*Goal: Full provenance and version history*

**Tests First (T054-T056):**
- T054: Integration test - import history list order
- T055: Integration test - dataset version list
- T056: Component test - history view

**Implementation (T057-T061):**
- T057: Ensure import-data records full metadata (verify)
- T058: Extend import service with filters + pagination
- T059: imports/page.tsx full view
- T060: version-list.tsx component
- T061: Run and fix all US4 tests

**Checkpoint E**: Import history and versions transparent

---

#### **PHASE F: User Story 5 - Dashboard (11 tasks)**
*Goal: Live KPIs/charts from real data*

**Tests First (T062-T065):**
- T062: Integration test - analytics endpoints
- T063: Integration test - dashboard preview with filters
- T064: Unit test - analytics SQL correctness
- T065: Component test - dashboard renders charts

**Backend (T066-T069):**
- T066: metrics.service.ts - compute/compare-periods/group-by
- T067: metrics routes (POST /analytics/*)
- T068: dashboard module (service, controller, routes)
  - POST /dashboards/:id/preview
- T069: Default dashboard seed on first READY dataset

**Frontend (T070-T072):**
- T070: Chart components (kpi-card, line, bar, pie, table)
- T071: dashboard/page.tsx - widget grid + filters
- T072: Run and fix all US5 tests

**Checkpoint F**: Dashboard shows real business insights

---

#### **PHASE G: User Story 6 - External Database (11 tasks)**
*Goal: PostgreSQL connections with credential security*

**Tests First (T073-T076):**
- T073: Integration test - connect → read-only → tables → sync
- T074: Integration test - credentials never exposed
- T075: Unit test - credential encryption round-trip
- T076: Component test - external DB form

**Implementation (T077-T083):**
- T077: Complete external-db.ts (verify read-only enforcement)
- T078: POST /data-sources/external-db with encryption
- T079: GET/PATCH /data-sources/:id/tables
- T080: POST /data-sources/:id/sync
- T081: sync-database handler - SELECT → same pipeline
- T082: External DB form in data-sources/page.tsx
- T083: Run and fix all US6 tests

**Checkpoint G**: External DB sync works with zero credential leaks

---

#### **PHASE H: User Story 7 - Re-import (7 tasks)**
*Goal: Versioned updates with append/replace/upsert*

**Tests First (T084-T086):**
- T084: Integration test - append/replace/upsert versions
- T085: Unit test - commit strategy merge logic
- T086: Component test - re-import form

**Implementation (T087-T090):**
- T087: Extend import-data handler + dataset.repo for commit strategies
- T088: POST /datasets/:id/re-import
- T089: reimport-form.tsx component
- T090: Run and fix all US7 tests

**Checkpoint H**: All 7 user stories functional

---

#### **PHASE I: Polish & Gate (6 tasks)**
*Goal: Pass the phase gate*

- T091: Create ADR-004 (relational-split storage) and ADR-005 (jobs table)
- T092: Security review against checklist
- T093: Logging + redaction tests
- T094: Quickstart verification end-to-end
- T095: Full phase gate (typecheck + lint + test + build)
- T096: Fix gate failures

**Final Gate**: All tests pass, no violations, ready for Phase 3

---

## Execution Order & Dependencies

### Critical Path
1. **PHASE A** (foundational) → blocks everything
2. **PHASE B** (US1) → blocks US2-US7 (datasets require imports)
3. **PHASE C** (US2) → blocks US3, US5, US7 (dataset APIs required)
4. **PHASE D** (US3) → can run parallel with US4
5. **PHASE E** (US4) → can run parallel with US3
6. **PHASE F** (US5) → requires US2+US4 (datasets + versions)
7. **PHASE G** (US6) → requires US1+US2 (import pipeline)
8. **PHASE H** (US7) → requires US2 (dataset versions)
9. **PHASE I** (polish) → requires all stories complete

### Parallel Opportunities
- US3 and US4 can run in parallel after US2
- Frontend and backend can be developed in parallel within each story
- Tests can be written while implementation is being designed

### Stopping Points for Validation
After each phase (A-H), we'll:
1. Run relevant tests
2. Verify the checkpoint manually
3. Get user confirmation before proceeding

---

## Risk Assessment

### High Risk
- **Crypto implementation**: Must be secure (AES-256-GCM) for credential storage
- **Tenant isolation**: Cross-tenant tests MUST pass (FR-016, FR-017)
- **Credential exposure**: Zero tolerance (SC-010)

### Medium Risk
- **Test coverage**: 19 test tasks must all pass
- **Worker reliability**: Import failures must be safe (FR-006, SC-004)
- **Dashboard performance**: 5s render target (SC-006)

### Low Risk
- **Frontend components**: Existing patterns clear
- **API structure**: Established route/controller/service pattern

---

## Task Count Summary

- **Phase A (Foundational)**: 4 tasks
- **Phase B (US1)**: 12 tasks
- **Phase C (US2)**: 11 tasks
- **Phase D (US3)**: 8 tasks
- **Phase E (US4)**: 8 tasks
- **Phase F (US5)**: 11 tasks
- **Phase G (US6)**: 11 tasks
- **Phase H (US7)**: 7 tasks
- **Phase I (Polish)**: 6 tasks

**Total**: 78 tasks (includes 4 from foundational gap-fill)

---

## Implementation Notes

### Existing Patterns to Follow
- **Routes**: Express Router with middleware composition
- **Controllers**: asyncHandler wrapper, validate middleware, ok() response
- **Services**: Business logic, Prisma transactions, tenant-scoped queries
- **Tests**: Vitest + supertest for integration, helpers for auth/cleanup
- **Frontend**: TanStack Query hooks, api-client wrapper, shadcn/ui components

### Quality Gates
- Every phase must pass its tests before moving to next phase
- Security-critical code (crypto, external-db, tenant-guard) gets extra review
- No secrets in logs/audit (tested explicitly)
- Cross-tenant isolation tested for every resource type

### Definition of Done (Per Phase)
- [ ] All tasks implemented
- [ ] All tests passing
- [ ] TypeScript compiles with no errors
- [ ] Lint passes
- [ ] Manual checkpoint verified
- [ ] User approval to proceed
