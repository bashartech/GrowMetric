# Implementation Plan: Phase 2 — Data Layer

**Branch**: `002-data-layer` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-data-layer/spec.md`
**Design reference**: repository root `research.md` and `architecture.md`; phase research in `./research.md`

## Summary

Deliver the data layer of GrowMetrics: data sources (Excel/CSV file upload into object storage and read-only PostgreSQL connections), an asynchronous ingestion pipeline (parse → profile → infer types → map columns → normalize → store), versioned dataset storage using the researched relational-split value tables, data-quality reporting, import history, and a workspace-level dashboard with KPI cards, charts, and filters. All new work sits on top of the Phase 1 foundation (auth, tenancy, jobs table/registry, entitlements, audit). Automated tests (unit + integration) are part of the phase gate.

## Technical Context

**Language/Version**: TypeScript 5.x; Node.js 20 LTS (ESM)
**Primary Dependencies**:
- Backend (new): `multer` (multipart upload), `exceljs` (XLSX streaming), `csv-parse` (streaming CSV), `file-type` (magic-byte validation), `pg` (read-only PostgreSQL connector), `@aws-sdk/client-s3` (R2 object storage)
- Backend (existing, reused): Express, Prisma, `zod`, `pino`, `crypto` lib (`AES-256-GCM`, `sha256`, tokens), jobs registry (Phase 1), entitlement middleware, audit service
- Frontend (new): `recharts` (charts); existing: Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, `react-hook-form` + zod, TanStack Query, `next-themes`, `lucide-react`
- Optional queue signal: `ioredis` when `REDIS_URL` is configured (jobs table remains system of record)
**Storage**: PostgreSQL on Neon via Prisma (18 new Phase 2 models); Cloudflare R2 for original files (local `uploads/` fallback in dev)
**Testing**: Backend Vitest + Supertest (unit + integration); Frontend Vitest + React Testing Library; Playwright deferred to Phase 5
**Target Platform**: Web (Node.js server + modern browsers)
**Project Type**: Web application — two independent folders (`backend/`, `frontend/`), no npm workspaces
**Performance Goals**: p95 upload accept < 2 s (async processing); dashboard renders ready data < 5 s; import safety cap 200k rows; streaming parse (never load whole file into memory)
**Constraints**: Files ≤ 25 MB; only CSV/XLSX; external connections read-only (SELECT only, verified); credentials encrypted at rest and never exposed/logged; tenant isolation on every resource query; no long-running work in request path
**Scale/Scope**: Multi-organization SaaS; single user per workspace (Phase 1 model); 18 new Prisma models; ~6 new backend modules + 2 workers; ~6 frontend routes; dashboard aggregation over workspace datasets

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 2 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Data-First Architecture | All dashboard/metric data comes from stored, validated business data; no fabrication | PASS |
| II. Read-Only External DB | External DB connections are SELECT-only, verified read-only at connect + statement level; credentials never exposed | PASS |
| III. Tenant Isolation | Every data-source/import/dataset/dashboard query is scoped via `tenant-guard`; cross-tenant tests required | PASS |
| IV. Least Privilege | R2 keys server-side only; credentials encrypted and never in frontend/logs/audit; file metadata never trusted | PASS |
| V. AI Must Use Controlled Tools | No AI in this phase | PASS (N/A) |
| VI. Deterministic Calculations | All metric/quality computations are deterministic backend logic (no AI) | PASS |
| VII. Simulation Transparency | No simulation in this phase | PASS (N/A) |
| VIII. Evidence-Based AI | No AI findings in this phase | PASS (N/A) |
| IX. Data Quality Before Intelligence | Quality report per import; warnings surfaced before analytics; READY_WITH_WARNINGS semantics | PASS |
| X. Async Processing for Expensive Operations | File parse/import/table-sync run as background jobs; request path only accepts upload + returns import ID | PASS |
| XI. Security by Default | Zod on all bodies/queries/params; file validation (size/ext/magic bytes/checksum); SQL validator; upload limits | PASS |
| XII. Secrets Management | DB credentials + R2 keys env-only; `.env` gitignored; pino redaction extended to credentials/files | PASS |
| XIII. API Boundary | Frontend talks only to REST API; never Prisma/R2/customer databases | PASS |
| XIV. Separation of Concerns | `routes → controllers → services → Prisma`; ingestion logic in worker handlers + services; thin controllers | PASS |
| XV. Multi-Tenant Data Model | User → Organization → Workspace → DataSources/Datasets/Dashboards hierarchy preserved | PASS |
| XVI. AI Not System of Record | No AI in this phase | PASS (N/A) |
| XVII. Human Oversight | No automated business actions; mapping requires user confirmation at low confidence | PASS |
| XVIII. Auditability | Data-source creation, upload, import, and sync events recorded; no secrets in audit | PASS |
| XIX. Production Quality | Full vertical slices (UI + API + DB + validation + errors + loading + logging + tests) per story | PASS |
| XX. Testing | Unit (type inference, rules, quality math, commit strategies) + integration (upload→dataset, isolation, external sync) | PASS |
| XXI. Observability | Request/job IDs, structured logs with redaction (credentials, file contents), job status tracking | PASS |
| XXII. Performance | Column-pruned SQL aggregation, paginated row previews, streaming parse, indexes, publish no full-table loads | PASS |
| XXIII. Maintainability | Small typed modules; `storage`/`parser`/`ingestor` seams; one purpose per dependency | PASS |
| XXIV. Specification Before Implementation | Spec + this plan + research precede implementation | PASS |
| XXV. No Silent Architecture Changes | Relational-split storage and jobs-table signal layers are documented ADRs pending user consent (ADR-004, ADR-005); no new stack beyond ratified list | PASS (ADR pending) |
| XXVI. Definition of Done | Gate: spec satisfied, tests, type-check, lint, migrations, authorization, errors, docs | PASS |

**Gate result**: PASS — no violations require justification.

## Project Structure

### Documentation (this feature)

```text
specs/002-data-layer/
├── plan.md              # This file (/sp.plan command output)
├── spec.md              # Feature specification (story/Fr/SC)
├── research.md          # Phase 0 output (R1–R8 technical decisions)
├── data-model.md        # Phase 1 output (18 entities + Prisma mapping)
├── quickstart.md        # Phase 1 output (run/verify guide)
├── contracts/           # Phase 1 output (API contracts)
│   ├── data-sources.md
│   ├── imports.md
│   ├── datasets.md
│   ├── data-quality.md
│   ├── analytics.md
│   ├── dashboards.md
│   └── errors.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/sp.tasks command)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma        # +18 Phase 2 models (4 enums)
│   ├── migrations/          # +1 migration (data-layer)
│   └── seed.ts              # seed canonical BusinessMetric definitions
├── src/
│   ├── config/env.ts        # + R2_*, UPLOAD_DIR, EXT_DB_*, REDIS_URL(opt), IMPORT_ROW_CAP
│   ├── lib/
│   │   ├── storage.ts       # R2 or local uploads/ behind an interface (get/put/sign-none)
│   │   └── files.ts         # suffix/app validation helpers (size, ext, magic bytes, checksum)
│   ├── middleware/
│   │   └── upload.ts        # multer in-memory/mixed disk with 25MB limit + file-type check
│   ├── modules/
│   │   ├── data-sources/    # data-source.routes/controller/service/schemas + external-db connector
│   │   ├── imports/         # import.routes/controller/service + import-job wiring
│   │   ├── datasets/        # dataset.routes/controller/service/version/repo/relationships
│   │   ├── data-quality/    # quality.routes + quality.service (report computation)
│   │   ├── analytics/       # metrics.service (aggregate SQL), group-by, compare-periods
│   │   ├── dashboards/      # dashboard.routes/controller/service + widgets
│   │   └── audit/           # audit.service reuse (record data events)
│   ├── workers/
│   │   ├── index.ts         # worker loop (polls jobs table; optional Redis BRPOP)
│   │   └── handlers/
│   │       ├── import-data.ts    # parse → profile → infer → map → normalize → store
│   │       ├── sync-database.ts  # read-only external SELECT → same pipeline
│   │       └── registry.ts       # job type → handler map
│   └── jobs/                # Phase 1 registry extended (queue.client optional ioredis)
├── tests/
│   ├── unit/               # type-inference, rules, quality, commit-strategy, sql-validator, storage
│   └── integration/        # data-sources, imports-lifecycle, datasets, quality, analytics, dashboards, isolation
└── uploads/                # gitignored dev fallback for R2

