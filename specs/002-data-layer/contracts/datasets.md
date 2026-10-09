# Contract: Datasets

**Base**: `/api/v1/datasets` — authenticated, tenant-scoped.

---

## GET /datasets

List datasets for the workspace (paginated, reverse-chronological by updatedAt).

**Query params**: `?page=1&perPage=50&kind=SALES&status=READY` (all optional)

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Q1 Sales",
      "kind": "SALES",
      "status": "READY",
      "rowCount": 45213,
      "version": 1,
      "dataSource": { "id": "...", "name": "Q1 Sales" },
      "updatedAt": "2026-09-18T..."
    }
  ],
  "meta": { "page": 1, "perPage": 50, "total": 4 }
}
```

---

## GET /datasets/:id

Single dataset details with current version and column list.

**200**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Q1 Sales",
    "kind": "SALES",
    "status": "READY",
    "rowCount": 45213,
    "source": "Q1 Sales",
    "version": 1,
    "commit": "REPLACE",
    "columns": [
      {
        "id": "...",
        "name": "total",
        "type": "DECIMAL",
        "ordinalPosition": 3,
        "isNullable": true,
        "semanticKey": "revenue",
        "businessMeaning": "Revenue",
        "representativeSample": ["1250.00", "890.50", null]
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors**: `NOT_FOUND` (404).

---

## PATCH /datasets/:id

Update dataset name or kind (FR-025).

**Request**: `{ "name": "Renamed Sales" }` or `{ "kind": "ORDERS" }`

**200**: `{ "success": true, "data": { "id": "...", "name": "...", "kind": "..." } }`

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404).

---

## GET /datasets/:id/versions

List all versions for a dataset, reverse-chronological (FR-025).

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "version": 2,
      "commit": "APPEND",
      "source": "q1_sales_march.xlsx",
      "status": "READY",
      "rowCount": 12453,
      "createdAt": "..."
    },
    {
      "id": "...",
      "version": 1,
      "commit": "REPLACE",
      "source": "q1_sales.xlsx",
      "status": "READY",
      "rowCount": 45213,
      "createdAt": "..."
    }
  ]
}
```

---

## POST /datasets/:id/re-import

Re-import data into an existing dataset with an explicit commit strategy (FR-012/FR-025/US7).

**Request**: `multipart/form-data`

| Field | Type | Rules |
| --- | --- | --- |
| `file` | File | required; ≤ 25 MB; CSV/XLSX |
| `commit` | String | `APPEND`, `REPLACE`, or `UPSERT` |
| `upsertKey` | String | required when `commit = UPSERT`; column name to match |

**202**
```json
{
  "success": true,
  "data": {
    "import": { "id": "...", "status": "QUEUED", "source": "q1_sales_march.xlsx", "createdAt": "..." }
  }
}
```

**Errors**: `VALIDATION_ERROR` (400), `FILE_TOO_LARGE` (400), `FILE_TYPE_UNSUPPORTED` (400), `NOT_FOUND` (404).

---

## GET /datasets/:id/rows

Paginated row preview for a dataset version (column-pruned SQL; paginated).

**Query params**: `?page=1&perPage=20` (max 200 per page)

**200**
```json
{
  "success": true,
  "data": {
    "rows": [
      { "id": "...", "rowIndex": 0, "cells": { "total": "1250.00", "date": "2026-01-15", "product": "Widget A" } },
      { "id": "...", "rowIndex": 1, "cells": { "total": "890.50", "date": "2026-01-16", "product": "Widget B" } }
    ]
  },
  "meta": { "page": 1, "perPage": 20, "total": 45213 }
}
```

**Errors**: `NOT_FOUND` (404).

---

## POST /datasets/:id/confirm-mapping

Confirm schema mappings when the import paused in `REQUESTING_MAPPING` (FR-009/FR-013).

**Request**
```json
{
  "confirmations": [
    { "columnId": "...", "semanticKey": "revenue", "businessMeaning": "Revenue" },
    { "columnId": "...", "semanticKey": "order_date", "businessMeaning": "Order Date" }
  ]
}
```

**200**
```json
{
  "success": true,
  "data": {
    "status": "READY",
    "importStatus": "COMPLETED"
  }
}
```

After confirmation: dataset `READY_WITH_WARNINGS` → `READY`; import `REQUESTING_MAPPING` → `COMPLETED`.

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409) when the dataset is not awaiting mapping.

---

## GET /datasets/:id/relationships

List detected/confirmed relationships (FR-018).

**200**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "sourceColumn": { "id": "...", "name": "customer_id" },
      "targetDataset": { "id": "...", "name": "Customers" },
      "targetColumn": { "id": "...", "name": "id" },
      "relationshipType": "MANY_TO_ONE",
      "detectedBy": "RULES",
      "confidence": 0.95,
      "isConfirmed": true
    }
  ]
}
```