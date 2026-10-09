# Contract: Imports

**Base**: `/api/v1/imports` — authenticated, tenant-scoped. Imports are created via `POST /data-sources` (file upload) or `POST /data-sources/:id/sync` (table sync); these endpoints manage import lifecycle and status.

---

## GET /imports

List imports for the workspace in reverse-chronological order with metadata (FR-022).

**Query params**: `?page=1&perPage=50&status=COMPLETED&dataSourceId=...` (all optional)

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "source": "UPLOAD",
      "status": "COMPLETED",
      "filename": "q1_sales.xlsx",
      "totalRows": 45213,
      "processedRows": 45213,
      "dataSource": { "id": "...", "name": "Q1 Sales" },
      "error": null,
      "startedAt": "2026-09-18T10:02:00.000Z",
      "completedAt": "2026-09-18T10:03:12.000Z",
      "createdAt": "2026-09-18T10:01:58.000Z"
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 12 }
}
```

---

## GET /imports/:id

Single import details, including dataset if created (FR-022/FR-025).

**200**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "source": "UPLOAD",
    "status": "COMPLETED",
    "filename": "q1_sales.xlsx",
    "totalRows": 45213,
    "processedRows": 45213,
    "dataset": { "id": "...", "name": "q1_sales", "kind": "SALES", "status": "READY", "rowCount": 45213 },
    "dataSource": { "id": "...", "name": "Q1 Sales", "kind": "FILE" },
    "error": null,
    "startedAt": "...",
    "completedAt": "...",
    "createdAt": "..."
  }
}
```

**Errors**: `NOT_FOUND` (404).

---

## POST /imports/:id/cancel

Cancel a queued or in-progress import. Idempotent (succeeds if already canceled/failed/completed).

**200**: `{ "success": true, "data": { "status": "CANCELED" } }`

**Errors**: `NOT_FOUND` (404), `CONFLICT` (409) when import is not cancelable.

---

## POST /imports/:id/retry

Retry a failed import. Creates a new ImportJob for the same data source/file.

**202**: `{ "success": true, "data": { "import": { "id": "...", "status": "QUEUED", "createdAt": "..." } } }`

**Errors**: `NOT_FOUND` (404), `CONFLICT` (409) when the import has not failed.

---

## Import Status lifecycle

```text
QUEUED → RUNNING → COMPLETED
                 → REQUESTING_MAPPING (paused for user confirmation)
                 → FAILED
       QUEUED → CANCELED (from user)
```

`REQUESTING_MAPPING`: import is paused; user must confirm/resolved via `POST /datasets/:id/confirm-mapping` (Datasets contract). The import remains in this status until mapping is resolved or the user cancels.

---

## Mapping Confirmation (part of dataset contract)

When an import pauses in `REQUESTING_MAPPING`, the user resolves it via:

**POST /datasets/:id/confirm-mapping** (Datasets contract, referenced here for lifecycle clarity)

**Request**
```json
{
  "confirmations": [
    { "columnId": "...", "semanticKey": "revenue", "businessMeaning": "Revenue" },
    { "columnId": "...", "semanticKey": "order_date", "businessMeaning": "Order Date" }
  ]
}
```

**200**: dataset status transitions to `READY` or `READY_WITH_WARNINGS`; import status transitions to `COMPLETED`.

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404).