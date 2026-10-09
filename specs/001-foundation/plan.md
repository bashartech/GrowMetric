# Implementation Plan: Phase 1 — Foundation

**Branch**: `001-foundation` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-foundation/spec.md`
**Design reference**: repository root `research.md` and `architecture.md`

## Summary

Deliver the foundation slice of GrowMetrics: a Next.js 16 frontend and an Express + TypeScript backend backed by PostgreSQL/Prisma (Neon), implementing single-account registration (user + organization + default workspace in one transaction), secure JWT access-token + opaque refresh-token sessions in httpOnly cookies, organization/workspace settings, subscription-ready entitlements and usage records, audit logging, a background-jobs table/registry (dev inline executor), and the authenticated application shell with honest empty states. Automated tests (unit + integration) are part of the phase gate.

## Technical Context

**Language/Version**: TypeScript 5.x; Node.js 20 LTS (ESM)
**Primary Dependencies**:
- Backend: Express, Prisma, `jose` (JWT), `bcryptjs`, `zod`, `pino`, `cookie-parser`, `cors`, `express-rate-limit`, `helmet`, `uuid`
- Frontend: Next.js `16.3.5` (App Router), React `19.2.8`, Tailwind CSS `v4`, shadcn/ui, Radix primitives, `react-hook-form` + `@hookform/resolvers`, `zod`, `@tanstack/react-query`, `next-themes`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`
**Storage**: PostgreSQL on Neon via Prisma ORM (UUID IDs)
**Testing**: Backend Vitest + Supertest (unit + integration); Frontend Vitest + React Testing Library; Playwright deferred to Phase 5
**Target Platform**: Web (Node.js server + modern browsers)
**Project Type**: Web application — two independent folders (`backend/`, `frontend/`), no npm workspaces
**Performance Goals**: Auth endpoints p95 < 300 ms (local); interactive pages usable < 2 s; no long-running work in request path
**Constraints**: Secrets only via environment variables; session cookies `HttpOnly`/`SameSite=Lax`/`Secure` (prod); tenant isolation enforced server-side; no credentials to frontend/logs; database migrations valid
**Scale/Scope**: Multi-organization SaaS; single user per organization in Phase 1; ~10 backend modules, ~13 frontend routes, 10 Prisma models

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Data-First Architecture | No business metrics/AI in this phase; nothing fabricates data | PASS (N/A) |
| II. Read-Only External DB | No external DB connections in this phase | PASS (N/A) |
| III. Tenant Isolation | `tenant-guard` derives org/workspace from the authenticated user; every query is scoped; cross-tenant tests required | PASS |
| IV. Least Privilege | Cookies unreadable to client JS; client-supplied org/workspace/role IDs never trusted; no secrets to frontend | PASS |
| V. Controlled AI Tools | No AI in this phase | PASS (N/A) |
| VI. Deterministic Calculations | No business calculations in this phase | PASS (N/A) |
| VII. Simulation Transparency | No simulation in this phase | PASS (N/A) |
| VIII. Evidence-Based AI | No AI findings in this phase | PASS (N/A) |
| IX. Data Quality Before Intelligence | No ingestion in this phase | PASS (N/A) |
| X. Async for Expensive Ops | No long-running request work; `jobs` table + registry + dev inline executor laid as foundation | PASS |
| XI. Security by Default | Zod validation on body/query/params; rate limiting; safe error envelope; input normalization | PASS |
| XII. Secrets Management | Env-only config, `.env.example`, `.env` gitignored, pino redaction | PASS |
| XIII. API Boundary | Frontend talks only to the REST API; no direct DB/Prisma access | PASS |
| XIV. Separation of Concerns | `routes → controllers → services → Prisma`; thin controllers | PASS |
| XV. Multi-Tenant Data Model | User → Organization → Workspace (single-account) retained; dashboard/workspace concept preserved | PASS |
| XVI. AI Not System of Record | No AI in this phase | PASS (N/A) |
| XVII. Human Oversight | No automated business actions in this phase | PASS (N/A) |
| XVIII. Auditability | Audit service records registration/sign-in/sign-out/settings; no secrets stored | PASS |
| XIX. Production Quality | Full vertical slices (UI + API + DB + validation + errors + loading + logging + tests) | PASS |
| XX. Testing | Unit + integration tests (auth, tenant isolation, entitlements, lifecycle) in phase gate | PASS |
| XXI. Observability | Request IDs, structured logs, safe errors; job records | PASS |
| XXII. Performance | Indexed tenant/workspace fields; pagination-ready; no full-table loads | PASS |
| XXIII. Maintainability | Typed, modular, small functions; one clear purpose per dependency | PASS |
| XXIV. Specification Before Implementation | Spec + this plan precede implementation | PASS |
| XXV. No Silent Architecture Changes | Single-account simplification is explicit and approved; ADRs to be created with user consent | PASS (ADR pending) |
| XXVI. Definition of Done | Gate: spec satisfied, tests, type-check, lint, migrations, authorization, errors, docs | PASS |

