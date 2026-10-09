# Contract: Errors & Conventions (Phase 2)

**Base URL**: `/api/v1`
**Content-Type**: `application/json`
**Auth**: Session cookies (`dd_access`, `dd_refresh`) — `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## Success Envelope

```json
{ "success": true, "data": { } }
```

## Error Envelope

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Human-readable message", "details": { } } }
```

`details` is optional and, when present for validation errors, is a field-keyed map.

## Error Codes (Phase 1 base + Phase 2 additions)

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body/query/param failed validation |
| 400 | `BAD_REQUEST` | Malformed request |
| 400 | `FILE_TOO_LARGE` | Upload exceeds 25 MB (FR-002) |
| 400 | `FILE_TYPE_UNSUPPORTED` | Extension/content-type/magic-byte mismatch (FR-002/FR-003) |
| 400 | `FILE_EMPTY` | Empty file or headers-only |
| 400 | `UPLOAD_INVALID` | Other upload-specific rejection |
| 401 | `UNAUTHENTICATED` | Missing/invalid/expired session |
| 403 | `FORBIDDEN` | Authenticated but not allowed |
| 403 | `ENTITLEMENT_REQUIRED` | Plan does not include capability (FR-032) |
| 404 | `NOT_FOUND` | Resource not found (also used to avoid disclosure) |
| 409 | `CONFLICT` | Uniqueness/state conflict (e.g., sync already queued) |
| 409 | `DATA_SOURCE_CONFLICT` | Data-source state prevents the operation |
| 422 | `EXT_DB_CONNECTION_FAILED` | External DB unreachable/invalid credentials |
| 422 | `EXT_DB_NOT_READ_ONLY` | Connection does not verify read-only access (FR-019) |
| 422 | `IMPORT_FAILED` | Import processing failed (safe summary) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error (safe message) |

## Rules

- Never expose stack traces, SQL, secrets, credentials, or internal identifiers (FR-030).
- Cross-tenant access on data sources/imports/datasets/dashboards returns 404 (not 403) to avoid existence disclosure and MUST record an audit/security event (FR-017).
- Every response carries a request id (`x-request-id`).
- Timestamps are ISO 8601 UTC.
- List endpoints paginate: `?page=1&perPage=50` → `{ data, meta: { page, perPage, total } }`.
- Mutable endpoints are POST/PATCH/DELETE only; never GET.
- Credentials (`passwordEnc`, connection strings, R2 keys) never appear in any response, log, audit entry, or error (FR-021).