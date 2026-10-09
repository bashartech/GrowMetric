# GrowMetrics — Deep Design Research

**Status**: Draft (pending user verification)
**Date**: 2026-09-18
**Source of truth**: `architecture.md` (§60 first development milestone) + `.specify/memory/constitution.md` (v1.0.0)
**Scope**: Design documents only — no implementation decisions locked at code level beyond the design below. Produces the 14 design documents required by architecture.md §60.

---

## 1. System Architecture

```text
                          Next.js Frontend (frontend/)
                                |
                                | HTTPS / REST JSON
                                v
                          Express API (backend/)
                                |
          +--------------------+--------------------+
          |                    |                    |
          v                    v                    v
     PostgreSQL            Redis/Upstash        Cloudflare R2
       Prisma              (queues, signal)    (raw uploads)
          |
          v
   Business Data Layer
          |
          +-------------------+
          |                   |
          v                   v
    Analytics Engine     AI Agent Layer
                            |
                +-----------+-----------+
                |           |           |
                v           v           v
           Data Agent  Investigation  Simulation
```

Key structural decisions:

- **Two independent folders** (`frontend/`, `backend/`), no npm workspaces. Each has its own `package.json`, `tsconfig.json`, `.env.example`. DTO types are defined in the backend and mirrored by hand in the frontend (single documented source: `specs/foundation/contracts/`).
- **Express exposes a clean REST API.** No business logic lives inside Next.js API routes.
- **PostgreSQL is the single application database** (multi-tenant app data + business data layer). R2 stores only original uploaded files and generated artifacts.
- **Redis/Upstash is a signaling layer over an authoritative `jobs` table** (see §9). PostgreSQL remains the system of record for job state; Redis provides fast queue semantics and worker wake-up.
- **AI provider is abstracted.** The OpenAI Agents SDK with Groq as default provider sits behind a thin provider interface so another provider can be introduced later (architecture.md §3, Principle XXV constraint).
- **Deterministic backend logic owns all business calculations**; the LLM performs reasoning and explanation over data retrieved through approved tools (Principle I, VI).

Runtime architecture (background):

```text
Scheduler (node-cron / worker timer)
    |
    v
Redis Queue (signal)
    |
    +--> Data Processing Worker   (imports, normalize)
    +--> Anomaly Detection Worker (baseline + threshold)
    +--> Report Worker            (weekly/scheduled reports)
    +--> Email Worker             (nodemailer delivery)
```

---

## 2. Database ERD

Tenant spine (single-account model):

```text
User (1) ==== (1) Organization (1) -----< Workspace
       (implicit owner)                        |
                                               +-- DataSource ---- (read-only external DB / upload)
                                               +-- Dataset ------ DatasetColumn -- DatasetRow -- values
                                               +-- Dashboard --- DashboardWidget
                                               +-- Conversation / Investigation / Simulation
                                               +-- Recommendation / Alert / Report / ...
```

Each Organization registers one account; a single user implicitly owns it and
a default workspace. No memberships or invitations in the initial version. A
`role` column (default `OWNER`) is reserved on the user record so multi-user
roles can be added later without a schema redesign.

Data domain detail (relational split — user decision):

```text
Dataset (1) ---< DatasetVersion (1) ---< DatasetColumn (n columns)
DatasetVersion (1) ---< DatasetRow (n rows)
DatasetRow (1) ---< DatasetTextValue      (value TEXT)
DatasetRow (1) ---< DatasetNumericValue   (value NUMERIC)
DatasetRow (1) ---< DatasetDatetimeValue  (value TIMESTAMPTZ)
DatasetRow (1) ---< DatasetBooleanValue   (value BOOLEAN)
DatasetColumn (1) ---< (composite PK) (row_id, column_id) on each value table
Dataset ---< DatasetRelationship (between columns, validated)
Dataset ---< DataQualityReport (per dataset or per version)
```

**Why relational split was chosen over JSONB wide-table and columnar:**

| Approach | Verdict | Reasoning |
| --- | --- | --- |
| Relational split (this design) | **Chosen** | DB-enforced types; aggregation on tightly-scoped value tables (column pruned via `(column_id) PRIMARY KEY` index); no JSON normalization drift; matches Principle XXII (only load what is needed); Postgres/Prisma native. |
| JSONB wide table | Rejected | Flexible but untyped; slower aggregation; avoids Prisma native JSON pitfalls only at the cost of validation and index discipline; risk of schema drift across imports. |
| Columnar store (DuckDB/ClickHouse) | Rejected | Diverges from the mandated PostgreSQL stack (Principle XXV would require explicit approval); overkill for initial scale. |

Tradeoffs accepted for relational split: more normalized plumbing in ingestion/normalizer, joins needed when reconstructing full rows (mitigated by column pruning and raw SQL for analytics), higher absolute row count in value tables (mitigated by index discipline).

---

## 3. Prisma Schema Proposal

Full schema is scoped across phases. This is the complete target; Phase 1 implements only the identity/tenancy/infra slice. All models use `@id @default(uuid())` (or a natural constrained key where noted). Every tenant-scoped model carries `@@index([organizationId, workspaceId, ...])` as appropriate.

### Phase 1 — Identity, Tenancy, Auth, Infra (10 models)

