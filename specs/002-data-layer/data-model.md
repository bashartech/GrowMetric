# Data Model: Phase 2 — Data Layer

**Feature**: `002-data-layer`
**Date**: 2026-09-18
**Source**: [`spec.md`](./spec.md) Key Entities, [`plan.md`](./plan.md), [`research.md`](./research.md) R3–R5, root `research.md` §3 (Phase 2 target schema)
**Database**: PostgreSQL (Neon) via Prisma ORM. All IDs are UUIDs. All timestamps are `timestamptz` (Prisma `DateTime`).

## Entity Overview

```text
DataSource (1) ----< DataSourceTable
DataSource (1) ----1 DataSourceCredential   # encrypted, never exposed
DataSource (1) ----< ImportFile
DataSource (1) ----< ImportJob
ImportJob   (1) ----1 Job                    # Phase 1 jobs table (system of record)

DataSource (1) ----< Dataset (per source)   # after processing
Dataset      (1) ----< DatasetVersion
DatasetVersion (1) ----< DatasetColumn
DatasetVersion (1) ----< DatasetRow
DatasetRow   (1) ----< DatasetTextValue      # composite (rowId, columnId)
DatasetRow   (1) ----< DatasetNumericValue
DatasetRow   (1) ----< DatasetDatetimeValue
DatasetRow   (1) ----< DatasetBooleanValue
DatasetVersion (1) ----1 DataQualityReport
Dataset      (1) ----< DatasetRelationship
Dataset      (1) ----< BusinessMetric (optional dataset scoping)

Workspace   (1) ----< Dashboard
Dashboard   (1) ----< DashboardWidget
```

All Phase 2 entities are scoped under `organizationId` (and `workspaceId` where workspace-level). Every query MUST include the organization/workspace predicate resolved from the authenticated user (FR-016, Principle III).

---

## 1. DataSource

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `name` | String | required, 1–100 chars | user-visible label |
| `kind` | `DataSourceKind` enum | required | `FILE` or `EXTERNAL_DB` |
| `status` | `DataSourceStatus` enum | default `NEW` | `NEW`, `CONNECTED`, `VALIDATED`, `FAILED`, `DISABLED` |
| `lastSyncAt` | DateTime? | nullable | timestamp of last table sync |
| `createdById` | UUID? | → User, nullable | actor |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `tables`, `credential`, (file sources reference `importFile` via import), `datasets`.
- **Kind semantics**: `FILE` — one file upload (supported via import); `EXTERNAL_DB` — PostgreSQL connection with selectable tables (FR-006/FR-020).
- **Unique**: none on name (multiple sources may share names); org/workspace scoping is the isolation contract.

## 2. DataSourceCredential

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `dataSourceId` | UUID | FK → DataSource, required, **unique** | one credential per source (FR-021) |
| `engine` | `ExternalDbEngine` enum | required | `POSTGRES` (Phase 2 only) |
| `host` | String | required | |
| `port` | Int | default 5432 | |
| `database` | String | required | |
| `username` | String | required | |
| `passwordEnc` | String | required | AES-256-GCM encrypted at rest |
| `sslMode` | String | default `require` | e.g. `disable`, `require`, `verify-ca` |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `dataSource`.
- **Security**: `passwordEnc` only; plaintext never stored, logged, returned, or included in audit (FR-021, Principle II/XII). Decrypt solely at connection time in the service/worker.
- **Extensions**: extra engine fields (e.g., MySQL) are additive-safe as an optional `settings` Json or new engine row later.

## 3. DataSourceTable

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `dataSourceId` | UUID | FK → DataSource, required, indexed | |
| `schemaName` | String | required | e.g. `public` |
| `tableName` | String | required | |
| `columnCount` | Int | default 0 | from inspection |
| `rowEstimate` | Int | default 0 | from inspection |
| `isSelected` | Boolean | default `false` | user-chosen for sync (FR-020) |
| `profile` | Json? | nullable | column/type summary shown in UI |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `dataSource`.
- **Unique**: `@@unique([dataSourceId, schemaName, tableName])`.

## 4. ImportFile

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `dataSourceId` | UUID | FK → DataSource, required | the FILE-kind source this belongs to |
| `originalName` | String | required | user-provided filename |
| `storageKey` | String | required | R2 key or local `uploads/` path (R1) |
| `mimeType` | String | required | validated |
| `sizeBytes` | Int | required, ≤ 26,214,400 (25 MB) | hard cap (FR-002) |
| `checksum` | String | required | e.g. SHA-256 for integrity |
| `createdAt` | DateTime | | |