frontend/
├── app/(app)/
│   ├── dashboard/page.tsx         # US5 dashboard (live, upgraded from coming-soon)
│   └── data-hub/
│       ├── data-sources/page.tsx  # list + create (file)/connect (db) + tables + sync
│       ├── datasets/page.tsx      # US2 dataset list/details + US3 mapping confirm
│       ├── data-quality/page.tsx  # US2/4 quality reports
│       └── imports/page.tsx       # US1 upload + US4 import history/versions
├── components/
│   ├── charts/                     # recharts wrappers (KPI card, line, bar, pie, table)
│   ├── data/                       # upload-dropzone, import-status, mapping-confirm, version-list
│   └── signals/                    # existing empty/error/loading states reused
├── lib/
│   ├── api-client.ts               # + multipart upload support, polling helper
│   └── types.ts                    # + Phase 2 DTOs mirrored from contracts/
└── hooks/                          # use-imports, use-datasets, use-dashboard, use-data-sources (react-query)
```

**Structure Decision**: Two-folder web application (backend + frontend), matching the ratified architecture. Backend adds `workers/` (first real job handlers on the Phase 1 jobs table) and `lib/storage.ts`; ingestion logic lives in worker handlers + `datasets`/`analytics` services, keeping routes thin. Frontend adds a `charts/` set (KPI card, line/bar/pie, table) and `data/` feature components under the existing `(app)` shell.

## Phase 0 — Research (summary; full detail in [research.md](./research.md))

Key decisions for Phase 2:

- **Storage**: originals in R2 (private, server-side), local `uploads/` fallback in dev (R1).
- **Parsing**: streaming CSV + XLSX (exceljs); one file → one import → one dataset; 200k row safety cap (R2).
- **Type inference**: 200-row sampling, ≥95% confidence, mixed → TEXT + warning, invalid values counted not dropped (R3).
- **Mapping**: deterministic rules first; user confirmation at low confidence; AI assist deferred to Phase 3 (R4).
- **Storage model**: relational-split typed value tables; batched transactional writes; column-pruned aggregation SQL (R5).
- **External DB**: PostgreSQL only; connection + statement-level read-only enforcement; information_schema table discovery; credentials AES-256-GCM encrypted (R6).
- **Jobs**: jobs table remains system of record; worker loop + optional Redis BRPOP signal; dev needs zero extra services (R7).
- **Dashboard**: config-only widgets; live computation at render; filters → scoped SQL predicates; no materialized aggregates (R8).

## Phase 1 — Design & Contracts

- `data-model.md`: 18 Prisma models (DataSource, DataSourceCredential, DataSourceTable, ImportJob, ImportFile, Dataset, DatasetVersion, DatasetColumn, DatasetRow, DatasetTextValue, DatasetNumericValue, DatasetDatetimeValue, DatasetBooleanValue, DatasetRelationship, DataQualityReport, BusinessMetric, Dashboard, DashboardWidget) + 4 enums, fields, relations, indexes.
- `contracts/`: data-sources, imports, datasets, data-quality, analytics, dashboards, errors (extends Phase 1 codes with data-layer codes).
- `quickstart.md`: env additions (R2/local storage, external DB, REDIS optional), worker start command, verification steps.

## Complexity Tracking

No Constitution Check violations. Note: relational-split value storage (ADR-004 candidate) and jobs-table-as-system-of-record with Redis as signal (ADR-005 candidate) are architecturally significant and referenced as pending ADRs — to be documented with user consent before Phase 3 (per research.md §16).

## Phase Gate (Definition of Done for this phase)

1. `backend`: `tsc --noEmit` passes, lint passes, `vitest` unit + integration pass, `prisma migrate` applies cleanly (Phase 1 + Phase 2 migrations).
2. `frontend`: `tsc --noEmit` passes, lint passes, `vitest` passes, production build succeeds.
3. Manual checkpoint: register → upload CSV → import completes → dataset ready with quality report → dashboard renders KPIs/charts → apply filter and confirm recompute → connect a read-only PostgreSQL and sync a table → two accounts cannot see each other's data → no credentials in logs/audit/API.
4. PHR recorded; then Phase 3 (AI) planning begins only after user verification.