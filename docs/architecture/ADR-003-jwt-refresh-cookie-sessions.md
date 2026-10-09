# ADR-003: JWT Access Cookie + Rotating Refresh-Cookie Sessions

- **Status:** Accepted
- **Date:** 2026-09-18
- **Feature:** 001-foundation
- **Context:** The app needs durable, revocable sessions that survive reloads, support transparent renewal, and expose no tokens to client JavaScript. The frontend (Next.js :3000) and API (Express :4000) are separate origins in development.

## Decision

Use a **short-lived JWT access token in an httpOnly cookie** plus a **long-lived, opaque, hashed, rotating refresh token in a path-scoped httpOnly cookie**.

- **Access token**: HS256 JWT (`jose`), TTL 15 minutes (`ACCESS_TOKEN_TTL_MINUTES`), cookie `dd_access`, `path=/`.
- **Refresh token**: 32-byte random opaque value; only its SHA-256 hash is stored (`AuthSession.refreshTokenHash`). Cookie `dd_refresh`, `path=/api/v1/auth`, TTL 30 days (`REFRESH_TOKEN_TTL_DAYS`).
- **Cookie flags**: `httpOnly: true`, `sameSite: "lax"`, `secure: env.COOKIE_SECURE` (must be `true` in production).
- **Rotation & revocation**: `POST /auth/refresh` revokes the presented session row and issues a new one (rotate-on-use). `POST /auth/logout` revokes the session and clears cookies. Replaying a revoked/expired token yields `UNAUTHENTICATED` (verified by tests).
- **Transparent renewal**: the frontend API client retries once on a 401 via `POST /auth/refresh`, then replays the original request.
- **Enumeration safety**: sign-in returns a single generic `Invalid email or password.` and performs a constant-time bcrypt comparison against a dummy hash when the user is absent.
- **Rate limiting**: `POST /auth/register` and `POST /auth/login` are limited per IP (10 / 15 min by default).
- **Tenant identity in the token**: the access token carries `sub`, `email`, `org`, `ws`; the server still re-resolves the tenant from the database via the tenant guard.

## Consequences

### Positive

- Tokens are never readable by client JavaScript (no XSS token theft).
- Refresh tokens are opaque and stored hashed, so a database read does not yield usable credentials.
- Rotation limits the blast radius of a leaked refresh token and makes replay detectable via revocation.
- Session revocation on sign-out is server-authoritative, not merely client-side.

### Negative

- Cross-origin cookies require correct CORS (`credentials: true` + a specific origin) and, in production, HTTPS with `COOKIE_SECURE=true`.
- Refresh rotation adds a write on renewal; with a remote database this is a measurable latency cost (mitigated by short-lived access tokens).
- CSRF must be managed with `SameSite=Lax` plus the restricted refresh-cookie path; a dedicated CSRF token may be added in a later hardening phase.

## Alternatives Considered

- **Bearer tokens in `localStorage`**: rejected — vulnerable to XSS exfiltration and no server-side revocation story.
- **Long-lived single access token**: rejected — no revocation, larger exposure window.
- **Server-side sessions only (opaque session id cookie)**: viable, but the JWT access token removes a database round-trip on every request while the refresh token still provides revocability.
- **Rotating refresh tokens stored in plaintext**: rejected — a database leak would hand over live sessions.

## References

- Feature Spec: `specs/001-foundation/spec.md` (FR-006–FR-010, FR-022)
- Implementation Plan: `specs/001-foundation/plan.md`
- Contracts: `specs/001-foundation/contracts/auth.md`
- Implementation: `backend/src/lib/tokens.ts`, `backend/src/lib/cookies.ts`, `backend/src/modules/auth/auth.service.ts`
- Related ADRs: ADR-002 (tenancy)