```text
User              id, email (unique), name, passwordHash, organizationId (unique),
                  role (default OWNER, reserved for future multi-user), lastLoginAt,
                  createdAt, updatedAt
Organization      id, name, slug (unique), createdAt, updatedAt
Workspace         id, organizationId, name, slug, createdAt, updatedAt
AuthSession       id, userId, refreshTokenHash (unique), userAgent, ip,
                  expiresAt, revokedAt, createdAt, @@index([userId])
Plan              id, key (unique), name, description, monthlyPriceCents,
                  featureLimits Json, createdAt, updatedAt
Subscription      id, organizationId, planId, status (FREE|ACTIVE|CANCELED|PAST_DUE),
                  startsAt, endsAt, canceledAt, createdAt, updatedAt, @@index([organizationId])
UsageRecord       id, organizationId, key (e.g. "datasets", "ai.queries"), amount, periodStart,
                  periodEnd, createdAt, @@unique([organizationId, key, periodStart])
AuditLog          id, organizationId, workspaceId?, userId?, action, resourceType,
                  resourceId?, metadata Json, ip, createdAt, @@index([organizationId, createdAt])
Job               id, workspaceId?, organizationId, type, status (QUEUED|RUNNING|COMPLETED|FAILED|CANCELED),
                  payload Json, attempts, maxAttempts, error, scheduledAt, startedAt,
                  completedAt, createdAt, @@index([status, scheduledAt]), @@index([organizationId])
Notification      id, organizationId, workspaceId?, userId?, type, title, body,
                  severity (INFO|WARNING|CRITICAL), readAt?, dismissedAt?, metadata Json,
                  createdAt, @@index([userId, readAt]), @@index([organizationId])
```

### Phase 2 — Data Layer (18 models)

```text
DataSource             id, organizationId, workspaceId, name, kind (EXCEL|CSV|POSTGRES|MYSQL),
                       status (NEW|CONNECTED|VALIDATED|FAILED|DISABLED), tablesSyncedAt,
                       createdBy, createdAt, updatedAt, @@index([organizationId, workspaceId])
DataSourceCredential   id, dataSourceId, engine, host?, port?, database?, username?,
                       passwordEnc (AES-256-GCM), sslMode, createdAt, updatedAt
                       @@unique([dataSourceId])   // one credential holder per source; never exposed
DataSourceTable        id, dataSourceId, schemaName, tableName, columnCount, rowEstimate,
                       isSelected, profile Json, createdAt, updatedAt
                       @@unique([dataSourceId, schemaName, tableName])
ImportJob              id, jobId (→ Job), dataSourceId, datasetId?, fileId?, status,
                       source, filename, totalRows?, processedRows?, error?, startedAt,
                       completedAt, createdAt, @@index([dataSourceId])
ImportFile             id, dataSourceId, originalName, r2Key, mimeType, sizeBytes, checksum,
                       createdAt, @@index([dataSourceId])
Dataset                id, organizationId, workspaceId, dataSourceId, name, sourceTable?,
                       kind (SALES|CUSTOMERS|PRODUCTS|INVENTORY|EXPENSES|ORDERS|CUSTOM),
                       status (DRAFT|READY|READY_WITH_WARNINGS|ERROR), currentVersionId?,
                       rowCount, createdAt, updatedAt, @@index([organizationId, workspaceId])
DatasetVersion         id, datasetId, version (int, per-dataset sequence), importJobId?,
                       commit (APPEND|REPLACE|UPSERT), source, status, summary Json,
                       createdAt, @@unique([datasetId, version])
DatasetColumn          id, datasetVersionId, datasetId, name, type (TEXT|INTEGER|LOCALIZED? |
                       DECIMAL|BOOLEAN|TIMESTAMP|DATE|TIME), ordinalPosition, isNullable,
                       semanticKey?, businessMeaning?, representativeSample Json,
                       createdAt, @@index([datasetId, ordinalPosition])
DatasetRow             id, datasetVersionId, datasetId, rowIndex, createdAt
                       @@unique([datasetVersionId, rowIndex]), @@index([datasetId])
DatasetTextValue       rowId → DatasetRow, columnId → DatasetColumn, value TEXT
                       @@id([rowId, columnId]), @@index([columnId])
DatasetNumericValue    rowId, columnId, value NUMERIC (Decimal), @@id([rowId, columnId]), @@index([columnId])
DatasetDatetimeValue   rowId, columnId, value TIMESTAMPTZ, @@id([rowId, columnId]), @@index([columnId])
DatasetBooleanValue    rowId, columnId, value BOOLEAN, @@id([rowId, columnId]), @@index([columnId])
DatasetRelationship    id, datasetId, sourceColumnId, targetDatasetId?, targetColumnId?,
                       relationshipType (MANY_TO_ONE|ONE_TO_ONE), detectedBy (RULES|AI|USER),
                       confidence, isConfirmed, createdAt, @@index([datasetId])
DataQualityReport      id, datasetVersionId, datasetId, totalRows, missingValuesPct, duplicateRowsPct,
                       invalidDatePct, invalidNumberPct, numericOutlierCount, status,
                       detail Json, createdAt, @@unique([datasetVersionId])
BusinessMetric         id, organizationId, workspaceId, datasetId?, name, kind (REVENUE|ORDERS|
                       CUSTOMERS|EXPENSES|PROFIT|INVENTORY|CUSTOM), definition Json, createdAt,
                       updatedAt, @@index([organizationId, workspaceId])
Dashboard              id, organizationId, workspaceId, name, layout Json, createdAt, updatedAt,
                       @@index([organizationId, workspaceId])
DashboardWidget        id, dashboardId, type (KPI|CHART|TABLE), metricId?, datasetId?, config Json,
                       position Json, createdAt, updatedAt, @@index([dashboardId])
```