- **Relations**: `dataSource`, `imports`.
- **Storage**: binary in R2/local, never in the database (R1); `storageKey` namespaced `{orgId}/{dataSourceId}/{fileId}`.

## 5. ImportJob

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `jobId` | UUID | FK → Job, required, unique | Phase 1 `jobs` row (system of record) |
| `dataSourceId` | UUID | FK → DataSource, required | |
| `datasetId` | UUID? | → Dataset, nullable | set once a dataset is created/attached |
| `fileId` | UUID? | → ImportFile, nullable | file imports only |
| `source` | `ImportSource` enum | required | `UPLOAD` or `TABLE_SYNC` |
| `status` | `ImportStatus` enum | default `QUEUED` | `QUEUED`, `RUNNING`, `REQUESTING_MAPPING`, `COMPLETED`, `FAILED` |
| `filename` | String | required | display name |
| `totalRows` | Int? | nullable | set on profile |
| `processedRows` | Int? | nullable | progress |
| `error` | String? | nullable | sanitized failure summary |
| `startedAt` / `completedAt` | DateTime? | nullable | |
| `createdAt` | DateTime | indexed | |

- **Relations**: `job`, `dataSource`, `file`, `dataset`.
- **Flow**: create `Job` (type `IMPORT_DATA`/`SYNC_DATABASE`, `PENDING`) + `ImportJob` (`QUEUED`) in one transaction, return `{ importId, status }` (FR-004/R7). Worker transitions `RUNNING → REQUESTING_MAPPING/COMPLETED/FAILED`.
- **Requires mapping**: when the worker flags ambiguous columns for user confirmation, status becomes `REQUESTING_MAPPING` and the job waits (FR-013).

## 6. Dataset

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `dataSourceId` | UUID | FK → DataSource, required | provenance |
| `name` | String | required, 1–100 chars | defaults from sheet/table name, editable |
| `kind` | `DatasetKind` enum | required | `SALES`, `CUSTOMERS`, `PRODUCTS`, `INVENTORY`, `EXPENSES`, `ORDERS`, `CUSTOM` |
| `sourceTable` | String? | nullable | external DB table name (TABLE_SYNC) |
| `status` | `DatasetStatus` enum | default `DRAFT` | `DRAFT`, `READY`, `READY_WITH_WARNINGS`, `ERROR` (FR-013) |
| `currentVersionId` | UUID? | → DatasetVersion, nullable | points at latest version |
| `rowCount` | Int | default 0 | from current version |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `versions`, `columns`, `qualityReports`, `relationships`, `metrics`, `dashboardWidgets`.
- **Readiness**: `READY` (clean), `READY_WITH_WARNINGS` (quality/mapping warnings, not analytics-ready), `ERROR` (FR-013/FR-015).
- **Index**: `@@index([organizationId, workspaceId])`.

## 7. DatasetVersion

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `datasetId` | UUID | FK → Dataset, required, indexed | |
| `version` | Int | required | per-dataset sequence starting at 1 |
| `importJobId` | UUID? | → ImportJob, nullable | producing import |
| `commit` | `DatasetCommit` enum | required | `APPEND`, `REPLACE`, `UPSERT` (FR-012) |
| `source` | String | required | e.g. `sales.xlsx`, `public.orders` |
| `status` | `DatasetVersionStatus` enum | default `READY` | reflects building state |
| `summary` | Json? | nullable | row counts, warnings summary |
| `createdAt` | DateTime | | |

- **Relations**: `dataset`, `columns`, `rows`, `qualityReport`.
- **Unique**: `@@unique([datasetId, version])`.
- **Invariant**: append-only relative to the dataset; each import creates a new version. `REPLACE` marks the current dataset data as the new version's rows (prior versions remain in history) (FR-012/FR-025-SC005).

## 8. DatasetColumn

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `datasetId` | UUID | FK → Dataset, required, indexed | |
| `datasetVersionId` | UUID | FK → DatasetVersion, required, indexed | |
| `name` | String | required | original header |
| `type` | `ColumnType` enum | required | `TEXT`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `TIMESTAMP`, `DATE`, `TIME` (R3) |
| `ordinalPosition` | Int | required | 1-based column order |
| `isNullable` | Boolean | default `true` | nullability inference |
| `semanticKey` | String? | nullable | canonical meaning if mapped (e.g. `revenue`) |
| `businessMeaning` | String? | nullable | human label of mapped meaning |
| `representativeSample` | Json? | nullable | a few sample values for UX |
| `createdAt` | DateTime | | |

