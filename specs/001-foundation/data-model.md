# Data Model: Phase 1 — Foundation

**Feature**: `001-foundation`
**Date**: 2026-09-18
**Source**: [`spec.md`](./spec.md) Key Entities, [`plan.md`](./plan.md), root `research.md` (target schema)
**Database**: PostgreSQL (Neon) via Prisma ORM. All IDs are UUIDs. All timestamps are `timestamptz` (Prisma `DateTime`).

## Entity Overview

```text
Organization 1───* Workspace
Organization 1───* User
Organization 1───1 Subscription *───1 Plan
Organization 1───* UsageRecord
Organization 1───* AuditLog
Organization 1───* Job
User         1───* AuthSession
User         1───* Notification
Workspace    1───* AuditLog
```

Single-account model: one `User` belongs to exactly one `Organization` (unique `organizationId` per user is not enforced globally — the relationship is one-to-many now; the reserved `role` column is unused for permissions in this phase).

---

## 1. User

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `name` | String | required, 1–100 chars | |
| `email` | String | required, unique, normalized (trim + lowercase) | FR-003 |
| `passwordHash` | String | required | bcrypt cost 12; never returned (FR-004) |
| `role` | `Role` enum | default `OWNER` | Reserved; not used for permissions this phase (FR-015) |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `lastLoginAt` | DateTime? | nullable | set on sign-in |
| `createdAt` | DateTime | default now | |
| `updatedAt` | DateTime | `@updatedAt` | |

- **Relations**: `organization`, `sessions`, `notifications`.
- **Validation**: email format (Zod); password min 8 chars with at least one letter and one number; name trimmed non-empty.
- **Privacy**: `passwordHash` must never be serialized; the user DTO exposes `id`, `name`, `email`, `role`, `organizationId`, `lastLoginAt`, `createdAt`.

## 2. Organization

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `name` | String | required, 1–100 chars | FR-017 |
| `slug` | String | required, unique, indexed | generated from name, collision-suffixed |
| `createdAt` | DateTime | default now | |
| `updatedAt` | DateTime | `@updatedAt` | |

- **Relations**: `users`, `workspaces`, `subscription`, `usageRecords`, `auditLogs`, `jobs`.

## 3. Workspace

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `name` | String | required, 1–100 chars | defaults to organization name |
| `slug` | String | required | unique per organization (`@@unique([organizationId, slug])`) |
| `isDefault` | Boolean | default `false` | exactly one default per org |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `createdAt` | DateTime | default now | |
| `updatedAt` | DateTime | `@updatedAt` | |

- **Relations**: `organization`, `auditLogs`.
- **Invariant**: registration creates exactly one workspace with `isDefault = true` (FR-002).

## 4. AuthSession

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `userId` | UUID | FK → User, required, indexed | |
| `refreshTokenHash` | String | required, unique, indexed | SHA-256 of opaque token (FR-007) |
| `userAgent` | String? | nullable | device context |
| `ipAddress` | String? | nullable | network context |
| `expiresAt` | DateTime | required, indexed | 30 days |
| `revokedAt` | DateTime? | nullable | set on sign-out/rotation |
| `createdAt` | DateTime | default now | |

- **Relations**: `user`.
- **State transitions**: `active` → `rotated` (old row `revokedAt` set, new row created) → `revoked` (sign-out). Deny refresh when `revokedAt IS NOT NULL` or `expiresAt <= now` (FR-008, FR-009).
- **Security**: raw token never stored; only its hash (FR-010).

## 5. Plan

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `key` | String | required, unique | `free`, `pro`, `business` |
| `name` | String | required | display name |
| `featureLimits` | Json | required | e.g. `{ aiInvestigations: 5, simulations: false }` |
| `priceMonthly` | Int | default 0 | cents |
| `createdAt` | DateTime | default now | |

- **Relations**: `subscriptions`.
- **Seeded**: Free, Pro, Business (FR-018).

