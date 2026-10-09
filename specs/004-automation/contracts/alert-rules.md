# Contract: Alert Rules

**Base**: `/api/v1/ai/alert-rules` — authenticated, tenant-scoped. The alert-rules management surface (FR-003, FR-008).

---

## POST /ai/alert-rules

Create a rule.

**Request**

```json
{
  "name": "Revenue drop alert",
  "metricKind": "REVENUE",
  "condition": "LESS_THAN",
  "threshold": 100000,
  "frequency": "DAILY",
  "recipients": ["user@example.com"]
}
```

**Constraints**: `metricKind` must be a canonical metric key; `recipients` non-empty array of emails.

**Response**

```json
{
  "success": true,
  "data": {
    "id": "rule-uuid",
    "name": "Revenue drop alert",
    "metricKind": "REVENUE",
    "condition": "LESS_THAN",
    "threshold": 100000,
    "frequency": "DAILY",
    "recipients": ["user@example.com"],
    "enabled": true,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

---

## GET /ai/alert-rules

List rules for the tenant. Paginated.

**Response** `{ success: true, data: { items: [...], total, page, limit } }`

Each item contains `id`, `name`, `metricKind`, `condition`, `threshold`, `frequency`, `recipients`, `enabled`, `lastTriggeredAt`, `createdAt`.

---

## GET /ai/alert-rules/:id

Full rule detail.

---

## PATCH /ai/alert-rules/:id

Update any field (name, condition, threshold, frequency, cron, recipients, enabled).

**Request** — same fields as create, all optional.

---

## Conventions

- Tenant-scoped; foreign ids → `NOT_FOUND` + audit.
- `condition` values: `GREATER_THAN`, `LESS_THAN`, `EQUAL_TO`, `CHANGES_BY`.
- `frequency` values: `DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM` (requires `cron`).
- The evaluation job runs on schedule (background, not an API).
- Recipients are stored as JSON email addresses; delivery is via `SEND_EMAIL` job.