- **Relations**: `dataset`, `version`.
- **Index**: `@@index([datasetId, ordinalPosition])`.
- **Mapping**: `semanticKey`/`businessMeaning` set only after deterministic mapping or user confirmation (FR-009/FR-010).

## 9. DatasetRow

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `datasetId` | UUID | FK → Dataset, required, indexed | |
| `datasetVersionId` | UUID | FK → DatasetVersion, required, indexed | |
| `rowIndex` | Int | required | 0-based within the version |
| `createdAt` | DateTime | | |

- **Relations**: `version`, `values` (via split tables).
- **Unique**: `@@unique([datasetVersionId, rowIndex])`.

## 10–13. Typed Value Tables (relational split)

Each row-cell value is stored in one of four per-type tables. Composite `(rowId, columnId)` primary key enforces exactly one value per cell; `columnId` index enables column-pruned aggregation (R5).

### DatasetTextValue

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `rowId` | UUID | FK → DatasetRow | |
| `columnId` | UUID | FK → DatasetColumn | |
| `value` | String | required | |

`@@id([rowId, columnId])`, `@@index([columnId])`.

### DatasetNumericValue

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `rowId` | UUID | FK → DatasetRow | |
| `columnId` | UUID | FK → DatasetColumn | |
| `value` | Decimal | required | maps to PostgreSQL `NUMERIC` |

`@@id([rowId, columnId])`, `@@index([columnId])`.

### DatasetDatetimeValue

`rowId`, `columnId`, `value TIMESTAMPTZ`. Same PK/index pattern.

### DatasetBooleanValue

`rowId`, `columnId`, `value Boolean`. Same PK/index pattern.

- **Write path**: batched within one Prisma transaction per version build; invalid/unparseable cells are recorded as `null`/absent and counted in the quality report (FR-011/R3), never silently dropped.
- **Read path**: analytics use column-pruned SQL over the narrow tables; row previews reconstruct rows via joined `DatasetRow` + value tables with `LIMIT/OFFSET` pagination (FR-022/XXII).

## 14. DatasetRelationship

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `datasetId` | UUID | FK → Dataset, required, indexed | |
| `sourceColumnId` | UUID | FK → DatasetColumn | |
| `targetDatasetId` | UUID? | → Dataset, nullable | same dataset when null (self) |
| `targetColumnId` | UUID? | FK → DatasetColumn | |
| `relationshipType` | `RelationshipType` enum | required | `MANY_TO_ONE` or `ONE_TO_ONE` |
| `detectedBy` | `DetectionMethod` enum | required | `RULES` or `USER` (AI deferred) |
| `confidence` | Decimal | required | 0–1 |
| `isConfirmed` | Boolean | default `false` | UX confirmation flag |
| `createdAt` | DateTime | | |

- **Relations**: `dataset`, referenced columns/dataset.
- **Invariant**: only persisted after rule validation or user confirmation (FR-018); never assumed valid unvalidated (architecture §35).

## 15. DataQualityReport

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `datasetId` | UUID | FK → Dataset, required | |
| `datasetVersionId` | UUID | FK → DatasetVersion, required, **unique** | one report per version |
| `totalRows` | Int | required | |
| `columnCount` | Int | required | |
| `missingValuePct` | Decimal | required | % null cells |
| `duplicateRowPct` | Decimal | required | % duplicate rows |
| `invalidNumberPct` | Decimal | required | % cells failing numeric parse in numeric columns |
| `invalidDatePct` | Decimal | required | % cells failing date parse in temporal columns |
| `numericOutlierCount` | Int | default 0 | outlier rows (IQR) |
| `status` | `QualityStatus` enum | required | `CLEAN`, `WARNINGS`, `ERROR` |
| `detail` | Json? | nullable | per-column warning list (FR-011/FR-014) |
| `createdAt` | DateTime | | |

- **Relations**: `dataset`, `version`.

