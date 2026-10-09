# Contract: Organizations

**Base**: `/api/v1/organizations` — all endpoints authenticated and tenant-scoped.
The organization is derived from the authenticated user's record (FR-012); no `organizationId` is accepted from the client.

## GET /organizations/current

**200**: `{ "success": true, "data": { "organization": { id, name, slug, createdAt } } }`

**Errors**: `UNAUTHENTICATED` (401).

---

## PATCH /organizations/current

**Request**: `{ "name": "New Name" }` (trimmed, 1–100, not whitespace-only)

**200**: `{ "success": true, "data": { "organization": { } } }`
Writes `org.update` audit entry.

**Errors**: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401).

**Notes**: Slug is not changed by rename in this phase (stable links).
