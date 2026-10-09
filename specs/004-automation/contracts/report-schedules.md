# Contract: Report Schedules

**Base**: `/api/v1/ai/report-schedules` — authenticated, tenant-scoped. Schedule management (FR-005, FR-008).

---

## POST /ai/report-schedules

Create a schedule for a report.

**Request**

```json
{
  "reportId": "report-uuid",
  "frequency": "WEEKLY",
  "cron": "0 9 * * 1",
  "timezone": "America/New_York",
  "recipients": ["user@example.com"]
}
```

**Constraints**: `frequency` is `DAILY`, `WEEKLY`, `MONTHLY`, or `CUSTOM` (requires `cron`).

**Response**

```json
{
  "success": true,
  "data": {
    "id": "schedule-uuid",
    "reportId": "report-uuid",
    "frequency": "WEEKLY",
    "cron": "0 9 * * 1",
    "timezone": "America/New_York",
    "recipients": ["user@example.com"],
    "enabled": true,
    "nextRunAt": "...",
    "createdAt": "..."
  }
}
```

---

## GET /ai/report-schedules

List schedules for the tenant. Paginated.

---

## GET /ai/report-schedules/:id

Full schedule detail.

---

## PATCH /ai/report-schedules/:id

Update any field (frequency, cron, timezone, recipients, enabled).

---

## Conventions

- Tenant-scoped; foreign ids → `NOT_FOUND` + audit.
- A schedule belongs to one report; a report can have at most one schedule.
- `nextRunAt` is advanced to the next cron occurrence each time the schedule fires.
- The schedule drives `GENERATE_REPORT` background jobs.