**Gate result**: PASS — no violations require justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 output (Phase 1 decisions)
├── data-model.md        # Phase 1 output (entities + Prisma mapping)
├── quickstart.md        # Phase 1 output (run/verify guide)
├── contracts/           # Phase 1 output (API contracts)
│   ├── auth.md
│   ├── organizations.md
│   ├── workspaces.md
│   ├── entitlements.md
│   ├── audit.md
│   └── errors.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/sp.tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/env.ts
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── logger.ts
│   │   ├── http-errors.ts
│   │   ├── async-handler.ts
│   │   ├── crypto.ts
│   │   ├── tokens.ts
│   │   ├── cookies.ts
│   │   └── slug.ts
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── error-handler.ts
│   │   ├── not-found.ts
│   │   ├── validate.ts
│   │   ├── rate-limit.ts
│   │   ├── auth.ts
│   │   └── tenant-guard.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── organizations/
│   │   ├── workspaces/
│   │   ├── entitlements/
│   │   ├── audit/
│   │   ├── jobs/
│   │   └── health/
│   └── types/express.d.ts
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts

frontend/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (auth)/register/page.tsx
│   ├── onboarding/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── overview/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── ai-analyst/page.tsx
│   │   ├── investigations/page.tsx
│   │   ├── simulator/page.tsx
│   │   ├── recommendations/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── alerts/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── data-hub/{datasets,data-sources,data-quality,imports}/page.tsx
│   │   ├── audit-logs/page.tsx
│   │   ├── settings/page.tsx
│   │   └── billing/page.tsx
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                     # shadcn primitives
│   ├── layout/                 # sidebar, topbar, theme toggle, protected shell
│   ├── signals/                # empty, loading, error, coming-soon
│   └── forms/
├── lib/
│   ├── api-client.ts
│   ├── types.ts
│   ├── schemas.ts
│   ├── query.ts
│   └── utils.ts
├── hooks/
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Structure Decision**: Two-folder web application (`backend/` + `frontend/`), matching the ratified architecture and the user-approved no-workspaces decision. Backend follows the modular layering `routes → controllers → services → Prisma`; frontend uses the Next.js App Router with route groups `(auth)` and `(app)`.

## Phase 0 — Research (summary; full detail in [research.md](./research.md))

Key decisions for Phase 1:

- **Session strategy**: short-lived JWT access token (15 min, HS256 via `jose`) + opaque 256-bit refresh token (30 days) stored SHA-256-hashed, rotated on refresh, revoked on sign-out.
- **Tenancy**: single-account model; `tenant-guard` resolves org/workspace from the user record; registration is one transaction.
- **Entitlements**: default free plan seeded; entitlements read service + usage recording; backend enforcement hook (`requireEntitlement`) scaffolding.
- **Jobs**: `jobs` table is the source of truth; inline dev executor in Phase 1; Redis signal layer deferred to Phase 2+.
- **Contracts**: REST under `/api/v1`, `{ success, data }` / `{ success:false, error:{code,message,details?} }` envelopes; DTOs defined once in contracts and mirrored in the frontend.

## Phase 1 — Design & Contracts

- `data-model.md`: 10 Prisma models (User, Organization, Workspace, AuthSession, Plan, Subscription, UsageRecord, AuditLog, Job, Notification), fields, relations, indexes, validation.
- `contracts/`: auth, organizations, workspaces, entitlements, audit, errors.
- `quickstart.md`: local setup and phase-gate verification steps.

## Complexity Tracking

No Constitution Check violations. Note: the single-account tenancy simplification and the JWT + refresh-cookie session model are architecturally significant and will be documented as ADRs (`ADR-002`, `ADR-003`) once the user consents.

## Phase Gate (Definition of Done for this phase)

1. `backend`: `tsc --noEmit` passes, lint passes, `vitest` unit + integration pass, `prisma migrate` applies cleanly.
2. `frontend`: `tsc --noEmit` passes, lint passes, `vitest` passes, production build succeeds.
3. Manual checkpoint: register → org + default workspace created → onboarding empty state; reload keeps session; sign out blocks protected routes; two accounts cannot see each other's data; settings rename persists; audit entries exist without secrets.
4. PHR recorded; then Phase 2 planning begins only after user verification.
