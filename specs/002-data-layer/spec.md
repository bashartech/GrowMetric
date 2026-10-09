# Feature Specification: Phase 2 — Data Layer

**Feature Branch**: `002-data-layer`
**Created**: 2026-09-18
**Status**: Draft
**Input**: User description: "Phase 2 Data Layer: data sources for Excel/CSV file upload and external read-only database connections, async file ingestion pipeline with validation, parsing, schema detection and mapping, relational dataset storage with versioning, data quality profiling, workspace-level dashboards with KPI cards and charts and filters, and import history."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload Business Data Files and Track Processing (Priority: P1)

A signed-in user opens the Data Hub, uploads an Excel or CSV file (up to 25 MB), and the system validates it, stores the original copy, and starts processing it in the background. The user immediately receives an import identifier and can watch the import progress from queued to completed without their request being blocked.

**Why this priority**: Nothing else in this phase works without business data in the system. File upload is the primary entry point and the fastest path from raw business data to analytics.

**Independent Test**: Upload a valid CSV and a valid Excel file; confirm each is accepted, an import record with a processing status appears immediately, and the import completes with a row count. Upload an oversized or invalid file; confirm it is rejected with a clear message. Getting business data into the platform delivers value by itself.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they upload a valid Excel or CSV file of 25 MB or less, **Then** the file is accepted, its original copy is preserved, and an import record with a processing status is created immediately (before processing finishes).
2. **Given** an accepted upload, **When** the user views the import, **Then** they see its progress and a row count once complete, without the upload action ever blocking on long processing.
3. **Given** a file larger than 25 MB, an unsupported file type, or a file whose content does not match its claimed type, **When** it is uploaded, **Then** it is rejected with a specific, user-friendly message and nothing is processed.
4. **Given** an import that fails during processing, **When** the user views it, **Then** the failure is reported with a safe message and the dataset is never marked ready from partial data.

---

### User Story 2 - Explore Datasets with Schema and Quality Status (Priority: P1)

Once an import completes successfully, the data becomes a dataset in the user's workspace. The user can open the Datasets area in Data Hub and see each dataset with its detected columns and types, its row count, and an honest readiness status (ready, ready-with-warnings, or error). The data is visible and understandable before any analytics or dashboard can be trusted.

**Why this priority**: The dataset is the unit of analysis for everything that follows. Making imported data inspectable is the backbone of the data layer and is required before dashboards or AI can operate.

**Independent Test**: With a completed import, open the Datasets area and confirm the dataset appears with columns, types, row count, and status. Open the data-quality view and confirm the report renders from the actual import. Works without any dashboard or AI feature.

**Acceptance Scenarios**:

1. **Given** a completed import, **When** the user opens the Datasets area, **Then** the dataset appears with its name, status, row count, and detected columns, each with a normalized type.
2. **Given** a dataset is ready, **When** the user opens its columns/quality view, **Then** they see column-level details (type, sample values, nullability) and the data-quality summary.
3. **Given** a dataset whose import produced warnings, **When** it is viewed, **Then** it is labeled "ready-with-warnings" with the specific warnings shown, never silently treated as fully clean.
4. **Given** a signed-in user from a different organization, **When** they attempt to access this dataset by any identifier, **Then** the request is denied and the attempt is recorded.

---

### User Story 3 - Confirm Column Mapping When Confidence Is Low (Priority: P2)

When the system cannot confidently determine the business meaning or type of a column (for example, two possible revenue columns, or a date stored as text), the user is asked to confirm the mapping before the dataset is treated as analytics-ready. The confirmation screen shows the candidate meanings with real sample values from the data.

**Why this priority**: Correct column mapping is what makes later analytics (metrics, dashboards, and the AI phases) trustworthy. It is important but not required for the first usable data-in slice, where auto-detected mappings may be correct for many files.

**Independent Test**: Import a file with an ambiguous column; confirm the system pauses for user confirmation before marking the dataset ready; after the user confirms a mapping, the dataset reflects the confirmed meaning. Delivers accurate, analytics-ready data on its own.

