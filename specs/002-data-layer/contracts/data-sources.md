# Contract: Data Sources

**Base**: `/api/v1/data-sources` — authenticated, tenant-scoped.

---

## POST /data-sources

Create a FILE-kind data source via file upload (FR-001/FR-002/FR-004).

**Request**: `multipart/form-data`

| Field | Type | Rules |
| --- | --- | --- |
| `file` | File | required; ≤ 25 MB; CSV/XLSX; validated by extension + magic bytes |
| `name` | String | optional; defaults to filename without extension; 1–100 chars |

**201**
```json
{
  "success": true,
  "data": {
    "dataSource": {
      "id": "...",
      "name": "Q1 Sales",
      "kind": "FILE",
      "status": "NEW",
      "createdAt": "2026-09-18T..."
    },
    "import": {
      "id": "...",
      "status": "QUEUED",
      "filename": "q1_sales.xlsx",
      "createdAt": "..."
    }
  }
}
```

Creates the DataSource + ImportJob + underlying Job atomically. Returns immediately; no processing in the request path (FR-004/FR-005).

**Errors**: `VALIDATION_ERROR` (400), `FILE_TOO_LARGE` (400), `FILE_TYPE_UNSUPPORTED` (400), `FILE_EMPTY` (400), `RATE_LIMITED` (429).

---

## POST /data-sources/external-db

Create an EXTERNAL_DB-kind data source with a read-only PostgreSQL connection (FR-019).

**Request**
```json
{
  "name": "Production DB",
  "host": "db.example.com",
  "port": 5432,
  "database": "analytics",
  "username": "dd_readonly_user",
  "password": "secret123",
  "sslMode": "require"
}
```

| Field | Rules |
| --- | --- |
| `name` | trimmed, 1–100 |
| `host` | non-empty string |
| `port` | 1–65535 |
| `database` | non-empty |
| `username` | non-empty |
| `password` | non-empty |
| `sslMode` | `disable`, `require`, or `verify-ca` |

**201**
```json
{
  "success": true,
  "data": {
    "dataSource": { "id": "...", "name": "Production DB", "kind": "EXTERNAL_DB", "status": "CONNECTED", "createdAt": "..." }
  }
}
```

On success: validates read-only access (`SHOW transaction_read_only`), encrypts password at rest, stores credential, sets status `CONNECTED`. Password is NEVER returned.

**Errors**: `VALIDATION_ERROR` (400), `EXT_DB_CONNECTION_FAILED` (422), `EXT_DB_NOT_READ_ONLY` (422), `RATE_LIMITED` (429).

---

## GET /data-sources

List all data sources for the authenticated user's workspace (paginated).

**Query params**: `?page=1&perPage=50`

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...", "name": "Q1 Sales", "kind": "FILE", "status": "VALIDATED",
      "lastSyncAt": "...", "createdAt": "..."
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 3 }
}
```

---

## GET /data-sources/:id

Single data source details. `id` is validated against the authenticated user's workspace (FR-016); cross-tenant returns 404 (FR-017).

**200**: `{ "success": true, "data": { "id": "...", "name": "...", "kind": "...", "status": "...", ... } }`

**Errors**: `NOT_FOUND` (404).

---

## PATCH /data-sources/:id

Update data source name or status. (e.g., rename; disable).

**Request**: `{ "name": "New name" }` or `{ "status": "DISABLED" }`

**200**: `{ "success": true, "data": { "id": "...", "name": "...", "status": "..." } }`

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `DATA_SOURCE_CONFLICT` (409).

---

## DELETE /data-sources/:id

Delete a data source and its associated imports, files, and datasets (cascading; audit logged).

**200**: `{ "success": true, "data": { "deleted": true } }`

**Errors**: `NOT_FOUND` (404).

---

## GET /data-sources/:id/tables

For EXTERNAL_DB-kind data sources: list discovered tables with column counts and row estimates (FR-020).

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "schemaName": "public",
      "tableName": "orders",
      "columnCount": 8,
      "rowEstimate": 125432,
      "isSelected": false,
      "profile": { "columns": ["id", "total", "customer_id", "..."] }
    }
  ]
}
```

**Errors**: `NOT_FOUND` (404), `EXT_DB_CONNECTION_FAILED` (422) when the external DB is unreachable.

---

## PATCH /data-sources/:id/tables

Update which tables are selected for sync (FR-020). Sets `isSelected` on `DataSourceTable` rows.

**Request**
```json
{ "tables": [{ "schemaName": "public", "tableName": "orders" }, { "schemaName": "public", "tableName": "customers" }] }
```

**200**: `{ "success": true, "data": { "selectedCount": 2 } }`

**Errors**: `NOT_FOUND` (404), `BAD_REQUEST` (400) when no tables provided.

---

## POST /data-sources/:id/sync

Start an async TABLE_SYNC for the selected tables on an EXTERNAL_DB data source (FR-020/R7). Returns an ImportJob per table (batched into one sync job).

**202**
```json
{
  "success": true,
  "data": {
    "importJobs": [
      { "id": "...", "source": "TABLE_SYNC", "status": "QUEUED", "filename": "public.orders" }
    ]
  }
}
```

**Errors**: `NOT_FOUND` (404), `BAD_REQUEST` (400) when no tables selected, `DATA_SOURCE_CONFLICT` (409) when already syncing.

---

## Credentials security note

`DataSourceCredential` fields (`passwordEnc`, `host`, `port`, `database`, `username`) are NEVER returned by any data-source endpoint. The list/details response includes only `id`, `kind`, `status`, and metadata.