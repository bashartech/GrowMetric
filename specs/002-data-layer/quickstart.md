# Quickstart: Phase 2 — Data Layer

**Feature**: `002-data-layer`
**Goal**: Run both apps plus the ingestion worker locally and verify the Phase 2 gate: upload → import → dataset ready → quality report → dashboard renders → filters recompute → read-only external DB sync → tenant isolation → no credentials leaked.

## Prerequisites

- Phase 1 foundation installed and gated (see `specs/001-foundation/quickstart.md`)
- Node.js 20 LTS + npm
- A PostgreSQL database (Neon recommended)
- Windows PowerShell 5.1 (this project's shell)
- Optional: Cloudflare R2 credentials (local `uploads/` fallback works without them)
- Optional: an external PostgreSQL database with read-only credentials to test table sync

## 1. Environment

Add to `backend/.env` (alongside Phase 1 vars):

```dotenv
# Storage: R2 (recommended) OR local fallback
# If R2_* are empty, uploads go to backend/uploads/ (gitignored).
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME="GrowMetrics-uploads"
R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
UPLOAD_DIR="./uploads"

# Ingestor worker
IMPORT_ROW_CAP=200000
IMPORT_MAX_FILE_BYTES=26214400

# Optional Redis signal (jobs table works without it)
REDIS_URL=""

# Crypto for encrypted external-DB credentials (32+ bytes)
DATA_SOURCE_ENCRYPTION_KEY="replace-with-32-byte-random-secret"
```

Add to `frontend/.env.local` (unchanged from Phase 1):

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:4000/api/v1"
```

## 2. Backend + Worker

```powershell
cd backend
npm install            # + exceljs, csv-parse, multer, file-type, pg, @aws-sdk/client-s3, ioredis
npx prisma migrate dev --name data_layer   # applies the 18 new models
npm run seed
npm run dev            # API on :4000
```

In a second terminal (worker):

```powershell
cd backend
npm run worker         # polls jobs table; also BRPOPs Redis if REDIS_URL set
```

If R2 env vars are empty, uploads land in `backend/uploads/` (the same `ImportFile` interface); `gitignore` `backend/uploads/`.

## 3. Frontend

```powershell
cd frontend
npm install            # + recharts
npm run dev            # on :3000
```

## 4. Manual Verification (Phase Gate)

1. Register/create an account (Phase 1 flow); land on the app shell.
2. Open **Data Hub → Data Sources**; create a FILE data source by uploading a CSV (e.g., sales columns: `date`, `product`, `region`, `total`).
3. Confirm the import appears immediately with `QUEUED`, then transitions to `RUNNING`.
4. Open **Data Hub → Import History**: import completes with a row count.
5. Open **Data Hub → Datasets**: dataset is `READY` (or `READY_WITH_WARNINGS`); columns show inferred types (e.g., `date` → DATE, `total` → DECIMAL, `product` → TEXT).
6. Open the dataset's **data-quality** view: rows/columns/missing%/duplicates%/invalid% present. If the import paused for mapping (`REQUESTING_MAPPING`), confirm the ambiguous column in the mapping dialog, then re-check status.
7. Open **Dashboard**: KPI cards (revenue, orders, ...) and charts render values matching the CSV; change is shown when two periods exist, otherwise "unavailable".
8. Apply a filter (date range, dimension); confirm all widgets recompute.
9. (External DB) Create an EXTERNAL_DB data source against a read-only PostgreSQL; verify tables list; select 1–2 tables; run sync; confirm datasets appear via the TABLE_SYNC imports.
10. **Tenant isolation**: register a second account; confirm it cannot see the first account's data sources/imports/datasets/dashboards (all requests return 404).
11. **Credential checks**: inspect API responses, `backend` logs, and `audit_logs` for the external DB — the password never appears.

## 5. Automated Gate

```powershell
# backend
cd backend
npm run typecheck
npm run lint
npm run test

# frontend
cd frontend
npm run typecheck
npm run lint
npm run test
npm run build
```

All must pass before Phase 3 (AI) begins.

## 6. Troubleshooting

- **Upload rejected `FILE_TYPE_UNSUPPORTED`**: confirm the file is CSV or XLSX and content matches the extension (magic-byte check).
- **Import stuck in `QUEUED`**: confirm the worker process is running (`npm run worker`).
- **`EXT_DB_CONNECTION_FAILED`**: verify host/port/credentials and that the server allows remote connections; check `sslMode`.
- **`EXT_DB_NOT_READ_ONLY`**: the connected role must be read-only; GrowMetrics refuses to use writable connections.
- **`CONFLICT` on analytics**: the dataset is `READY_WITH_WARNINGS` — resolve mapping or accept warnings (FR-015).
- **R2 upload errors**: R2 env vars misconfigured — either fix them or leave them empty to use the local `uploads/` fallback.
- **Next.js 16**: read `frontend/node_modules/next/dist/docs/` before writing App Router code.