## 6. Subscription

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, unique | one active subscription per org |
| `planId` | UUID | FK → Plan, required, indexed | |
| `status` | `SubscriptionStatus` enum | default `ACTIVE` | `ACTIVE`, `PAST_DUE`, `CANCELED` |
| `currentPeriodStart` | DateTime | required | |
| `currentPeriodEnd` | DateTime | required, indexed | |
| `cancelAtPeriodEnd` | Boolean | default `false` | |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `organization`, `plan`.
- **Invariant**: created with status `ACTIVE` on the Free plan at registration (FR-018).

## 7. UsageRecord

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `metric` | String | required | e.g. `ai_investigations` |
| `periodStart` | DateTime | required | |
| `periodEnd` | DateTime | required | |
| `amount` | Int | default 0 | cumulative for the period |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `organization`.
- **Unique**: `@@unique([organizationId, metric, periodStart])` (FR-019).
- **Increment**: upsert-increment; reads return the current period's amount.

## 8. AuditLog

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID? | FK → Workspace, nullable, indexed | when applicable |
| `actorUserId` | UUID? | FK → User, nullable | null for system actions |
| `action` | String | required, indexed | e.g. `auth.register`, `org.update` |
| `resourceType` | String | required | e.g. `organization`, `workspace` |
| `resourceId` | String? | nullable | |
| `metadata` | Json? | nullable | sanitized; no secrets (FR-022) |
| `ipAddress` | String? | nullable | |
| `userAgent` | String? | nullable | |
| `createdAt` | DateTime | default now, indexed | |

- **Relations**: `organization`, `workspace`, `actor`.
- **Immutability**: append-only; no update/delete paths (FR-021).
- **Required actions**: `auth.register`, `auth.login`, `auth.logout`, `org.update`, `workspace.update`.

## 9. Job

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID? | FK → Organization, nullable, indexed | org-scoped when available |
| `type` | String | required, indexed | handler key in `job.registry` |
| `payload` | Json | required | job input |
| `status` | `JobStatus` enum | default `PENDING` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` |
| `attempts` | Int | default 0 | |
| `maxAttempts` | Int | default 3 | |
| `runAt` | DateTime | default now, indexed | |
| `startedAt` / `completedAt` | DateTime? | nullable | |
| `lastError` | String? | nullable | sanitized |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `organization`.
- **Phase 1**: table + registry + dev inline executor; `jobs` is the system of record (Principle X).

## 10. Notification

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `userId` | UUID | FK → User, required, indexed | |
| `type` | String | required | e.g. `system.welcome` |
| `title` | String | required | |
| `body` | String | required | |
| `readAt` | DateTime? | nullable | |
| `createdAt` | DateTime | default now, indexed | |

- **Relations**: `user`.
- **Phase 1**: model + creation on registration (welcome notification); read UI deferred.

---

## Enums

```prisma
enum Role               { OWNER ADMIN MEMBER }
enum SubscriptionStatus { ACTIVE PAST_DUE CANCELED }
enum JobStatus          { PENDING RUNNING COMPLETED FAILED }
```

## Indexes Summary

- `User.email` (unique), `User.organizationId`
- `Organization.slug` (unique)
- `Workspace.organizationId`, `Workspace @@unique([organizationId, slug])`
- `AuthSession.refreshTokenHash` (unique), `AuthSession.userId`, `AuthSession.expiresAt`
- `Subscription.organizationId` (unique), `Subscription.planId`, `Subscription.currentPeriodEnd`
- `UsageRecord @@unique([organizationId, metric, periodStart])`
- `AuditLog.organizationId`, `AuditLog.createdAt`, `AuditLog.action`
- `Job.status`, `Job.runAt`, `Job.type`
- `Notification.userId`, `Notification.createdAt`

## Seed Data

- **Plans**: Free (`featureLimits` minimal), Pro, Business.
- **Idempotent**: safe to re-run (`upsert` by `key`).

## Migration Notes

- Single initial migration `init` for all 10 models + enums.
- Enum values are additive-safe for later phases.