**Acceptance Scenarios**:

1. **Given** an import (file or table sync) where a column's meaning or type is ambiguous, **When** processing reaches the mapping step, **Then** the user is shown candidate interpretations with real sample values and asked to confirm.
2. **Given** a low-confidence mapping that the user confirms, **When** the dataset is finalized, **Then** the confirmed meaning is stored with the dataset and shown thereafter.
3. **Given** an ambiguous mapping that is not confirmed, **When** the dataset status is evaluated, **Then** the dataset is shown as ready-with-warnings (not fully analytics-ready) until the mapping is resolved.

---

### User Story 4 - Review Import History and Dataset Versions (Priority: P2)

A signed-in user can open Import History in the Data Hub and see every import with its source, filename, row count, status, and timestamps in reverse-chronological order. For each dataset they can also see its version history, so data changes are transparent and no import silently overwrites earlier data.

**Why this priority**: Trust in data provenance is a prerequisite for acting on analytics. This story also establishes the versioning concepts that later re-import workflows build on. It is valuable on its own as an administrative/audit surface.

**Independent Test**: Perform an import, then re-import into the same dataset using a different version strategy; open Import History and the dataset's versions and confirm both imports appear with correct metadata and neither replaced the other silently. Works without dashboards or AI.

**Acceptance Scenarios**:

1. **Given** at least one import, **When** the user opens Import History, **Then** each import shows source, filename, row count, status, and timestamps in reverse-chronological order.
2. **Given** a dataset imported more than once, **When** the user opens its version history, **Then** each version is listed with its commit strategy (append/replace/upsert), source, and timestamp.
3. **Given** a failed import, **When** it appears in history, **Then** its failure is summarized safely with no internal details.

---

### User Story 5 - View a Workspace-Level Dashboard with KPIs, Charts, and Filters (Priority: P2)

Once a supported dataset (for example, sales data) is ready, the user opens the Dashboard and sees a workspace-level view with KPI cards (revenue, orders, customers, expenses, profit) including period-over-period change, charts (revenue/expenses/profit over time, sales by product, sales by region, customer trends, inventory levels, top-performing and underperforming products), and filters (date, product, category, region, customer). Every number is computed from real data and, when data is missing, an honest empty or "insufficient data" state is shown instead of a fabricated value.

**Why this priority**: The dashboard is the primary user-facing insight surface of the product — turning ready data into business answers. It is the payoff of this phase, so it is high priority; it depends on datasets existing, which is why file upload and dataset readiness come first.

**Independent Test**: With a supported dataset imported, open the Dashboard and confirm KPI cards and charts render values computed from real data, filters update every visible metric/chart, and areas with missing data show honest empty states. Delivers visible business insight on its own.

**Acceptance Scenarios**:

1. **Given** a ready dataset with supported metrics, **When** the user opens the Dashboard, **Then** KPI cards and charts render values computed from the actual data, including period-over-period change percentages.
2. **Given** the Dashboard is open, **When** the user applies any filter (date, product, category, region, customer), **Then** all visible metrics and charts recompute to the filtered subset.
3. **Given** a metric area whose underlying data is missing, **When** the Dashboard renders, **Then** that area shows an honest "insufficient data" or empty state rather than zero or a fabricated figure.
4. **Given** multiple datasets in a workspace, **When** the Dashboard renders, **Then** it may combine data across datasets and is never tied to a single uploaded file.

---

### User Story 6 - Connect an External Database (Read-Only) and Select Tables (Priority: P3)

A signed-in user connects a PostgreSQL database with read-only credentials, verifies the connection, inspects the available tables, selects which tables to expose to GrowMetrics, and starts a synchronization that creates datasets. Credentials are stored encrypted and are never exposed to the frontend, logs, or audit records.

**Why this priority**: Database connections extend the product beyond file uploads to live business data, but they are more complex and needed by fewer initial users than file upload, so they follow file ingestion.

**Independent Test**: Connect a PostgreSQL database with read-only credentials, verify read-only access, select tables, run a sync, and confirm datasets appear; confirm the credentials are never returned by any API response or log line. Works without dashboards or AI.

