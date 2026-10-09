---
description: "Task list for Phase 1 — Foundation"
---

# Tasks: Phase 1 — Foundation

**Input**: Design documents from `/specs/001-foundation/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: INCLUDED — FR-030 and the phase gate require unit + integration tests in every phase.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6, mapping to the spec's user stories
- Exact file paths are included in every task

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`, `backend/prisma/`
- Frontend: `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize both applications and tooling.

- [x] T001 Create backend folder structure (`backend/src/{config,lib,middleware,modules,types}`, `backend/tests/{unit,integration}`, `backend/prisma`) per plan.md
- [x] T002 Initialize backend `backend/package.json` (ESM, `"type":"module"`, Node 20) with deps: express, @prisma/client, prisma, jose, bcryptjs, zod, pino, pino-http, cookie-parser, cors, helmet, express-rate-limit, uuid; dev deps: typescript, tsx, vitest, supertest, @types/\*, eslint
- [x] T003 [P] Create `backend/tsconfig.json` (ESM, strict, `outDir: dist`, `moduleResolution: bundler`) and `backend/vitest.config.ts`
- [x] T004 [P] Create `backend/eslint.config.js` and add `lint`, `typecheck`, `test`, `dev`, `build`, `seed` scripts to `backend/package.json`
- [x] T005 [P] Initialize frontend tooling in `frontend/`: confirm Next 16.3.5 + React 19.2.8, add `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `next-themes`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`; add scripts `typecheck`, `test`
- [x] T006 [P] Create `frontend/vitest.config.ts` and `frontend/tests/setup.ts`; create `frontend/.env.example`
- [x] T007 [P] Create `backend/.env.example` with all vars from quickstart.md and ensure `.env`/`.env.local` are gitignored
- [x] T008 [P] Read `frontend/node_modules/next/dist/docs/` for Next 16 App Router specifics before frontend code (per `frontend/AGENTS.md`)

**Checkpoint**: Both apps install and run a hello-world health check.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data model, core server plumbing, and shared frontend infrastructure. Blocks all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database

- [x] T009 Create `backend/prisma/schema.prisma` with all 10 models and 3 enums from data-model.md (User, Organization, Workspace, AuthSession, Plan, Subscription, UsageRecord, AuditLog, Job, Notification)
- [x] T010 Generate and apply the initial migration: `npx prisma migrate dev --name init` and `npx prisma generate`
- [x] T011 Create `backend/prisma/seed.ts` seeding Free/Pro/Business plans idempotently (upsert by `key`)

### Backend core

- [x] T012 [P] Implement `backend/src/config/env.ts` — Zod-validated environment loading (fail fast, redact secrets in errors)
- [x] T013 [P] Implement `backend/src/lib/prisma.ts` (singleton client) and `backend/src/lib/logger.ts` (pino with redaction of `password`, `token`, `authorization`, cookies)
- [x] T014 [P] Implement `backend/src/lib/http-errors.ts` (AppError + codes from contracts/errors.md) and `backend/src/lib/async-handler.ts`
- [x] T015 [P] Implement `backend/src/lib/slug.ts` (slugify + collision suffix) and `backend/src/lib/crypto.ts` (SHA-256 helper, secure random token)
- [x] T016 Implement `backend/src/middleware/request-id.ts`, `error-handler.ts`, and `not-found.ts` producing the error envelope with the request id
- [x] T017 Implement `backend/src/middleware/validate.ts` (Zod body/query/params validation → `VALIDATION_ERROR` with field details)
- [x] T018 Implement `backend/src/app.ts` (helmet, cors with credentials, cookie-parser, JSON limit, request-id, pino-http, routes mount, not-found, error-handler) and `backend/src/server.ts` (listen + graceful shutdown)
- [x] T019 Implement `backend/src/modules/health/health.routes.ts` returning status + version (FR-029)
- [x] T020 [P] Add backend foundation tests: `backend/tests/unit/slug.test.ts`, `backend/tests/unit/crypto.test.ts`, and `backend/tests/integration/health.test.ts`

### Frontend core

- [x] T021 [P] Implement `frontend/lib/utils.ts` (`cn`) and shadcn/ui base primitives (`frontend/components/ui/{button,input,label,card,alert,dropdown-menu,skeleton}.tsx`)
- [x] T022 [P] Implement `frontend/lib/types.ts` mirroring the DTOs in contracts/ (UserDTO, OrganizationDTO, WorkspaceDTO, AuthContextDTO, envelope types)
- [x] T023 Implement `frontend/lib/api-client.ts` — typed fetch wrapper (base URL from `NEXT_PUBLIC_API_URL`, `credentials: 'include'`, envelope decoding, error class, automatic refresh-and-retry on 401 via `POST /auth/refresh`)
- [x] T024 Implement `frontend/app/providers.tsx` (TanStack Query + next-themes) and update `frontend/app/layout.tsx` to wrap the app
- [x] T025 [P] Add frontend foundation tests: `frontend/tests/unit/api-client.test.ts`, `frontend/tests/unit/utils.test.ts`

**Checkpoint**: DB migrates + seeds; backend health returns 200 with envelope; frontend renders with providers.

---

## Phase 3: User Story 1 — Create an Organization Account (Priority: P1) 🎯 MVP

**Goal**: Registration atomically creates user + organization + default workspace, establishes a session, and lands on onboarding.

**Independent Test**: Register a new email/org; confirm account, one default workspace, established session, redirect to onboarding; duplicate email rejected atomically.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T026 [P] [US1] Integration test for registration success + atomicity in `backend/tests/integration/auth-register.test.ts`
- [x] T027 [P] [US1] Integration test for duplicate email and invalid input in `backend/tests/integration/auth-register.test.ts`
- [x] T028 [P] [US1] Component test for the register form validation in `frontend/tests/unit/register-form.test.tsx`

### Implementation for User Story 1

- [x] T029 [P] [US1] Implement `backend/src/lib/tokens.ts` (access JWT sign/verify via `jose`, refresh token generate/hash)
- [x] T030 [P] [US1] Implement `backend/src/lib/cookies.ts` (set/clear `dd_access` + `dd_refresh` with attributes from contracts/auth.md)
- [x] T031 [US1] Implement `backend/src/modules/auth/auth.schema.ts` (Zod schemas for register/login) in `backend/src/modules/auth/`
- [x] T032 [US1] Implement `backend/src/modules/auth/auth.service.ts` — `register()` in a single Prisma transaction: create User (bcrypt hash), Organization, default Workspace, Free Subscription, welcome Notification, `auth.register` AuditLog; then create AuthSession and issue tokens
- [x] T033 [US1] Implement `backend/src/modules/auth/auth.controller.ts` + `auth.routes.ts` for `POST /auth/register` setting cookies and returning the contract data
- [x] T034 [US1] Mount auth routes under `/api/v1` in `backend/src/app.ts`
- [x] T035 [P] [US1] Implement `frontend/lib/schemas.ts` register schema (shared rules with backend)
- [x] T036 [US1] Implement register form `frontend/app/(auth)/register/page.tsx` (RHF + Zod, loading/error states, redirect to `/onboarding`)
- [x] T037 [US1] Implement onboarding page `frontend/app/onboarding/page.tsx` with the "Let's connect your business data" empty state
- [x] T038 [US1] Implement `frontend/hooks/use-auth.ts` + auth context fetch (`GET /auth/me`) and wire registration to refresh context
- [x] T039 [US1] Run and fix US1 tests; verify atomicity (no orphan org/workspace on failure)

**Checkpoint**: US1 fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 — Sign In, Stay Signed In, Sign Out (Priority: P1)

**Goal**: Email/password sign-in, durable session across reloads, transparent refresh, revocation on sign-out, rate limiting.

**Independent Test**: Sign in, reload (still signed in), sign out (protected routes blocked); invalid credentials fail generically; repeated attempts throttled.

### Tests for User Story 2 ⚠️

- [x] T040 [P] [US2] Integration test for login/refresh/logout lifecycle in `backend/tests/integration/auth-session.test.ts`
- [x] T041 [P] [US2] Unit test for token expiry/rotation and revocation in `backend/tests/unit/tokens.test.ts`
- [x] T042 [P] [US2] Integration test for rate limiting in `backend/tests/integration/auth-ratelimit.test.ts`

### Implementation for User Story 2

- [x] T043 [US2] Implement `backend/src/modules/auth/auth.service.ts` — `login()` (normalize email, constant-time compare, generic failure, set `lastLoginAt`, `auth.login` audit)
- [x] T044 [US2] Implement `backend/src/modules/auth/auth.service.ts` — `refresh()` (validate hashed refresh token, rotate + revoke previous, deny revoked/expired) and `logout()` (revoke session, clear cookies, `auth.logout` audit)
- [x] T045 [US2] Add `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` controller routes in `backend/src/modules/auth/`
- [x] T046 [US2] Implement `backend/src/middleware/auth.ts` (`requireAuth`: verify access token, attach `req.user`) and `backend/src/types/express.d.ts` augmentation
- [x] T047 [US2] Implement `backend/src/middleware/rate-limit.ts` and apply to auth routes (10/15 min/IP)
- [x] T048 [US2] Implement `frontend/app/(auth)/login/page.tsx` (RHF + Zod, safe error display, redirect to `/overview`)
- [x] T049 [US2] Implement a protected-route guard in `frontend/app/(app)/layout.tsx` (redirect to `/login` when unauthenticated; preserve intended path where feasible)
- [x] T050 [US2] Implement sign-out action in the app shell calling `POST /auth/logout` and clearing client cache
- [x] T051 [P] [US2] Component test for login form error handling in `frontend/tests/unit/login-form.test.tsx`
- [x] T052 [US2] Run and fix US2 tests

**Checkpoint**: US1 + US2 both work independently; sessions are durable and revocable.

---

## Phase 5: User Story 3 — Review & Update Organization/Workspace (Priority: P2)

**Goal**: View and rename organization and workspace; persistence and app-wide reflection.

**Independent Test**: Sign in, rename org + workspace, save, reload; names persist and display in the shell.

### Tests for User Story 3 ⚠️

- [x] T053 [P] [US3] Integration test for org/workspace update + validation in `backend/tests/integration/org-workspace.test.ts`
- [x] T054 [P] [US3] Integration test for tenant isolation on workspace update in `backend/tests/integration/tenant-isolation.test.ts`

### Implementation for User Story 3

- [x] T055 [US3] Implement `backend/src/modules/organizations/organization.service.ts` + `.controller.ts` + `.routes.ts` for `GET/PATCH /organizations/current` (rename writes `org.update` audit)
- [x] T056 [US3] Implement `backend/src/modules/workspaces/workspace.service.ts` + `.controller.ts` + `.routes.ts` for `GET /workspaces`, `GET /workspaces/current`, `PATCH /workspaces/:id` (scoped lookup; 404 on foreign id; `workspace.update` audit)
- [x] T057 [US3] Implement `backend/src/middleware/tenant-guard.ts` resolving org/workspace from the authenticated user and expose it via request context (FR-012/FR-013)
- [x] T058 [US3] Implement `frontend/app/(app)/settings/page.tsx` with organization and workspace rename forms using RHF + Zod and optimistic/refresh feedback
- [x] T059 [US3] Reflect organization/workspace names in the shell/sidebar from auth context
- [x] T060 [US3] Run and fix US3 tests

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 — Navigate the Authenticated Application Shell (Priority: P2)

**Goal**: Professional shell with full navigation, honest empty states, theme persistence, and auth redirects.

**Independent Test**: Sign in; click every nav area; each shows an honest empty/coming-soon state; theme persists; signed-out direct URL redirects to login.

### Tests for User Story 4 ⚠️

- [x] T061 [P] [US4] Component test for sidebar navigation + active state in `frontend/tests/unit/app-shell.test.tsx`
- [x] T062 [P] [US4] Component test for empty/coming-soon states in `frontend/tests/unit/empty-states.test.tsx`

### Implementation for User Story 4

- [x] T063 [P] [US4] Implement `frontend/components/layout/sidebar.tsx` listing all planned areas with active indication and responsive collapse
- [x] T064 [P] [US4] Implement `frontend/components/layout/topbar.tsx` (org/workspace switcher display, user menu, sign-out)
- [x] T065 [P] [US4] Implement `frontend/components/layout/theme-toggle.tsx` (next-themes, persisted)
- [x] T066 [US4] Implement `frontend/components/signals/{empty-state,coming-soon,loading,error-state}.tsx` reusable honest-state components
- [x] T067 [US4] Implement remaining `(app)` pages as honest coming-soon states: `overview`, `dashboard`, `ai-analyst`, `investigations`, `simulator`, `recommendations`, `reports`, `alerts`, `notifications`, `data-hub/{datasets,data-sources,data-quality,imports}`, `billing`
- [x] T068 [US4] Wire the `(app)/layout.tsx` shell (sidebar + topbar + content) and confirm no fabricated data renders anywhere
- [x] T069 [US4] Run and fix US4 tests

**Checkpoint**: US1–US4 independently functional; product skeleton complete.

---

## Phase 7: User Story 5 — Subscription-Ready Access Control (Priority: P3)

**Goal**: Default plan provisioning, entitlements read, usage recording, and server-side enforcement scaffolding.

**Independent Test**: New account has Free subscription; entitlements/usage read for current user; over-limit request denied server-side.

### Tests for User Story 5 ⚠️

- [x] T070 [P] [US5] Integration test for entitlements read + usage record/fetch in `backend/tests/integration/entitlements.test.ts`
- [x] T071 [P] [US5] Unit test for limit evaluation in `backend/tests/unit/entitlements.test.ts`

### Implementation for User Story 5

- [x] T072 [US5] Implement `backend/src/modules/entitlements/entitlement.service.ts` — read plan/features for org, evaluate limits, upsert-increment usage for the current period
- [x] T073 [US5] Implement `backend/src/modules/entitlements/entitlement.controller.ts` + `.routes.ts` for `GET /entitlements`, `GET /usage`, `POST /usage`
- [x] T074 [US5] Implement `requireEntitlement(key)` middleware in `backend/src/modules/entitlements/entitlement.middleware.ts` denying with `ENTITLEMENT_REQUIRED` (FR-020)
- [x] T075 [P] [US5] Implement `frontend/hooks/use-entitlements.ts` and a minimal billing page placeholder that reflects the current plan (no checkout)
- [x] T076 [US5] Run and fix US5 tests

**Checkpoint**: US1–US5 independently functional; premium gating ready for later phases.

---

## Phase 8: User Story 6 — Audit Important Account Actions (Priority: P3)

**Goal**: Append-only audit trail for account/security actions, secret-free, reviewable.

**Independent Test**: Register/sign-in/sign-out/settings updates each produce exactly one timestamped entry with no secrets; audit page lists org entries newest-first.

### Tests for User Story 6 ⚠️

- [x] T077 [P] [US6] Integration test asserting audit entries for each action and no secrets in `backend/tests/integration/audit.test.ts`
- [x] T078 [P] [US6] Integration test for audit pagination + isolation in `backend/tests/integration/audit.test.ts`

### Implementation for User Story 6

- [x] T079 [US6] Implement `backend/src/modules/audit/audit.service.ts` — `record()` with metadata sanitization (strip secrets) and helper for actor/context
- [x] T080 [US6] Retrofit all existing services (auth register/login/logout, org update, workspace update) to call `audit.service.record()` instead of inline writes
- [x] T081 [US6] Implement `backend/src/modules/audit/audit.controller.ts` + `.routes.ts` for `GET /audit-logs` (reverse-chronological, paginated, org-scoped)
- [x] T082 [US6] Implement `frontend/app/(app)/audit-logs/page.tsx` listing entries with loading/empty/error states
- [x] T083 [US6] Run and fix US6 tests

**Checkpoint**: All six user stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Harden, document, and pass the phase gate.

- [X] T084 [P] Create `docs/architecture/` ADR-002 (single-account tenancy) and ADR-003 (JWT + refresh-cookie sessions) with user consent (Constitution XXV)
- [X] T085 [P] Run a security review against `.opencode/skills/code-quality/references/security-checklist.md`; fix findings (secrets, cookies, validation, tenant isolation)
- [X] T086 [P] Add structured logging on all service entry/exit boundaries and verify pino redaction with a test in `backend/tests/unit/logger.test.ts`
- [X] T087 Verify quickstart.md end-to-end manually and record results
- [X] T088 Run the full phase gate: backend `typecheck` + `lint` + `test`; frontend `typecheck` + `lint` + `test` + `build`; record output
- [X] T089 Fix any gate failures and re-run until green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–8)**: Depend on Foundational. US1 must precede US2 (session model reused); US3 reuses auth/tenant plumbing; US4 can run parallel to US3; US5/US6 depend on US1+US2.
- **Polish (Phase 9)**: Depends on all targeted stories.

### User Story Dependencies

- **US1 (P1)**: No story dependencies — MVP.
- **US2 (P1)**: Depends on US1 session plumbing (`tokens.ts`, `cookies.ts`, AuthSession).
- **US3 (P2)**: Depends on US2 (`requireAuth`) and US1 entities.
- **US4 (P2)**: Depends on US2 (`(app)` guard); otherwise independent.
- **US5 (P3)**: Depends on US1 (subscription provisioning).
- **US6 (P3)**: Depends on US1/US2/US3 (records their actions).

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Models/schemas → services → controller/routes → frontend → integration.

### Parallel Opportunities

- Setup: T003, T004, T005, T006, T007, T008.
- Foundational: T012–T015, T020, T021, T022, T025.
- US1: T026–T028, T029, T030, T035.
- US2: T040–T042, T051.
- US3: T053, T054.
- US4: T061, T062, T063, T064, T065.
- US5: T070, T071, T075.
- US6: T077, T078.
- Polish: T084, T085, T086.

---

## Parallel Example: Foundational Phase

```bash
Task: "Implement backend/src/config/env.ts"
Task: "Implement backend/src/lib/prisma.ts + logger.ts"
Task: "Implement backend/src/lib/http-errors.ts + async-handler.ts"
Task: "Implement backend/src/lib/slug.ts + crypto.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Integration test registration success/atomicity in backend/tests/integration/auth-register.test.ts"
Task: "Integration test duplicate email/invalid input in backend/tests/integration/auth-register.test.ts"
Task: "Implement backend/src/lib/tokens.ts"
Task: "Implement backend/src/lib/cookies.ts"
Task: "Implement frontend/lib/schemas.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1) and STOP to validate registration → onboarding independently.
3. Then proceed US2 → US3/US4 → US5/US6.

### Incremental Delivery

Each story is a testable increment; the phase gate (T088) must pass before Phase 2 (Data Layer) begins.

---

## Notes

- [P] tasks touch different files with no incomplete dependencies.
- Story labels provide traceability to spec.md.
- No fake data in any UI state (FR-024).
- Commit after each task or logical group; never commit secrets.
- Total tasks: **89** (Setup 8, Foundational 17, US1 14, US2 13, US3 8, US4 9, US5 7, US6 7, Polish 6).
