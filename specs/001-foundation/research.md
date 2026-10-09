# Phase 0 Research: Phase 1 — Foundation

**Feature**: `001-foundation`
**Date**: 2026-09-18
**Full design reference**: repository root [`research.md`](../../research.md) and [`architecture.md`](../../architecture.md)

This document resolves the open technical questions for Phase 1 only. Broader product design (data layer, AI, automation) lives in the root `research.md`.

## R1. Session / Authentication Strategy

- **Decision**: Short-lived JWT **access token** (15 min, HS256, signed with `jose`) delivered in an httpOnly cookie + opaque 256-bit **refresh token** (30 days) stored as a SHA-256 hash in `AuthSession`, rotated on every refresh and revoked on sign-out.
- **Rationale**: Stateless access verification keeps the common path fast; a stored, revocable refresh token gives real session revocation without server-side access-token lookups. httpOnly cookies remove token access from client scripts (reduces XSS impact).
- **Alternatives considered**: Session-ID-only server sessions (simpler but every request hits the DB); long-lived JWT in localStorage (rejected: XSS-exposed, non-revocable).
- **Security notes**: `HttpOnly`, `SameSite=Lax`, `Secure` (prod), explicit `Path=/`; access and refresh tokens on separate cookie names; refresh rotation invalidates the previous token.

## R2. Tenancy Resolution

- **Decision**: `requireAuth` verifies the access token and loads the user; `tenant-guard` resolves the single organization + workspace from the user record. Client-supplied `organizationId`/`workspaceId` are only used as a consistency check and never as the source of authorization.
- **Rationale**: Satisfies Principle III/IV with a single-account model while keeping the door open to multi-tenant membership later.
- **Alternatives considered**: Trusting path params with a scope filter (rejected: classic IDOR risk); JWTs carrying org claims (rejected: stale on changes, hidden coupling).

## R3. Registration Transaction

- **Decision**: Registration creates `User` + `Organization` + default `Workspace` inside a single Prisma transaction; the user is the implicit owner (`role = OWNER`, reserved).
- **Rationale**: Guarantees no orphaned organization/workspace on failure (FR-002) and atomic duplicate-email handling via the unique constraint.
- **Alternatives considered**: Separate calls (rejected: partial state); onboarding wizard creating org later (rejected by user: org name in register form).

## R4. Entitlements & Usage Foundation

- **Decision**: Seed three plans (Free/Pro/Business) with `featureLimits` JSON; create a default `Subscription` (FREE) at registration; expose `GET /entitlements` for the current org; record usage via `POST /usage` (internal) and expose current-period usage. Backend `requireEntitlement(key)` middleware scaffold denies when a plan lacks the capability or the limit is exceeded.
- **Rationale**: Satisfies FR-018..FR-020 and Principle "entitlements enforced in backend"; no premium UI exists yet, so the foundation is sufficient.
- **Alternatives considered**: UI-only gating (rejected: explicitly forbidden); full billing integration (out of scope for Phase 1).

## R5. Background Jobs Foundation

- **Decision**: `jobs` table is the system of record; a `job.registry` maps job types to handlers; Phase 1 ships a **dev inline executor** (runs on a set-and-forget path) and a no-op when no queue is configured. Redis signal layer wires in Phase 2+.
- **Rationale**: Satisfies Principle X's architectural requirement without requiring Redis in Phase 1; avoids blocking request handlers for future long tasks.
- **Alternatives considered**: Introducing Redis now (deferred: no async feature yet); skipping jobs entirely (rejected: would cause rework).

## R6. API Contract & Error Envelope

- **Decision**: REST under `/api/v1`; success `{ success: true, data }`; error `{ success: false, error: { code, message, details? } }`; DTOs defined in `contracts/` and mirrored in the frontend.
- **Rationale**: Matches architecture §42 and gives the frontend a single, typed error shape.
- **Alternatives considered**: Bare payloads + HTTP status only (rejected: inconsistent client handling); GraphQL (rejected: not in ratified stack).

## R7. Testing Scope for Phase 1

- **Decision**: Backend Vitest unit tests (token/password/slug/entitlement logic) + Supertest integration tests (auth lifecycle, tenant isolation, entitlements, audit). Frontend Vitest + RTL tests for the API client and key forms. Playwright E2E deferred to Phase 5.
- **Rationale**: Satisfies Principle XX (authorization + tenant isolation) and the user's "add tests in each phase" instruction within a realistic scope.
- **Alternatives considered**: E2E now (deferred: brittle before data features exist).

## R8. Frontend Data Layer

- **Decision**: A typed `api-client.ts` wrapper (base URL, `credentials: include`, error-envelope decoding) + TanStack Query for auth/context/settings; `next-themes` for light/dark; shadcn/ui primitives.
- **Rationale**: Keeps frontend free of business logic and DB access (Principle XIII/XIV) and gives consistent loading/error states.
- **Alternatives considered**: Server Actions for auth (rejected: auth belongs to the backend API per constitution); ad-hoc fetch calls (rejected: duplicated error handling).
