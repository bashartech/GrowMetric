# ADR-004: Relational-Split Value Storage for Dataset Versions

- **Status:** Accepted
- **Date:** 2026-09-22
- **Feature:** 002-data-layer
- **Context:** Imported datasets can hold hundreds of thousands of rows where each cell type (text, numeric, datetime, boolean) has different query, indexing, and casting needs. Analytics queries (SUM/AVG/COUNT, date-range filters, group-bys) must run efficiently without scanning JSON blobs, and column types are known up front after inference, so a fully generic EAV table would be both slow and hard to type.

## Decision

Store version-immutable cell values in **a narrow per-type relational table holding all columns of a dataset version**, kept row-parallel with a single `DatasetRow` index table.

- **Row spine**: `DatasetRow` carries `datasetId`, `datasetVersionId`, and `rowIndex` for a version. Versions are immutable; a re-import (APPEND/REPLACE/UPSERT) always creates a new `DatasetVersion` and new rows, never mutates an existing version.
- **Type-split value tables**: `DatasetIntegerValue`… `DatasetNumericValue`, `DatasetTextValue`, `DatasetDatetimeValue`, `DatasetBooleanValue`. Each row stores `rowId`, `columnId`, `columnType`, and a typed `value`. The current build uses `DatasetNumericValue`, `DatasetTextValue`, `DatasetDatetimeValue`, `DatasetBooleanValue` (+ integer-accommodating numeric storage).
- **Column metadata**: `DatasetColumn` (name, type, semantic key, business meaning, sample) is version-scoped, so analytical joins resolve types before SQL is built.
- **Analytics SQL**: `backend/src/lib/analytics-sql.ts` builds parameterized queries with `$n::uuid` casts on dataset/version/column ids and joins `DatasetRow` → the correct per-type value table. All user-supplied values go through bound parameters; the LIMIT is parameterized too.
- **Quality snapshot**: per-version `DatasetQuality` rows store aggregated quality signals (totalRows, missing/duplicate/invalid percentages, outlier counts, status, detail) computed at import time.

## Consequences

### Positive

- Typed columns live in typed PostgreSQL columns — numeric aggregations stay numeric without per-row casting, and columnar value tables keep table scans small (only the columns a query needs).
- Version immutability gives cheap, consistent reads: `DatasetRow` + `DatasetColumn` + `DatasetVersion.currentVersionId` answer "what does this version look like?" with no row updates.
- Re-import commit strategies are simple to reason about (merge into a new version, then atomically flip `currentVersionId`).

### Negative

- More tables and more joins than a single wide-table design; analytics must know the value table for a column type up front.
- Upsert-by-key requires a full read/merge of the current version's typed values in the worker before writing the new version (acceptable at the supported row scale).
- Future schema migrations add a per-type-table step rather than one ALTER.

## Alternatives Considered

- **Single wide table with nullable typed columns**: rejected — sparse, hard to index per type, and suffers schema churn as semantic columns evolve.
- **JSONB cell bag per row**: rejected — weak typing, no index on numeric/bool values, awkward aggregates in SQL; quality-of-life for parsing comes at query cost.
- **Pure EAV (`columnId`, `value`, `type`)**: rejected — far more rows for wide datasets, and type-specific filtering/aggregation maps poorly onto a single text column.

## References

- Feature Spec: `specs/002-data-layer/spec.md` (FR-012, SC-005)
- Data Model: `specs/002-data-layer/data-model.md`
- Implementation: `backend/prisma/schema.prisma`, `backend/src/lib/analytics-sql.ts`, `backend/src/modules/datasets/dataset.repo.ts`
- Related ADRs: ADR-005 (jobs as system of record)