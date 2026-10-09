# Contract: Analytics

**Base**: `/api/v1/analytics` — authenticated, tenant-scoped. All computations are deterministic backend logic over the data layer (Principle VI); results are computed live at request time (R8).

---

## POST /analytics/metrics

Calculate one or more aggregate metrics over the workspace's ready datasets (FR-027/SC-006).

**Request**
```json
{
  "metrics": [
    { "key": "revenue", "kind": "REVENUE", "datasetId": "...", "column": "total", "aggregation": "SUM" }
  ],
  "filters": {
    "dateRange": { "from": "2026-01-01", "to": "2026-03-31" },
    "dimensions": { "product": "Widget A" }
  }
}
```

| Field | Rules |
| --- | --- |
| `metrics[]` | at least one; key unique; kind in metric catalog; dataset must be tenant-owned and ready |
| `aggregation` | `SUM`, `AVG`, `COUNT`, `MIN`, `MAX` |
| `filters` | optional; `dateRange` and/or dimension key→value map |
| `compareWithPrevPeriod` | optional boolean; adds period-over-period change values when history allows |

**200**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "key": "revenue",
        "value": 482100.5,
        "unit": "USD",
        "kind": "REVENUE",
        "period": { "from": "2026-01-01", "to": "2026-03-31" },
        "changePct": 8.2,
        "changeAvailable": true,
        "sourceDatasetIds": ["..."]
      }
    ],
    "filtersApplied": { "dateRange": { "from": "...", "to": "..." }, "dimensions": { "product": "Widget A" } }
  }
}
```

When insufficient history for a period comparison, `changeAvailable` is `false` and `changePct` is null — never a misleading figure (FR-027).

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409) when a metric depends on a dataset in `READY_WITH_WARNINGS` (quality gate, FR-015).

---

## POST /analytics/compare-periods

Compare a metric across two arbitrary periods.

**Request**
```json
{
  "key": "revenue",
  "kind": "REVENUE",
  "datasetId": "...",
  "column": "total",
  "aggregation": "SUM",
  "periodA": { "from": "2026-01-01", "to": "2026-01-31" },
  "periodB": { "from": "2026-02-01", "to": "2026-02-28" }
}
```

**200**
```json
{
  "success": true,
  "data": {
    "periodA": { "value": 150000.0 },
    "periodB": { "value": 165000.0 },
    "changePct": 10.0
  }
}
```

---

## POST /analytics/group-by

Break down a metric by a dimension column.

**Request**
```json
{
  "key": "revenue",
  "kind": "REVENUE",
  "datasetId": "...",
  "column": "total",
  "aggregation": "SUM",
  "groupBy": "product",
  "limit": 10,
  "filters": { "dateRange": { "from": "2026-01-01", "to": "2026-03-31" } }
}
```

**200**
```json
{
  "success": true,
  "data": {
    "dimension": "product",
    "groups": [
      { "key": "Widget A", "value": 210000.0 },
      { "key": "Widget B", "value": 175000.0 }
    ],
    "total": 482100.5
  }
}
```

`limit` bound at 50. Sorting descending by value.

---

## Conventions

- All queries are scoped to the authenticated workspace (FR-016); cross-tenant dataset IDs → 404 (FR-017).
- Metrics over a `READY_WITH_WARNINGS` dataset are rejected with `CONFLICT` until warnings are resolved or mapping confirmed (FR-015).
- No cached/materialized aggregates in Phase 2 (R8); dashboard reads are live computations.