# Contract: Audit Logs

**Base**: `/api/v1/audit-logs` — authenticated and tenant-scoped. Append-only.

## GET /audit-logs

Returns the organization's audit entries in reverse-chronological order, paginated.

**Query**: `page` (default 1, ≥1), `pageSize` (default 20, 1–100), `action` (optional filter)

**200**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "action": "auth.login",
        "resourceType": "user",
        "resourceId": "uuid",
        "actor": { "id": "uuid", "name": "Ada Lovelace" },
        "workspaceId": null,
        "ipAddress": "203.0.113.4",
        "createdAt": "2026-09-18T12:00:00.000Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 42
  }
}
```

**Rules / Errors**: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401).
Entries never contain passwords, tokens, or other secrets (FR-022). There is no create/update/delete endpoint; entries are written by services only.
