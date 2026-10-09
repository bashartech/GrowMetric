# Research: Phase 2 — Data Layer

**Feature**: `002-data-layer`
**Status**: Draft (pending user verification)
**Date**: 2026-09-18
**Source of truth**: root `research.md` §2 (ERD), §3 (Prisma proposal), §6 (ingestion), §11 (API groups), §14 (roadmap) + `architecture.md` (§8–15, §32–35, §37) + `.specify/memory/constitution.md`
**Scope**: Resolve the Phase 2 technical questions R1–R8 documented below. Design documents only — no code locked before user verification.

---

## R1 — Storage of original uploaded files

Uploaded Excel/CSV files are the immutable source of truth and must survive re-processing, so they are copied to object storage (Cloudflare R2) via an `ImportFile` record holding `r2Key`, `originalName`, `mimeType`, `sizeBytes`, and `checksum`. The application database never stores file binaries; it stores only the R2 reference. In development, R2 access is optional: when R2 env vars are absent, the file is written to a gitignored local `uploads/` directory behind the same `ImportFile` interface so local development does not require cloud credentials.

**Decision**: Store originals in R2 (or local `uploads/` fallback) behind a small `storage` abstraction. R2 keys are namespaced by `{organizationId}/{dataSourceId}/{importFileId}`. Bucket is private; access is server-side only (no public URLs).

---

## R2 — Parsing Excel and CSV

- **CSV**: streamed with a streaming CSV parser; handles UTF-8 (with BOM), quoted fields, and configurable delimiter (comma default; sniff tab/semicolon via first-row heuristic). Row limit per file applies (safety cap, e.g., 200k rows in Phase 2) to protect the DB.
- **Excel (.xlsx)**: parsed with `exceljs` in streaming mode per sheet. Only the `.xlsx` (ZIP/XML) format is supported in Phase 2; legacy `.xls` is rejected with a clear message (magic-byte check).
- Selected sheet becomes the import payload; a filename mapping table sheet→dataset is not needed in Phase 2 (one file = one import of one sheet; the first/default sheet). Multi-sheet support is deferred; the UI states sheet selection is per-import.

**Decision**: Streaming parse both CSV and XLSX; one file → one import → one dataset version. Sheet name is captured as the dataset default name; the user can rename the dataset afterward.

---

## R3 — Type inference and normalization

Columns are normalized into the bounded enum `DatasetColumnType` = `TEXT | INTEGER | DECIMAL | BOOLEAN | TIMESTAMP | DATE | TIME` (from research.md §3). Inference is deterministic:

1. Sample up to N rows (e.g., 200) for fast type voting.
2. For each column, evaluate candidate types by parsing rules (integer regex, decimal parse, ISO/date/datetime parsers, boolean literals).
3. Choose the most specific type meeting a confidence threshold (e.g., ≥95% of sampled values parse as that type).
4. Ambiguity or mixed types → coerce to `TEXT` with a warning (kept in quality report), never crash.

Normalization writes typed values into the corresponding split value table; unparseable values in a typed column are recorded as invalid in the data-quality report and stored as text fallback? — no: they are kept in the row as `null` for the typed value and counted in `invalidValueCount`.

**Decision**: 200-row sampling for type voting; threshold ≥95%; mixed → TEXT with warning; invalid values counted, not silently dropped.

---

## R4 — Schema/business-meaning mapping

Deterministic rules run first (architecture §13): a rules list maps canonical meanings (revenue, orders, customers, products, inventory, expenses, order_date, region, ...) via column-name synonyms + value heuristics + sample confidence. When a column is either unmapped or has multiple candidate meanings above minimum confidence, the import is flagged `NEEDS_MAPPING` and the user confirms from candidates (Validation UI). Low/no confidence mappings left unconfirmed keep the dataset `READY_WITH_WARNINGS` (never analytics-ready).

AI-assisted mapping is explicitly deferred to Phase 3 (AI) — Phase 2 is deterministic + human confirmation only (matches research §14 roadmap).

**Decision**: Deterministic rules + user-confirmation-only in Phase 2; AI assist deferred.

---

## R5 — Relational-split row/value storage