**Acceptance Scenarios**:

1. **Given** a signed-in user with external database credentials, **When** they create a data source, **Then** the connection is tested, read-only access is verified, and the available tables are listed without exposing credentials.
2. **Given** tables are listed, **When** the user selects a subset and confirms, **Then** a data source is created with those tables and a sync can be started to produce datasets.
3. **Given** a created data source, **When** any API response, log, or audit entry is inspected, **Then** credentials never appear in plaintext.

---

### User Story 7 - Update Existing Datasets without Losing History (Priority: P3)

A signed-in user can re-import data into an existing dataset with an explicit commit strategy — append new data, replace the current data, or upsert by a key — and can always see which strategy produced the current version. Earlier versions remain available in history; no import silently destroys prior data.

**Why this priority**: Real businesses re-upload changing data. Versioned updates keep analytics current, but are not needed for the first data-in slice, so they land after the core pipeline is solid.

**Independent Test**: Append a file to an existing dataset, then replace the dataset, then inspect versions; confirm each import produced its own version with the chosen strategy and the current data matches the last operation. Standalone value: data stays current without loss.

**Acceptance Scenarios**:

1. **Given** an existing dataset, **When** the user re-imports with "append", **Then** new rows are added and prior rows remain.
2. **Given** an existing dataset, **When** the user re-imports with "replace", **Then** the current dataset reflects only the new data while earlier versions remain in history.
3. **Given** a dataset with multiple versions, **When** the user views it, **Then** the current version and its commit strategy are clearly identified.

---

### Edge Cases