### Phase 3 — AI (9 models)

```text
Conversation           id, organizationId, workspaceId, userId, title, status, createdAt, updatedAt
                       @@index([organizationId, workspaceId, userId])
Message                id, conversationId, role (USER|ASSISTANT|TOOL), kind (CHAT|FINDING|
                       CHART|ERROR), content Text, toolCallId?, agentRunId?, metadata Json,
                       createdAt, @@index([conversationId, createdAt])
AgentRun               id, conversationId, agent (ANALYST|INVESTIGATION|SIMULATION|RECOMMENDATION),
                       model, startTime, endTime, latencyMs, status, tokensUsed Json, toolsUsed Json,
                       error?, createdAt, @@index([conversationId]), @@index([status])
ToolCallRecord         id, agentRunId, toolName, input Json, output Json, status, latencyMs,
                       error?, createdAt, @@index([agentRunId])
Investigation          id, organizationId, workspaceId, userId, topic, question, status,
                       createdAt, updatedAt, @@index([organizationId, workspaceId])
InvestigationFinding   id, investigationId, level (MAIN|SUPPORTING|CORRELATION), kind,
                       summary, evidence Json, metricChange?, createdAt, @@index([investigationId])
Simulation             id, organizationId, workspaceId, userId, type (PRICE_CHANGE|MARKETING_SPEND|
                       EXPENSE_REDUCTION|INVENTORY_CHANGE|CUSTOM), name, status, createdAt, updatedAt
                       @@index([organizationId, workspaceId])
SimulationScenario     id, simulationId, inputs Json, model Json, assumptions Json, status,
                       createdAt, @@index([simulationId])
SimulationResult       id, scenarioId, metric (REVENUE|ORDERS|PROFIT|...), currentValue,
                       projectedValue, changePct, confidence, isEstimate, createdAt
                       @@index([scenarioId])
```

### Phase 4 — Automation (7 models)

```text
Recommendation         id, organizationId, workspaceId, title, severity (LOW|MEDIUM|HIGH|
                       CRITICAL), category, description, evidence Json, source (ANOMALY|
                       INVESTIGATION|RULE|SIMULATION|SYSTEM), datasetId?, suggestedAction?,
                       status (OPEN|ACKNOWLEDGED|RESOLVED|DISMISSED), createdAt, updatedAt
                       @@index([organizationId, workspaceId, status])
AnomalyDetection       id, organizationId, workspaceId, datasetId?, metricId?, kind, period,
                       baseline Json, observed Json, deviationPct, status, createdAt
                       @@index([organizationId, workspaceId, createdAt])
AlertRule              id, organizationId, workspaceId, name, metricKind, condition, threshold,
                       frequency, recipients Json, enabled, lastTriggeredAt, createdBy,
                       createdAt, updatedAt, @@index([organizationId, workspaceId])
Alert                  id, organizationId, workspaceId, ruleId?, title, severity, message,
                       evidence Json, status (OPEN|ACKNOWLEDGED|RESOLVED), createdAt
                       @@index([organizationId, workspaceId, createdAt])
Report                 id, organizationId, workspaceId, kind (WEEKLY|MONTHLY|CUSTOM), title,
                       content Json, status (DRAFT|GENERATED|FAILED), generatedBy, createdAt,
                       updatedAt, @@index([organizationId, workspaceId])
ReportSchedule         id, organizationId, workspaceId, reportId, frequency, cron, timezone,
                       recipients Json, enabled, nextRunAt, createdAt, updatedAt
                       @@index([organizationId, workspaceId])
EmailDelivery          id, jobId?, status (QUEUED|SENT|FAILED|BOUNCED), from, to Json,
                       subject, template, error?, sentAt, createdAt, @@index([status])
```

Total target schema: **44 models** across the five phases. Phase 1 implements the identity/tenancy/infra slice (10 models) + supporting enums.

Notes:

- All public resource IDs are UUIDs (Principle XXIII + architecture §37).
- Every model has `createdAt` and (`updatedAt` where mutable).
- **Secrets never live in audit logs, API responses, prompts, or logs** (Principle II, XII, XVIII).
- `DatasetColumn.type` uses a bounded enum; ingestion normalizes loose column types into these before writing values.

---

## 4. Backend Folder Structure

