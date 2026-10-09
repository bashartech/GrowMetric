# Contract: Authentication

**Base**: `/api/v1/auth`

## DTOs

```ts
type UserDTO = {
  id: string; name: string; email: string; role: "OWNER" | "ADMIN" | "MEMBER";
  organizationId: string; lastLoginAt: string | null; createdAt: string;
};

type OrganizationDTO = { id: string; name: string; slug: string; createdAt: string };
type WorkspaceDTO = { id: string; name: string; slug: string; isDefault: boolean };

type AuthContextDTO = {
  user: UserDTO;
  organization: OrganizationDTO;
  workspace: WorkspaceDTO;
  subscription: { planKey: string; planName: string; status: string; currentPeriodEnd: string };
};
```

---

## POST /auth/register

Public. Rate-limited. Atomic (FR-002).

**Request**
```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "Secret123", "organizationName": "Analytical Engines" }
```

| Field | Rules |
| --- | --- |
| `name` | trimmed, 1–100 |
| `email` | valid email, normalized (trim+lowercase), unique |
| `password` | 8–72 chars, ≥1 letter, ≥1 number |
| `organizationName` | trimmed, 1–100 |

**201**
```json
{ "success": true, "data": { "user": { }, "organization": { }, "workspace": { } } }
```
Sets `dd_access` + `dd_refresh` cookies. Creates exactly one organization, one default workspace, Free subscription, welcome notification, `auth.register` audit entry.

**Errors**: `VALIDATION_ERROR` (400), `EMAIL_IN_USE` (409), `RATE_LIMITED` (429).

---

## POST /auth/login

Public. Rate-limited.

**Request**: `{ "email": "...", "password": "..." }`

**200**: `{ "success": true, "data": { "user": { } } }` + sets cookies + `auth.login` audit.

**Errors**: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401, generic — never reveals which field), `RATE_LIMITED` (429).

---

## POST /auth/refresh

Uses `dd_refresh` cookie (no body). Rotates the refresh token.

**200**: `{ "success": true, "data": { "refreshed": true } }` + new cookies.

**Errors**: `UNAUTHENTICATED` (401) when missing/revoked/expired; clears cookies.

---

## POST /auth/logout

Authenticated (idempotent: succeeds even if already signed out).

**200**: `{ "success": true, "data": { "loggedOut": true } }` + clears cookies + `auth.logout` audit (when authenticated).

---

## GET /auth/me

Authenticated.

**200**
```json
{ "success": true, "data": { "user": { }, "organization": { }, "workspace": { }, "subscription": { } } }
```

**Errors**: `UNAUTHENTICATED` (401).

## Cookie Attributes

| Cookie | Value | Lifetime | Flags |
| --- | --- | --- | --- |
| `dd_access` | JWT (HS256) | 15 min | `HttpOnly; SameSite=Lax; Secure(prod); Path=/` |
| `dd_refresh` | opaque 256-bit | 30 days | `HttpOnly; SameSite=Lax; Secure(prod); Path=/api/v1/auth` |

Refresh token stored SHA-256-hashed in `AuthSession`; rotated on every refresh; previous token revoked.
