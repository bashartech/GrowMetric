# Contract: Workspaces

**Base**: `/api/v1/workspaces` — authenticated and tenant-scoped.

## GET /workspaces

Returns workspaces belonging to the authenticated user's organization.

**200**: `{ "success": true, "data": { "workspaces": [ { id, name, slug, isDefault } ] } }`

---

## GET /workspaces/current

Returns the user's current (default) workspace.

**200**: `{ "success": true, "data": { "workspace": { id, name, slug, isDefault } } }`

**Errors**: `UNAUTHENTICATED` (401).

---

## PATCH /workspaces/:id

Update name. The `:id` is validated to belong to the caller's organization; otherwise 404 (no disclosure).

**Request**: `{ "name": "New Name" }` (trimmed, 1–100)

**200**: `{ "success": true, "data": { "workspace": { } } }`
Writes `workspace.update` audit entry.

**Errors**: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `NOT_FOUND` (404).