## 16. BusinessMetric

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `datasetId` | UUID? | → Dataset, nullable | null = workspace-wide metric |
| `name` | String | required | e.g. `revenue` |
| `kind` | `MetricKind` enum | required | `REVENUE`, `ORDERS`, `CUSTOMERS`, `EXPENSES`, `PROFIT`, `INVENTORY`, `CUSTOM` |
| `definition` | Json | required | dataset refs, column refs, aggregation, optional period dimension (R8) |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `dashboardWidgets`.

## 17. Dashboard

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | one dashboard per workspace (Phase 2) |
| `name` | String | required, default `Business Dashboard` | |
| `layout` | Json? | nullable | widget grid layout metadata |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `widgets`.
- **Invariant**: dashboard belongs to the workspace, not a single uploaded file (FR-023, architecture §34, Principle XV).

## 18. DashboardWidget

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `dashboardId` | UUID | FK → Dashboard, required, indexed | |
| `type` | `WidgetType` enum | required | `KPI`, `LINE`, `BAR`, `PIE`, `TABLE` |
| `metricId` | UUID? | → BusinessMetric, nullable | for KPI widgets |
| `datasetId` | UUID? | → Dataset, nullable | scoping for chart widgets |
| `config` | Json? | nullable | series, aggregation, dimensions |
| `position` | Json? | nullable | grid x/y/w/h |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `dashboard`, `metric`, `dataset`.
- **Invariant**: widget stores configuration only; values are always computed live at render time from the data layer (R8/FR-024).

---

## Enums

```prisma
enum DataSourceKind     { FILE EXTERNAL_DB }
enum DataSourceStatus   { NEW CONNECTED VALIDATED FAILED DISABLED }
enum ExternalDbEngine   { POSTGRES }
enum ImportSource       { UPLOAD TABLE_SYNC }
enum ImportStatus       { QUEUED RUNNING REQUESTING_MAPPING COMPLETED FAILED }
enum DatasetKind        { SALES CUSTOMERS PRODUCTS INVENTORY EXPENSES ORDERS CUSTOM }
enum DatasetStatus      { DRAFT READY READY_WITH_WARNINGS ERROR }
enum DatasetVersionStatus { BUILDING READY }
enum DatasetCommit      { APPEND REPLACE UPSERT }
enum ColumnType         { TEXT INTEGER DECIMAL BOOLEAN TIMESTAMP DATE TIME }
enum RelationshipType   { MANY_TO_ONE ONE_TO_ONE }
enum DetectionMethod    { RULES USER }
enum QualityStatus      { CLEAN WARNINGS ERROR }
enum MetricKind         { REVENUE ORDERS CUSTOMERS EXPENSES PROFIT INVENTORY CUSTOM }
enum WidgetType         { KPI LINE BAR PIE TABLE }
```

## Indexes Summary

- `DataSource.organizationId`, `DataSource.workspaceId`
- `DataSourceCredential.dataSourceId` (unique)
- `DataSourceTable @@unique([dataSourceId, schemaName, tableName])`, `DataSourceTable.dataSourceId`
- `ImportFile.dataSourceId`
- `ImportJob.organizationId`, `ImportJob.workspaceId`, `ImportJob.jobId` (unique), `ImportJob.dataSourceId`, `ImportJob.createdAt`
- `Dataset.organizationId`, `Dataset.workspaceId`, `Dataset.dataSourceId`
- `DatasetVersion.datasetId`, `DatasetVersion @@unique([datasetId, version])`
- `DatasetColumn.datasetId`, `DatasetColumn @@index([datasetId, ordinalPosition])`
- `DatasetRow @@unique([datasetVersionId, rowIndex])`, `DatasetRow.datasetId`
- Value tables: `@@id([rowId, columnId])`, `@@index([columnId])` on each of the four
- `DatasetRelationship.datasetId`
- `DataQualityReport.datasetVersionId` (unique), `DataQualityReport.datasetId`
- `BusinessMetric.organizationId`, `BusinessMetric.workspaceId`
- `Dashboard.organizationId`, `Dashboard.workspaceId`
- `DashboardWidget.dashboardId`

## Seed Data

- **BusinessMetrics**: canonical definitions for revenue, orders, customers, expenses, profit, inventory (workspace-wide defaults), idempotent by `(kind)`.

## Migration Notes

- One migration `data-layer` for all 18 Phase 2 models + enums (additive-safe; Phase 1 migration untouched).
- Rows per import capped at 200,000 in Phase 2 (R2); schema fine for future increases.
- `Decimal` fields (numeric values, percentages, confidence) use PostgreSQL `NUMERIC` (no float rounding in monetary/quality math).