Storing rows via four typed value tables (`DatasetTextValue`, `DatasetNumericValue`, `DatasetDatetimeValue`, `DatasetBooleanValue`) with composite `(rowId, columnId)` PKs, as decided in research.md §2. Writes are batched in a Prisma transaction; analytics use column-pruned SQL against the narrow value tables (aggregations never reconstruct full wide rows unless a specific report needs it — Phase 2 dashboards aggregate directly).

Mitigations for row-count growth: index per `columnId`; analytics SQL aggregates server-side; paginated row previews (`GET /datasets/:id/rows`).

**Decision**: Split tables as researched; batched transactional writes; column-pruned aggregation.

---

## R6 — External database connection (read-only)

PostgreSQL is the initial engine. Connection flow (architecture §10): validate connection → verify read-only → inspect tables → user selects → verify read-only again on sync → profile selected tables → map fields → snapshot into Datasets.

Implementation notes:
- Credentials are encrypted at rest with AES-256-GCM (existing `lib/crypto.ts` keyed by environment secret) in `DataSourceCredential`.
- Read-only enforcement: connect with the user-provided credential; on `postgres` client set `options: '-c default_transaction_read_only=on'` and verify `SHOW transaction_read_only = on`; the SQL executor rejects any statement not beginning with `SELECT`.
- Table discovery via `information_schema.tables` (public + user schemas, excluding system schemas).
- Sync uses the same pipeline as file import (profile → infer → map → write versioned dataset) but sources rows by streaming SELECT with a row cap.
- Never return the credential; never log connection strings with passwords.

**Decision**: `pg` driver, read-only enforced at session + statement level, table discovery via information_schema, encrypted credentials, sync reuses the ingestion pipeline.

---

## R7 — Queue / background processing

Phase 1 shipped a `jobs` table + registry + dev inline executor. Phase 2 adds the first real async flows (file processing, table sync). Per research §9: `jobs` remains the system of record; Redis is the signal layer. Phase 2 proceeds as follows:

- Ship a **worker loop** (Node process) that polls the `jobs` table (`status=QUEUED` where `scheduledAt <= now`) on a short interval (dev mode) AND supports Redis signal wake-ups (`BRPOP`) when `REDIS_URL` is configured.
- Registry maps job type → handler: `IMPORT_DATA`, `SYNC_DATABASE`, `GENERATE_DASHBOARD_SUMMARY` (optional).
- `Job` rows already carry workspace/organization context, attempts, and error info from Phase 1.
- Import creates the `Job` row + `ImportJob` row in one transaction, returns `{ importId, status }` immediately (FR-004).

**Decision**: jobs-table-first + optional Redis signal; dev works with zero extra services.

---

## R8 — Dashboard queries

Dashboard is workspace-level and aggregates over the workspace's ready datasets. Two-layer approach:

- **Metrics service** (`analytics` module) computes KPI values and chart series via column-pruned SQL over the value tables, driven by `BusinessMetric` definitions (kind + definition JSON: dataset, column refs, aggregation, optional period dimension).
- **Dashboard/widget** records store layout/config only; widget data is always computed live at render time. No persisted/cached aggregates in Phase 2 (dashboards are read-mostly; acceptable at this scale). Filters translate to SQL predicate injection, always bound to the workspace.

**Decision**: Dashboard = config-storage + live computation; no materialized aggregates in Phase 2.

---

## Resolved / open questions

Resolved for Phase 2:
1. **File formats**: CSV (streamed) + XLSX (exceljs). XLS rejected; multi-sheet deferred.
2. **Row caps**: safety cap 200k rows per import in Phase 2 (documented; can raise later).
3. **R2 in dev**: local `uploads/` fallback; no cloud dependency for local development.
4. **External DB**: PostgreSQL only in Phase 2 (per spec Assumptions).
5. **Mapping**: deterministic + user confirmation; AI assist deferred to Phase 3.

Deferred (defaults chosen):
- Multi-sheet Excel imports; .xls legacy support.
- MySQL/other external engines.
- Materialized aggregate tables / caching for dashboards (revisit if performance requires).
- AI-assisted schema mapping.

---

*Research gate for this phase: resolved questions above feed plan.md, data-model.md, contracts/, and tasks.md after user verification.*