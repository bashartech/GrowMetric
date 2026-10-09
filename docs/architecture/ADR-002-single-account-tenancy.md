# ADR-002: Single-Account Tenancy (User–Organization–Workspace)

- **Status:** Accepted
- **Date:** 2026-09-18
- **Feature:** 001-foundation
- **Context:** The product must be multi-tenant from its foundation, but Phase 1 has no collaboration, invitation, or role-management surface. We needed a tenancy model that is correct and secure now without building unused membership machinery.

## Decision

Establish tenancy as **one account = one user owning exactly one organization and one default workspace**.

- Registration creates `User` (role `OWNER`), `Organization`, a default `Workspace`, a Free `Subscription`, a welcome `Notification`, and an `auth.register` `AuditLog` in a single Prisma transaction.
- There is no `Membership` table, no invitations, no role-management UI, and no team surface in this phase.
- The `User.role` column (default `OWNER`) is retained as a forward-compatible hook for future multi-user organizations.
- Every tenant-scoped request derives `organizationId` **from the authenticated user's record** (server-side). The client never supplies `organizationId`; supplying one is ignored (verified by the tenant-isolation test).
- Workspace lookups are always scoped by the caller's `organizationId`; foreign ids return `NOT_FOUND` to avoid disclosure.

This decision was reviewed and **approved by the product owner (user consent recorded 2026-09-18)** before implementation, satisfying the "no silent architecture changes" principle.

## Consequences

### Positive

- Smallest correct tenancy surface: fewer tables, fewer authorization paths, less attack surface.
- Tenant isolation is trivially auditable — one boundary (the authenticated user) resolves the tenant.
- Cross-tenant IDOR is structurally prevented (queries are scoped, not filtered after fetch).
- Later multi-user support is additive: introduce `Membership`, move `role` to it, and gate by membership instead of ownership.

### Negative

- Growing to genuine multi-user/team support requires a migration and authorization refactor.
- The `role` column currently has no behavioral effect; it is intentionally reserved and documented.
- Some product areas implied by "multi-tenant SaaS" (invites, seats) are explicitly deferred.

## Alternatives Considered

- **Full membership model now** (`Organization` ↔ `Membership` ↔ `User` many-to-many, roles, invites): rejected as speculative complexity with no Phase 1 user story, higher bug surface, and slower delivery.
- **Single-user with no organization/workspace abstraction**: rejected because every later phase (datasets, investigations, reports) is organization- and workspace-scoped; retrofitting it would be a breaking change.
- **Trusting a client-supplied `organizationId`**: rejected outright — it is an IDOR vector; the tenant must be derived from the session.

## References

- Feature Spec: `specs/001-foundation/spec.md`
- Implementation Plan: `specs/001-foundation/plan.md`
- Data Model: `specs/001-foundation/data-model.md`
- Contracts: `specs/001-foundation/contracts/organizations.md`, `contracts/workspaces.md`
- Related ADRs: ADR-003 (session model)