- **Oversized file (>25 MB)**: rejected immediately with a clear message; no import record is created.
- **Wrong/unsupported file type or content/type mismatch**: rejected with a specific message before processing.
- **Empty file or file containing only headers**: handled gracefully, reported as a warning, never crash; dataset left not ready.
- **Import failure midway through processing**: the import shows a safe failure detail, no partial dataset is marked ready, and the user can re-attempt with a fresh import.
- **Duplicate re-upload (same file re-imported)**: allowed as a new version when intentional; identical immediate duplicates are handled without corrupting history.
- **Columns with mixed types, empty headers, or very long values**: normalized into a bounded type with a warning; never crash.
- **Dropped/renamed columns in a re-import**: version history preserves the prior version; the new import is recorded with its own schema.
- **External database unreachable or credentials invalid**: a clear, safe message is returned; credentials remain stored for retry and are never logged.
- **External DB write attempt (credentials with write access, or a non-SELECT statement)**: rejected; only read-only, SELECT-style access is ever performed.
- **Table with a very large row count during sync**: processed in the background with summary counts; the request/UI never blocks.
- **Cross-tenant access attempt** (dataset, import, data source, or dashboard via a manipulated identifier): denied and recorded as an audit/security event.
- **Missing data for a period-over-period comparison** (e.g., only one month of history): the change is shown as "unavailable" rather than a misleading figure.
- **Concurrent re-imports into the same dataset**: handled safely so that distinct versions are recorded without corruption.
- **Schema mapping that the user leaves unresolved**: the dataset remains ready-with-warnings and is excluded from analytics-readiness.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a signed-in user to create a data source by uploading an Excel or CSV file, and MUST preserve the original file.
- **FR-002**: System MUST accept uploaded files up to 25 MB and MUST reject larger files and unsupported types with a specific, user-friendly message.
- **FR-003**: System MUST validate that an uploaded file's content matches its claimed type before processing it.
- **FR-004**: System MUST create an import record immediately on accept and return it (with a status of queued/processing) so the request never blocks on long processing.
- **FR-005**: System MUST process imports asynchronously in the background and MUST NOT perform large-file operations inside a normal request path.
- **FR-006**: System MUST parse supported files (spreadsheet and CSV formats) robustly, including streaming for larger files.
- **FR-007**: System MUST profile each imported file/table, detecting row count, column count, missing values, duplicate rows, invalid values, and outliers.
- **FR-008**: System MUST infer a bounded, normalized type for each column (text, whole number, decimal, boolean, date, time, timestamp) and normalize mixed/loose values into it with warnings maintained.
- **FR-009**: System MUST detect column business meaning using deterministic rules first and, when confidence is low, MUST ask the user to confirm a mapping with candidate interpretations and sample values before the dataset becomes analytics-ready.
- **FR-010**: System MUST NOT treat low-confidence or unconfirmed schema mappings as analytics-ready data.
- **FR-011**: System MUST store each dataset in normalized form as a versioned unit within its workspace, with commit strategy, source, and timestamps recorded for every version.
- **FR-012**: System MUST support append, replace, and upsert commit strategies for re-imports, and MUST preserve prior versions so no import silently overwrites data.
- **FR-013**: System MUST define dataset readiness as one of ready, ready-with-warnings, or error reflecting parse/schema/quality results, and MUST show it honestly in the interface.
- **FR-014**: System MUST produce a data-quality report per import/version showing rows, columns, missing-value rate, duplicate-row rate, invalid-value rate, outlier count, and an overall status.
- **FR-015**: System MUST surface data-quality warnings in the interface before analytics derived from the data are relied upon.
- **FR-016**: System MUST scope every data source, import, dataset, and dashboard to exactly one organization/workspace, derived from the authenticated user's own record and never from client-supplied identifiers.
- **FR-017**: System MUST deny access to another organization's or workspace's data even when a valid identifier is supplied, and MUST record the attempt.
- **FR-018**: System MUST detect and validate relationships between columns/datasets (via deterministic checks and/or user confirmation) and MUST NOT assume a relationship is valid unvalidated.
- **FR-019**: System MUST allow a signed-in user to create an external database data source with a read-only connection, verify read-only access before use, and reject connections that do not provide read-only access.
- **FR-020**: System MUST let the data-source owner inspect available tables, select the tables to expose, and start a synchronization into datasets.
- **FR-021**: System MUST store external-database credentials encrypted, MUST NOT return them through any API, and MUST NOT log them or include them in audit entries.
- **FR-022**: System MUST provide an Import History view listing every import for the workspace with source, filename, row count, status, and timestamps in reverse-chronological order, including safe failure details.
- **FR-023**: System MUST provide a workspace-level dashboard that can combine data from multiple datasets and MUST NOT tie the dashboard to a single uploaded file.
- **FR-024**: System MUST show KPI cards for revenue, orders, customers, expenses, and profit with period-over-period change, where each card appears only when its underlying data exists.
- **FR-025**: System MUST render charts including revenue/expenses/profit over time, sales by product, sales by region, customer trends, inventory levels, and top/underperforming products, computed from real data.
- **FR-026**: System MUST let the user filter the dashboard by date, product, category, region, and customer, and MUST recompute every visible metric and chart for the filtered subset.
- **FR-027**: System MUST NOT fabricate business data: any metric or chart area lacking underlying data MUST show an honest empty or "insufficient data" state, and period-over-period change MUST be "unavailable" when history is insufficient.
- **FR-028**: System MUST record audit entries for data-source creation, import creation, import completion, and dashboard-affecting data operations, with no secrets or payloads included.
- **FR-029**: System MUST validate all external input (request bodies, query parameters, path parameters, uploaded files) and reject invalid input with specific, field-level guidance.
- **FR-030**: System MUST return consistent, safe error responses with a machine-readable code and human-readable message, and MUST NOT expose internal details.
- **FR-031**: System MUST include automated tests for this phase: unit tests for parsing, type inference, mapping rules, quality calculations, and commit strategies, plus integration tests for upload-to-dataset lifecycle, dataset versioning, tenant isolation, and external-database sync.
- **FR-032**: System MUST enforce entitlement/usage limits wherever a data capability is gated in this phase (e.g., number of datasets or imports), server-side and not only in the interface.

### Key Entities *(include if feature involves data)*

