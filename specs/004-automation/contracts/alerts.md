# Contract: Alerts

**Base**: `/api/v1/ai/alerts` — authenticated, tenant-scoped. The alerts list + inbox (FR-004, FR-008).

---

## GET /ai/alerts

List alerts for the tenant, filterable by severity, status, and ruleId. Paginated.

**Query params**

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `severity` | `AlertSeverity` | no | filter |
| `status` | `AlertStatus` | no | default `OPEN` |
| `ruleId` | UUID | no | filter by rule |
| `page` | Integer | no | page (default 1) |
| `limit` | Integer | no | page size (default 50, max 200) |

**Response**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "alert-uuid",
        "ruleId": "rule-uuid",
        "title": "Revenue below threshold",
        "severity": "HIGH",
        "message": "Revenue for August 2026 is below 100000.",
        "evidence": { "metricKind": "REVENUE", "currentValue": 85000, "threshold": 100000, "condition": "LESS_THAN", "period": "2026-08" },
        "status": "OPEN",
        "isRead": false,
        "createdAt": "..."
      }
    ],
    "total": 1,
    "unreadCount": 2,
    "page": 1,
    "limit": 50
  }
}
```

---

## GET /ai/alerts/:id

Full alert detail with evidence.

---

## PATCH /ai/alerts/:id/status

Update the alert status.

**Request**

```json
{ "status": "ACKNOWLEDGED" }
```

**Allowed transitions**: `OPEN` → `ACKNOWLEDGED | RESOLVED`; any → `RESOLVED`.

---

## Conventions

- Tenant-scoped; foreign ids → `NOT_FOUND` + audit.
- Alerts are created by the background alert evaluator (not an API).
- `isRead` drives the in-app notification badge; `unreadCount` in list responses is `status: OPEN` + `isRead: false`.
- Firing an alert enqueues `SEND_EMAIL` and creates a notification — the alert API is for inspection and status updates.
