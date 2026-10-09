# Contract: Dashboards

**Base**: `/api/v1/dashboards` — authenticated, tenant-scoped. Dashboard belongs to the workspace (FR-023, Principle XV).

---

## GET /dashboards

List dashboards for the workspace. One default dashboard exists per workspace (Phase 2).

**200**
```json
{
  "success": true,
  "data": [
    { "id": "...", "name": "Business Dashboard", "widgetCount": 12, "updatedAt": "..." }
  ]
}
```

---

## GET /dashboards/:id

Single dashboard with its widgets (config only; values computed live at render).

**200**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Business Dashboard",
    "layout": { "type": "grid", "columns": 12 },
    "widgets": [
      {
        "id": "...",
        "type": "KPI",
        "config": { "metric": { "key": "revenue", "kind": "REVENUE", "datasetId": "...", "column": "total", "aggregation": "SUM" }, "showChange": true },
        "position": { "x": 0, "y": 0, "w": 3, "h": 2 }
      },
      {
        "id": "...",
        "type": "LINE",
        "config": { "series": [{ "key": "revenue", "kind": "REVENUE", "datasetId": "...", "column": "total", "aggregation": "SUM" }], "dateColumn": "date", "granularity": "week" },
        "position": { "x": 0, "y": 2, "w": 6, "h": 5 }
      }
    ]
  }
}
```

**Widget types**: `KPI`, `LINE`, `BAR`, `PIE`, `TABLE` (FR-025).

**Errors**: `NOT_FOUND` (404).

---

## POST /dashboards/:id/widgets

Add a widget to a dashboard.

**Request**
```json
{
  "type": "BAR",
  "config": { "series": [{ "key": "revenue", "kind": "REVENUE", "datasetId": "...", "column": "total", "aggregation": "SUM" }], "groupBy": "product" },
  "position": { "x": 6, "y": 2, "w": 6, "h": 5 }
}
```

**201**: `{ "success": true, "data": { "id": "...", "type": "BAR", ... } }`

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404).

---

## PATCH /dashboards/:id/widgets/:widgetId

Update a widget (columns, config fields, type, position).

**Request**: `{ "config": { "series": [...] }, "position": { "x": 0, "y": 0, "w": 6, "h": 5 } }`

**200**: `{ "success": true, "data": { "id": "...", "type": "...", ... } }`

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404).

---

## DELETE /dashboards/:id/widgets/:widgetId

Remove a widget from a dashboard.

**200**: `{ "success": true, "data": { "deleted": true } }`

**Errors**: `NOT_FOUND` (404).

---

## POST /dashboards/:id/preview

Compute the dashboard's widget data at render time (the frontend calls this to render the dashboard; values are always computed live — R8).

**Request**
```json
{ "filters": { "dateRange": { "from": "2026-01-01", "to": "2026-03-31" }, "dimensions": { "product": "Widget A" } } }
```

**200**
```json
{
  "success": true,
  "data": {
    "widgets": [
      {
        "id": "...",
        "type": "KPI",
        "data": { "value": 482100.5, "unit": "USD", "changePct": 8.2, "changeAvailable": true },
        "state": "ok"
      },
      {
        "id": "...",
        "type": "LINE",
        "data": { "points": [ { "label": "2026-01", "value": 150000.0 }, { "label": "2026-02", "value": 165000.0 } ] },
        "state": "ok"
      },
      {
        "id": "...",
        "type": "KPI",
        "data": null,
        "state": "no_data",
        "stateMessage": "Insufficient data to compute revenue."
      }
    ],
    "filtersApplied": { }
  }
}
```

`state` per widget: `ok` | `no_data` (honest empty state, FR-027) | `error`. Frontend renders `no_data` widgets as empty/insufficient-data states — NEVER fabricated figures (FR-027, Principle I).

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404).

---

## Conventions

- Dashboard/data relationships follow the workspace, never a single file (FR-023/architecture §34).
- Dashboard widgets store configuration only; values are computed live by the analytics service (R8).
- All resource IDs are validated tenant-scoped (FR-016/FR-017).