- **Data Source**: A container for one connection to business data — either an uploaded file (spreadsheet/CSV) or an external database. Carries kind, status, and provenance; external credentials live in a never-exposed encrypted record linked to it.
- **Import**: A single processing run over a data source (file or table sync). Carries status, source, filename, row counts, error summary, and timestamps.
- **Dataset**: A versioned set of normalized business data within a workspace, with a semantic kind (sales, customers, products, inventory, expenses, orders, custom), a readiness status, and a row count. The unit of analysis for dashboards and later phases.
- **Dataset Version**: An immutable snapshot of a dataset produced by one import, with version number, commit strategy (append/replace/upsert), source, quality summary, and timestamps.
- **Dataset Column**: A typed column within a dataset version, with ordinal position, bounded type, nullability, optional mapped business meaning, and representative samples.
- **Data Quality Report**: A per-version record of observed quality — row/column counts, missing/duplicate/invalid rates, outlier counts, and an overall status.
- **Dataset Relationship**: A validated association between columns and datasets used by analytics; only stored/used after validation or user confirmation.
- **Business Metric**: A named measure (revenue, orders, customers, expenses, profit, inventory, custom) with an explicit definition used by the dashboard.
- **Dashboard**: A workspace-level presentation of metrics and charts that may draw on multiple datasets.
- **Dashboard Widget**: A single KPI card or chart within a dashboard, with a type and configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can upload a valid Excel or CSV file and reach a "ready" dataset with row and column counts; 100% of files over 25 MB or of unsupported types are rejected with a clear message.
- **SC-002**: For any accepted upload, the user receives an import identifier and visible processing status in under 2 seconds regardless of file size (within the limit).
- **SC-003**: 100% of simulated cross-tenant access attempts on data sources, imports, datasets, or dashboards are denied and recorded.
- **SC-004**: A completed import produces exactly one dataset with one version whose content matches the source file (verified by spot-check on rows, columns, and types).
- **SC-005**: Every re-import produces a distinct, correctly labeled version; 100% of append/replace/upsert operations reflect the requested strategy with prior versions preserved.
- **SC-006**: The dashboard renders KPI cards and charts within 5 seconds of opening for a workspace with ready data, and every displayed value matches a repeatable computation on the stored data.
- **SC-007**: Applying any dashboard filter recomputes all visible metrics/charts; 100% of sampled filtered views match the underlying filtered subset.
- **SC-008**: 100% of dashboard areas lacking underlying data show an honest empty/insufficient-data state; zero fabricated business figures are displayed.
- **SC-009**: Import History lists every import for the workspace in reverse-chronological order with complete metadata; each dataset version history is preserved and reviewable.
- **SC-010**: For 100% of inspected external-database data sources, connections are verified read-only before use and credentials appear in zero API responses, logs, or audit entries.
- **SC-011**: The phase gate passes end to end: automated tests, type-check, lint, and database migration validity all succeed before Phase 3 begins.

## Assumptions

- The platform's own database is PostgreSQL (the project's ratified storage stack); this specification intentionally avoids prescribing implementation technologies beyond the project's standards.
- The upload limit is 25 MB per file; larger file support is deferred to a later phase.
- External database connections in this phase support PostgreSQL as the initial engine; other engines (e.g., MySQL) can be added later without redesigning the data-source model.
- External connections are read-only by definition; GrowMetrics never requests or performs write access.
- Dashboard metrics (revenue, orders, customers, expenses, profit, inventory) are meaningful only when labeled column mappings exist — hence mapping confirmation precedes analytics-readiness.
- Schema mapping uses deterministic rules first; AI-assisted mapping is deferred to the AI phase. User confirmation is required only for low confidence, not for every mapping.
- All business data is stored in the platform's own database; original uploaded files are kept as the immutable source of truth for re-processing.
- The single-account tenancy model from Phase 1 continues: one user owns one organization and one workspace; data capabilities are scoped to that workspace.
- Entitlement limits from Phase 1 (e.g., dataset limits on the free plan) apply to the data capabilities added here and are enforced server-side.
- Audit logging from Phase 1 records data-source and import events created in this phase, with secrets never recorded.

<!-- SPEC METADATA: branch=002-data-layer; created=2026-09-18; stories=7; frs=32; s criteria=11 -->