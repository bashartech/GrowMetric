# Contract: Anomaly Detections

**Base**: `/api/v1/ai/anomaly-detections` — authenticated, tenant-scoped. Backs the recommendations surface and the anomaly inspection view (FR-001, FR-008).

---

## GET /ai/anomaly-detections

List anomaly detections for the tenant, filterable by dataset, period, status, and kind. Paginated.

**Query params**

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `datasetId` | UUID | no | filter by dataset |
| `period` | String | no | filter by period (e.g. `2026-08`) |
| `status` | `AnomalyStatus` | no | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| `kind` | String | no | e.g. `SPIKE`, `DROP` |
| `page` | Integer | no | page number (default 1) |
| `limit` | Integer | no | page size (default 50, max 200) |

**Response**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "an-uuid",
        "datasetId": "ds-uuid",
        "metricId": "REVENUE",
        "kind": "SPIKE",
        "period": "2026-08",
        "baseline": { "period": "2026-07", "value": 482100 },
        "observed": { "period": "2026-08", "value": 723150 },
        "deviationPct": 50.0,
        "status": "OPEN",
        "createdAt": "..."
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
  }
}
```

- Baseline/observed values are the raw snapshots from the last worker run.
- Tenant-scoped: foreign anomaly ids → `NOT_FOUND` + audit.

---

## GET /ai/anomaly-detections/:id

Full anomaly detail + derived recommendation (if any).

**Response**

```json
{
  "success": true,
  "data": {
    "id": "an-uuid",
    "datasetId": "ds-uuid",
    "datasetName": "sales-2026",
    "metricId": "REVENUE",
    "kind": "SPIKE",
    "period": "2026-08",
    "baseline": { "period": "2026-07", "value": 482100 },
    "observed": { "period": "2026-08", "value": 723150 },
    "deviationPct": 50.0,
    "status": "OPEN",
    "recommendation": { "id": "rec-uuid", "severity": "HIGH", "source": "ANOMALY", "title": "..." } | null,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

---

## Conventions

- All scope via authenticated org/workspace (FR-008); foreign ids → `NOT_FOUND` + audit.
- The anomaly worker (background, not an API) persists rows; this contract is for inspection and the recommendations surface.
- No secrets or raw provider transcripts are ever returned.
