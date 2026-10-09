# Contract: Recommendations

**Base**: `/api/v1/ai/recommendations` — authenticated, tenant-scoped. The "What should I pay attention to" surface (FR-002, FR-008).

---

## GET /ai/recommendations

List recommendations for the tenant, filterable by severity, source, and status. Paginated.

**Query params**

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `severity` | `RecommendationSeverity` | no | filter |
| `source` | `RecommendationSource` | no | `ANOMALY`, `INVESTIGATION`, `RULE`, `SIMULATION`, `SYSTEM` |
| `status` | `RecommendationStatus` | no | default `OPEN` |
| `page` | Integer | no | page (default 1) |
| `limit` | Integer | no | page size (default 50, max 200) |

**Response**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "rec-uuid",
        "title": "Revenue spike detected",
        "severity": "HIGH",
        "category": "REVENUE_SPIKE",
        "description": "...",
        "evidence": { "datasetName": "sales-2026", "metric": "REVENUE", "period": "2026-08", "deviationPct": 50.0 },
        "source": "ANOMALY",
        "datasetId": "ds-uuid",
        "suggestedAction": "Review revenue drivers for August vs July.",
        "status": "OPEN",
        "isRead": false,
        "createdAt": "..."
      }
    ],
    "total": 1,
    "unreadCount": 3,
    "page": 1,
    "limit": 50
  }
}
```

---

## GET /ai/recommendations/:id

Full recommendation detail with evidence.

**Response** — same as item above, with full `evidence` object.

---

## PATCH /ai/recommendations/:id/status

Update the recommendation status.

**Request**

```json
{ "status": "ACKNOWLEDGED" }
```

**Allowed transitions**: `OPEN` → `ACKNOWLEDGED | DISMISSED`; `OPEN` → `RESOLVED`; any → `DISMISSED`.

**Response**: the updated recommendation.

---

## Conventions

- Tenant-scoped; foreign ids → `NOT_FOUND` + audit.
- `suggestedAction` is always deterministic text; never an invented figure.
- The recommendations surface aggregates `Recommendation` rows; the generation job is background (not an API).
- Unread badge count comes from `status: OPEN` + `isRead: false`.
