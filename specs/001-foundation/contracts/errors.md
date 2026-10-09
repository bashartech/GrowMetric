# Contract: Errors & Conventions

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

## Error Codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body/query/param failed validation |
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHENTICATED` | Missing/invalid/expired session |
| 403 | `FORBIDDEN` | Authenticated but not allowed |
| 403 | `ENTITLEMENT_REQUIRED` | Plan does not include capability |
| 404 | `NOT_FOUND` | Resource not found (also used to avoid disclosure) |
| 409 | `EMAIL_IN_USE` | Registration email already exists |
| 409 | `CONFLICT` | Other uniqueness/state conflict |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error (safe message) |

## Rules

- Never expose stack traces, SQL, secrets, or internal identifiers.
- 404 (not 403) for cross-tenant resources to avoid existence disclosure.
- Every response carries a request id (`x-request-id` header, echoed from request if present).
- Auth endpoints: 429 after 10 attempts / 15 min / IP.
- Timestamps are ISO 8601 UTC.