```text
backend/
  prisma/
    schema.prisma
    migrations/
    seed.ts
  src/
    app.ts                     # express app assembly (routes, middleware, health)
    server.ts                  # bootstrap / listen
    config/
      env.ts                   # zod-validated env loader (fail-fast)
    lib/
      prisma.ts                # PrismaClient singleton
      logger.ts                # pino, redact secrets
      http-errors.ts           # typed AppError + error envelope helpers
      async-handler.ts         # error-boundary wrapper for controllers
      crypto.ts                # bcrypt, AES-256-GCM credential encrypt/decrypt
      tokens.ts                # jose JWT sign/verify, random token gen, sha256
      cookies.ts               # cookie set/clear helpers (flags)
      ids.ts                   # slug + id helpers
    middleware/
      request-id.ts            # req.id correlation + pino bindings
      error-handler.ts         # final handler, logs detail, returns safe envelope
      not-found.ts
      validate.ts              # zod body/query/params validator
      rate-limit.ts            # per-IP + per-auth-route limits
      auth.ts                  # requireAuth: verifies access token (Bearer) or cookie
      tenant-guard.ts          # resolve org/workspace from the authenticated user's own record
      entitlement.ts           # subscription entitlement + usage checks (Phase 1 scaffold)
    modules/
      auth/        auth.routes, auth.controller, auth.service, auth.schemas
      organizations/ organizations.routes, .controller, .service, .schemas
      workspaces/  workspaces.routes, .controller, .service, .schemas
      audit/       audit.service (recordAudit, list)
      jobs/        job.service, job.registry, queue.client
      health/      health.routes
    types/
      express.d.ts             # res.locals.{user, organization, workspace}
    utils/
  tests/
    unit/
    integration/
  .env.example
  package.json
  tsconfig.json
  eslint.config.mjs
  vitest.config.ts
```

Layering is strictly `routes → controllers → services → Prisma`. Controllers stay thin; domain logic lives in services (architecture §36, opencode §18). Workers live in `src/workers/` added in Phase 2+.

---

## 5. Frontend Folder Structure

```text
frontend/
  app/
    (auth)/
      login/page.tsx
      register/page.tsx
    onboarding/page.tsx
    (app)/                       # authenticated layout: sidebar + topbar + theme toggle
      layout.tsx
      overview/page.tsx
      dashboard/page.tsx
      ai-analyst/page.tsx
      investigations/page.tsx
      simulator/page.tsx
      recommendations/page.tsx
      reports/page.tsx
      alerts/page.tsx
      notifications/page.tsx
      data-hub/
        datasets/page.tsx
        data-sources/page.tsx
        data-quality/page.tsx
        imports/page.tsx
      audit-logs/page.tsx
      settings/page.tsx
      billing/page.tsx
    layout.tsx
    page.tsx                     # marketing/redirect splash (or redirect to /overview)
    globals.css
  components/
    ui/                          # shadcn primitives (button, input, card, dialog, ...)
    layout/                      # sidebar, topbar, theme-provider, protected-shell
    signals/                     # loading, empty-state, error-state, skeleton primitives
    forms/                       # shared form field wrappers (RHF + zod)
    charts/                      # recharts wrappers (responsive, typed)
  lib/
    api-client.ts                # fetch wrapper: base URL, credentials, error envelope
    auth.ts                      # access/refresh cookie-aware calls, /auth/me
    query.ts                     # TanStack Query client + hooks
    types.ts                     # DTOs mirrored from backend contracts
    schemas.ts                   # zod schemas mirrored from backend contracts
    utils.ts                     # cn()
  hooks/                         # useAuth, useOrg, useWorkspace, useDebounced
  public/
  package.json
  tsconfig.json
  next.config.ts
  eslint.config.mjs
  .env.example
```

Next.js 16 note (from `frontend/AGENTS.md`): APIs and conventions may differ from training data — read `node_modules/next/dist/docs/` before writing frontend code.

---

## 6. Data Ingestion Architecture

Upload path (async, Phase 2):

```text
POST /imports  (multipart)
   |
   v
Validate file (size ≤ 25 MB, extension + magic bytes, checksum)
   |
   v
Store original in R2 (ImportFile ← r2Key)
   |
   v
Create ImportJob (status=QUEUED) + Job row; return { importId, status }
   |
   v
Enqueue signal on Redis queue (IMPORT_DATA)
   |
   v
Worker:
   parse (xlsx/csv streaming)
   -> profile (row/col counts, missing, dupes, invalid)
   -> detect schema (type inference per column)
   -> map fields (deterministic rules first, AI assist on conflict, user confirm on low confidence)
   -> validate relationships (uniqueness + joinability checks, optional user confirmation)
   -> write DatasetVersion + columns + rows (relational split value tables)
   -> produce DataQualityReport; set Dataset.status (READY|READY_WITH_WARNINGS)
   -> update ImportJob/Job statuses
```

External DB path (Phase 2):

```text
POST /data-sources (credentials serialized server-side only, encrypted at rest)
   -> backend opens read-only connection (engine driver)
   -> verify read-only (SET TRANSACTION READ ONLY / user perms check where feasible)
   -> inspect schemas/tables → list to user
   -> user selects tables
   -> profile selected tables
   -> map business fields (rules first)
   -> create DataSource + DataSourceTable (isSelected) 
   -> SYNC_DATABASE job snapshots selected tables into Datasets
```

Safeguards (Principle II, IV, IX):

- Credentials encrypted with AES-256-GCM via `DataSourceCredential`; never returned by the API.
- Connection opens as read-only only; the SQL executor rejects all non-`SELECT` statements (see §8/§12).
- Files validated by size, extension, magic bytes, and parsed in isolated streaming workers; never executed.

