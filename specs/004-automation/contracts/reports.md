# Contract: Reports

**Base**: `/api/v1/ai/reports` — authenticated, tenant-scoped. Report creation + management (FR-005, FR-008).

---

## POST /ai/reports

Create a report.

**Request**

```json
{
  "kind": "WEEKLY",
  "title": "Weekly Revenue Summary",
  "metricKeys": ["REVENUE", "ORDERS"]
}
```

**Constraints**: `kind` is `WEEKLY`, `MONTHLY`, or `CUSTOM`; `metricKeys` references canonical metric keys.

**Response**

```json
{
  "success": true,
  "data": {
    "id": "report-uuid",
    "kind": "WEEKLY",
    "title": "Weekly Revenue Summary",
    "status": "DRAFT",
    "createdAt": "...", "updatedAt": "..."
  }
}
```

---

## GET /ai/reports

List reports for the tenant. Paginated.

**Response** `{ success: true, data: { items: [...], total, page, limit } }`

Each item: `id`, `kind`, `title`, `status`, `createdAt`.

---

## GET /ai/reports/:id

Full report detail including `content` (present when `status: GENERATED`).

---

## POST /ai/reports/:id/generate

Trigger an immediate generation (admin/manual). Returns `202 Accepted` with the report id; the background job sets `status: GENERATED` or `FAILED`.

---

## Conventions

- Tenant-scoped; foreign ids → `NOT_FOUND` + audit.
- Report `content` is a structured JSON blob computed from existing metric definitions (no new visualization engine).
- Generation is a background job; immediate generate returns `202 Accepted`.
- `status` transitions: `DRAFT` → `GENERATED` | `FAILED`.
