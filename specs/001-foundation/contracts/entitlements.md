# Contract: Entitlements & Usage

**Base**: `/api/v1` — authenticated and tenant-scoped. Backend enforcement is authoritative (FR-020).

## GET /entitlements

Returns the plan and feature limits for the authenticated user's organization.

**200**
```json
{
  "success": true,
  "data": {
    "plan": { "key": "free", "name": "Free" },
    "features": { "aiInvestigations": 5, "simulations": false, "reports": false },
    "subscription": { "status": "ACTIVE", "currentPeriodEnd": "2026-10-18T00:00:00.000Z" }
  }
}
```

---

## GET /usage?metric=ai_investigations

Returns current-period usage for a metric (or all tracked metrics when `metric` is omitted).

**200**: `{ "success": true, "data": { "metric": "ai_investigations", "periodStart": "...", "periodEnd": "...", "amount": 3 } }`

---

## POST /usage *(internal)*

Records usage against the current period (upsert-increment).

**Request**: `{ "metric": "ai_investigations", "amount": 1 }`

**200**: `{ "success": true, "data": { "metric": "...", "amount": 4 } }`

**Errors**: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `ENTITLEMENT_REQUIRED` (403) when the metric limit is exceeded.

**Notes**: `requireEntitlement(key)` middleware scaffold used by later gated routes; denies with `ENTITLEMENT_REQUIRED` server-side.