---

## 7. AI Agent / Tool Architecture (Phase 3 design)

Agent types (all tool-using, provider-abstracted):

```text
AI Analyst (conversational)   — open questions over workspace data
Investigation (structured)    — root-cause workflow (compare → break down → rank contributors)
Simulation (structured)       — LLM assists understanding/explanation; deterministic engine computes
Recommendation (structured)   — LLM is not the creator of numbers; rules/workers create candidates
```

Tool catalog (approved set; Principle V). Tools execute deterministic code or validated read-only SQL and return results:

```text
get_workspace_datasets()
get_dataset_schema()
get_dataset_sample()
run_readonly_sql()        # validated: SELECT-only, LIMIT, timeout, infer-schema safe
calculate_metric()
compare_periods()
group_by_dimension()
find_top_entities()
find_anomalies()
generate_chart_spec()
get_business_context()
```

LLM boundaries (mandatory, constitution Rules 1–8):

- The LLM **never invents** numbers; it requests deterministic calculations and reads returned values.
- Every business claim carries evidence (`observed/calculated/inferred/projected/recommended` classification).
- Correlation is never dressed as causation.
- `run_readonly_sql` output is validated (columns, row limit, shape) before it reaches the prompt.
- Agents never receive credentials; tool input/output is persisted in `ToolCallRecord` for observability.

Agent flow:

```text
User question
   -> Agent (tool loop, bound token/step budget)
   -> tools hit deterministic engine (SQL/aggregation)
   -> evidence-shaped answer (with chart spec where useful)
   -> AgentRun + ToolCallRecord persisted; evaluable later (Phase 5 AI eval)
```

---

## 8. Business Simulator Architecture (Phase 3 design)

The simulator is a **structured feature**, not a chat answer (architecture §20–22, opencode §12).

```text
Scenario form (type, params)        // validated (Zod)
   -> retrieve historical data (deterministic backend engine)
   -> sufficiency check (min sample, period coverage)     [else “insufficient data” + sensitivity alternative]
   -> select model:
        price change   -> elasticity estimation (regression on historical Q/P)
        marketing spend-> spend-response estimation
        expense cut    -> margin arithmetic (deterministic)
        inventory      -> run-rate depletion rule
        custom         -> explicit user-supplied assumptions, labeled
   -> calculate projection (backend math only)
   -> produce assumptions + confidence + uncertainty label
   -> LLM explains/interprets results (no numerical invention)
   -> persist Simulation / Scenario / Result
```

Every result UI shows: current vs projected, assumptions, confidence, "estimate, not guarantee" disclaimer, and offers save / compare / export / "ask AI to explain".

---

## 9. Queue / Background-Job Architecture

Design decision: **the `jobs` table is the system of record**; Redis is the signaling/queue layer (not a second store of truth). Rationale: simple retries, audits, and idempotency in SQL; Redis remains fast for worker wake-up and short-lived fan-out.

```text
Enqueue (app code)
  -> INSERT INTO jobs (type, status=QUEUED, payload, maxAttempts)
  -> LPUSH redis:queue:{type} {jobId}        // signal only
Worker loop
  -> BRPOP redis:queue:{type}
  -> mark job RUNNING (atomic compare; stale claim timeout)
  -> run handler from registry
  -> mark COMPLETED/FAILED
Retry: on failure, attempts++, if < maxAttempts -> re-queue (backoff), else FAILED + error
```

Queue types (architecture §51):

```text
IMPORT_DATA | PROCESS_DATASET | SYNC_DATABASE | DETECT_ANOMALIES
GENERATE_REPORT | SEND_EMAIL | RUN_SCHEDULED_ANALYSIS
```

Job invariants: unique `jobId`, workspace context, status, attempts, failure handling, structured logs, idempotency keys where practical (e.g., dedupe email/report per period). In Phase 1 the `jobs` table, registry, and a dev-mode inline executor (no Redis) are shipped; Redis wiring is a Phase-gated enhancement once real async features land (Phase 2+).

Email (Phase 4): send path always goes through `SEND_EMAIL` jobs and `EmailDelivery` rows; templates are separate from business logic (Principle stack constraint). No emails are sent during development unless a dev mail sink is configured (opencode §24).

---

## 10. Authentication & Authorization Design

Decisions (user-approved):

- **Single-account model**: each organization registers one account. Registration creates a `User`, its `Organization`, and a default `Workspace` in a single transaction. The user is the implicit owner; no memberships, invitations, or team management exist in the initial version. A `role` column (default `OWNER`) stays on the user record purely as future-proofing for multi-user support.
- **Registration**: name, email, password (minimum 8 chars, bcrypt cost ≥ 10), and organization name. No email verification in this phase; the stored credentials are validated at login as normal.
- **Session model**: short-lived JWT **access token** (15 min, `jose` HS256, claims: `sub`, `sessionId`) delivered via httpOnly cookie; opaque **refresh token** (256-bit random, 30 days), stored **SHA-256 hashed** in `AuthSession`, rotated on every refresh, revocable on logout/compromise. Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` (prod), explicit `Path=/`.
- **CSRF posture**: SameSite=Lax cookies + JSON-only, POST-only mutation APIs (no state-changing GETs); optional double-submit token noted for later hardening.
- **Rate limiting**: strict per-IP limits on `/auth/*` (e.g., 10/min register/login) plus general API limits.
- **Authorization**: the authenticated user owns exactly one organization + workspace. `tenant-guard` derives the organization/workspace from the user's own record, **never** from client-supplied IDs. Resource queries add the org/workspace predicate on every call (Principle III, opencode §6).
- **Entitlements**: components and features are gated by the organization's subscription plan (backend-enforced; see §14 Phase 5). No role-permission matrix in this phase.

Flow:

```text
POST /auth/register  -> create User (role=OWNER) + Organization + default Workspace
                          (single transaction) -> set cookies -> audit
                          -> client redirects to onboarding page
POST /auth/login     -> validate email+password -> create AuthSession -> set cookies -> audit
POST /auth/refresh   -> verify refresh tx (hash match, not revoked/expired) -> rotate -> new cookies
POST /auth/logout    -> revoke session -> clear cookies -> audit
GET  /auth/me        -> user + active org/workspace + subscription entitlements
```

After registration/login the frontend is responsible for the onboarding
redirect: for a brand-new account it routes to the onboarding page
("Let's connect your business data"), for returning accounts it routes to the
overview. Enforcement happens backend-side on every mutation; frontend checks
only shape the UX (Principle III, IV).

---

## 11. API Endpoint Specification

Standards:

- Base URL: `{API_URL}/api/v1`.
- All responses use the envelope `{ success, data? }` or the error envelope from architecture §42: `{ success: false, error: { code, message, details? } }`.
- Pagination: `?page=1&perPage=50` → `{ data, meta: { page, perPage, total } }`.
- Auth via access token cookie by default (Bearer token accepted for tooling; no tokens in URLs).
- Mutable endpoints use POST/PATCH/DELETE only; never GET.

Phase 1 endpoints:

```text
POST /api/v1/auth/register         { name, email, password, organizationName } -> 201 { user, organization, workspace }
POST /api/v1/auth/login            { email, password }                            -> 200 { user }
POST /api/v1/auth/refresh          (cookie)                                       -> 200 { user }
POST /api/v1/auth/logout           (cookie)                                       -> 204
GET  /api/v1/auth/me               -> 200 { user, activeOrganization, activeWorkspace, entitlements }

GET  /api/v1/organizations/:orgId  -> 200 { organization, workspace }
PATCH /api/v1/organizations/:orgId { name }                                        -> 200
GET  /api/v1/workspaces/:workspaceId                                               -> 200
PATCH /api/v1/workspaces/:workspaceId { name }                                     -> 200

POST /api/v1/onboarding            { workspaceName? }   # optional rename of default workspace
                                   -> 200 { workspace }

GET  /api/v1/health  (no auth) -> 200 { status, version }
```

Typical repeatable error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `TENANT_MISMATCH`, `INTERNAL`.

Phase 2+ endpoint groups (designed, implemented per phase):

```text
/data-sources (CRUD + {id}/tables, {id}/verify, {id}/sync)      # credentials never in responses
/imports (create, list, {id}/status)                             # async job pattern
/datasets (list, {id}, {id}/schema, {id}/rows, {id}/versions, {id}/relationships, {id}/quality)
/analytics/metrics (calculate, compare-periods, group-by)
/dashboards (CRUD + widgets)
/ai {analyst/conversations, investigations, simulations}         # SSE streaming where useful
/recommendations, /alerts (+rules), /reports (+schedules), /notifications
/audit-logs, /billing (subscriptions, usage)
```

---

## 12. Security Model

Layered controls mapped to constitution/architecture requirements:

1. **Transport**: HTTPS required in prod (cookies `Secure`); HSTS header.
2. **Input**: Zod on every body/query/params (middleware `validate`). Never trust client org/workspace IDs — derived only from the authenticated user's own record.
3. **Auth**: bcrypt (≥10) password hashing; JWT HS256 with session binding; refresh rotation + revocation; login/register rate-limited.
4. **Cookies**: HttpOnly + SameSite=Lax + Secure + Path; no secrets in client JS.
5. **Tenant isolation**: server-side predicate on every org/workspace query, always compared against the authenticated user's own record; `TenantMismatch` for cross-tenant access attempts (logged, alerted).
6. **Secrets**: none in code, `.env` gitignored, `.env.example` committed; pino `redact` list; env loader fail-fast if required vars missing (Phase 1 only needs DATABASE_URL + JWT/refresh secrets + app URLs).
7. **External DB**: read-only connection; SELECT-only SQL validator; query timeouts and row limits; credentials encrypted at rest, never logged, never in prompts/responses.
8. **Files**: size (≤ 25 MB), extension + magic-byte checks, checksum, R2 private bucket; workers isolated.
9. **Internal API**: access via cookies only in browsers; no tokens in URLs; CORS locked to `APP_URL` in prod.
10. **Audit**: `AuditLog` for sensitive/mutating actions; no credentials or PII payloads (Principle XVIII).

---

## 13. Testing Strategy

Mapped to architecture §53 + constitution Principle XX.

```text
Unit        metric calculations, simulation math, schema mapping, type inference,
            entitlement checks, alert thresholds, JWT/refresh logic, regex SQL validator
Integration auth (register/login/refresh/logout + tenant isolation tests), org/workspace
            lifecycle, imports → dataset version pipeline, AI tool execution, report gen,
            email queue dedup/idempotency
E2E (P5)    register → workspace → upload → process → dashboard → AI analysis →
            investigation → simulation → recommendation → alert → report
```

Tooling (stack-locked): **backend** Vitest + Supertest (mocked Prisma for units, real Neon/test DB for integration); **frontend** Vitest + React Testing Library; **e2e** Playwright (Phase 5 gate). Every phase gate re-runs `tsc --noEmit`, lint, tests, and `prisma migrate` validity (opencode §28, constitution XXVI).

---

## 14. Development Roadmap

Phased per architecture §54 and the constitution build order. One phase at a time, gated (user-controlled):

```text
Phase 1 (Foundation)  env/tooling, Prisma identity+tenancy schema (User+Org+Workspace,
                      single-account, no memberships), auth (JWT+refresh cookies,
                      register creates user/org/workspace), audit service,
                      jobs table + registry (dev inline executor), Express skeleton, health,
                      frontend shell (shadcn), login/register, onboarding redirect + empty
                      states, guarded app layout; manual checkpoint before Phase 2.
Phase 2 (Data)        data sources, file upload → R2, ingestion workers, schema detect/map,
                      relational-split value tables, data quality, dashboards, import history.
Phase 3 (AI)          AI analyst, investigations, simulator engine, rewrites to queues.
Phase 4 (Automation)  anomaly detection worker, recommendations, alert rules + alerts,
                      weekly reports + schedules, email service + email worker, notifications.
Phase 5 (Hardening)   entitlements + usage limits enforcement, AI evaluation harness,
                      security/perf pass, Playwright e2e, deployment (Docker/CI, Neon, Upstash,
                      R2, Groq; secrets via env), billing UI.
```

Gate rule (user-set): after `research.md` → per-phase **spec** → user verification → **plan** (with Constitution Check gate) → user verification → **tasks** → implement. No phase starts before the previous phase's checkpoint passes.

---

## 15. Environment Variables (`.env.example` seed)

```text
# backend/.env.example
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:3000
API_URL=http://localhost:4000

DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/GrowMetrics?schema=public   # placeholder — user to supply Neon URL
JWT_SECRET=replace-with-32-char-random
REFRESH_TOKEN_SECRET=replace-with-32-char-random
SESSION_SECRET=replace-with-32-char-random

# Phase 2+
REDIS_URL=redis://localhost:6379
GROQ_API_KEY=
OPENAI_API_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_FROM=GrowMetrics <no-reply@GrowMetrics.app>
```

---

## 16. ADR Candidates (pending user consent)

Architecturally significant decisions in this document require ADRs before their phase implements (constitution Development Workflow). Candidates:

- **ADR-001** — Two independent frontend/backend folders (no workspaces), mirrored DTO contracts.
- **ADR-002** — Single-account tenancy: one implicit user per organization owning one default workspace; no memberships/invitations/roles in v1; `role` column reserved for later multi-user.
- **ADR-003** — JWT access (15 min) + opaque refresh (30 d, stored hashed) with httpOnly cookies.
- **ADR-004** — Relational split per column type for `dataset_rows` value storage.
- **ADR-005** — `jobs` table as system of record with Redis as signal layer.
- **ADR-006** — Prisma-only standard CRUD; raw SQL reserved for aggregation, always reviewed.

I will not create these without your go-ahead.

## 17. Decisions / Open Questions

Resolved for Phase 1:

1. **No email verification** — registration stores credentials; login validates email + password normally. `isEmailVerified` not modeled in Phase 1.
2. **Nodemailer, dev log sink** — emails go through the reusable service + queue (Phase 4); in development a no-op/log sink is used unless SMTP env vars are configured. No invitation emails (no invitations feature).
3. **Onboarding redirect** — after register, the client routes to a dedicated onboarding page ("Let's connect your business data"). Registration also auto-creates the default workspace.

Deferred (defaults chosen, can revisit later):

- Multi-user / roles / invitations / team management — future phase if requested.
- Email verification / password reset emails — future phase if requested.
- Multiple workspaces per organization — schema already allows it; UI/UX stays single-workspace for now.


--------------------

Part 5 — What's still broken, ordered for one-by-one fixing
Group A · Response envelope — breaks 3 of 5 Phase 4 pages
#	Fix
A1	Delete the directKeys heuristic in api-client.ts:71-84; keep only the ok() path
A2	Convert the 14 res.json() sites in alert-rule / alert / recommendation controllers to ok(res, …)
A3	Add contract pagination {items,total,page,limit} to list endpoints
Group B · workspaceId never resolved
#	Fix
B1	Add tenantGuard to alerts/routes.ts (only has requireAuth)
B2	alert-rule.controller.ts:36 + alert.controller.ts:17 → req.tenant.workspaceId instead of hard 400
B3	report.controller.ts:17, report-schedule.controller.ts:17, recommendation.controller.ts:29 → `
B4	Frontend: pass ?workspaceId= in api.reports/alertRules/alerts/reportSchedules/recommendations.list
B5	run-anomaly-detection.ts:16, evaluate-alert-rules.ts:16: payload.workspaceId ?? "" → same invalid-UUID trap
Group C · The scheduler was never built ← biggest gap
node-cron is in package.json:41 and installed, but imported nowhere. Tasks T135/T223 are marked [x] in tasks.md yet no cron code exists. Nothing enqueues RUN_ANOMALY_DETECTION, EVALUATE_ALERT_RULES, or GENERATE_REPORT — verified: enqueueJob( has only 5 call sites (import, email, simulation, investigation, ai). The entire automation loop is dormant. Research R1 explicitly requires "cron scheduler in the worker loop."
#	Fix
C1	New src/workers/scheduler.ts wiring node-cron
C2	Tick A → enqueue RUN_ANOMALY_DETECTION every ANOMALY_SCAN_INTERVAL_MS
C3	Tick B → enqueue EVALUATE_ALERT_RULES per org workspace
C4	Tick C → ReportSchedule where enabled && nextRunAt <= now → enqueue GENERATE_REPORT + SEND_EMAIL, advance nextRunAt (R5 step 5)
C5	report.controller.ts:30 → enqueue + 202 Accepted (contract reports.md:58 says 202, not synchronous)
Group D · Report content is fake
#	Fix
D1	report.service.ts:107-120 buildReportContent returns hardcoded {revenue:125000,…} → call computeMetric
D2	Report has no metricKeys column; contracts/reports.md:18 requires it
D3	report.service.ts:82 JSON.stringify(content) into a Json? column = double-encoded
D4	cronExpression → cron (report.schema.ts:33,48,55, alert-rule.schema.ts:13,28,36) — Prisma column is cron, so schedule create throws
D5	report-schedule.controller.ts:32 reuses createReportScheduleSchema for PATCH, forcing reportId+workspaceId on update
Group E · Alert rules are configured but never evaluated against real data
#	Fix
E1	alert-rule.service.ts:196-202 getCurrentMetricValue returns constant 150000 → use computeMetric
E2	alert-rule.service.ts:15 name: input.metricKind — discards the user's name (schema doesn't even accept it)
E3	alert-rule.service.ts:178-189 raw prisma.job.create with payload {alertId, recipients, templateName:'alert-notification'} — handler expects {emailDeliveryId,to,subject,html}. Job always fails. Template name doesn't exist (real ones: alert_fired, anomaly_detected, report_generated)
E4	email.service.ts:35,47 organizationId: recipientUserId ?? "placeholder-org" — EmailDelivery.organizationId is a non-nullable @db.Uuid, so this throws
E5	sendEmail() is never called by anything. Wire it into alert / report / anomaly paths
Group F · Anomaly detection uses hardcoded dates
#	Fix
F1	anomaly.service.ts:30-31,54-56 period fixed to 2026-07-01…07-31, labelled "2026-08". Derive from latest data with trailing N periods
F2	anomaly.service.ts:46 hardcodes 30 → env.ANOMALY_DEVIATION_THRESHOLD
F3	anomaly.service.ts:19 organizationId: { not: "" } hack; add INSUFFICIENT_DATA skip status
Group G · Entitlements never enforced for Phase 4
app.ts:74-77 mounts alert/report routers as separate routers — they don't inherit requireEntitlement("aiConversations") from aiRouter, and have no gate of their own. So recordUsage(orgId,"reports",1) meters usage that is never limited.
Group H · Test blind spot (must fix, or we repeat this)
- H1 — Stop vi.mocking the whole api-client in the 3 Phase 4 page tests; assert the outgoing URL contains workspaceId.
- H2 — tests/integration/reports.test.ts and alerts.test.ts never call a route — they poke a hand-built mockPrisma object. Add supertest cases hitting GET /api/v1/ai/reports and GET /api/v1/ai/alert-rules against the real Neon DB.
- H3 — Add a scheduler test that proves a due ReportSchedule actually enqueues.
Group I · Prisma client instances (low risk, quick)
report.controller.ts:8, report-schedule.controller.ts:8, alert.controller.ts:7, alert-rule.controller.ts:10, recommendation.controller.ts:10 each new PrismaClient() instead of the lib/prisma.ts singleton.
Suggested order


--------------


What will STILL be imperfect after Groups A–I
I want to be straight with you — three things won't be fully done:
1. CHANGES_BY is still placeholder math. alert-rule.service.ts:219-222 does Math.abs(value - threshold) > threshold * 0.1 with a // Placeholder comment. research.md R4 specifies |current − previous| / |previous| × 100 >= threshold, which needs a baseline fetch. Easy to add, but it's a 10th fix.
2. Recommendations only draw from 2 of 5 sources. recommendation.service.ts:14-22 reads only anomalyDetection and alert. FR-002 and R3 require ANOMALY, INVESTIGATION, RULE, SIMULATION, SYSTEM. Investigation findings and simulation outcomes never become recommendations.
3. Anomaly baseline is 1 trailing period, not R2's configurable trailing N (default 4). Fix F1 gets the periods dynamic, but making N configurable via env is a small extra step.
None of these break the journey above — they narrow two of the five recommendation sources and make one alert condition approximate.