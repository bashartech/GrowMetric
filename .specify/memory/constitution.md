<!--
SYNC IMPACT REPORT
=====================================================================
Version change:        template (unversioned) -> 1.0.0 (initial adoption)
Modified principles:   N/A (first fill; no prior principles existed)
Added sections:
  - Core Principles (Principles I-XXVI)
  - Technology Stack & Platform Constraints
  - Development Workflow & Quality Gates
  - Governance (amendment procedure, versioning policy, compliance review)
Removed sections:      none
Templates requiring updates:
  - .specify/templates/plan-template.md          -> reviewed, aligned (Constitution Check gate)   [updated]
  - .specify/templates/spec-template.md          -> reviewed, aligned (no mandatory section change) [updated]
  - .specify/templates/tasks-template.md         -> reviewed, aligned (testing/observability/security) [updated]
  - .opencode/command/sp.plan.md / sp.analyze.md -> reviewed, aligned (reference .specify/memory/constitution.md) [updated]
  - .specify/templates/plan-template.md line 6   -> stale internal ref to .specify/templates/commands/plan.md (does not exist) [pending: manual follow-up]
Follow-up TODOs:
  - RATIFICATION_DATE unknown before this adoption; set to 2026-09-18 (constitution initially ratified).
  - No placeholders intentionally deferred; all tokens resolved.
=====================================================================
-->

# GrowMetrics Constitution

## Core Principles

### I. Data-First Architecture

All business-specific AI behavior MUST be grounded in actual business data.

The system MUST NOT allow the language model to invent:

* revenue
* expenses
* orders
* inventory
* customers
* profit
* forecasts
* simulation results
* business metrics

When a user asks a question that requires business data, the agent MUST retrieve
the required data through approved tools.

The architecture should follow:

```text
Business Data
     ↓
Data Layer
     ↓
Analytics
     ↓
AI Tools
     ↓
Agent Reasoning
     ↓
Evidence-Based Response
```

The LLM is responsible for reasoning and interpretation.

Deterministic application code is responsible for calculations whenever possible.

### II. Read-Only External Database Access

External customer databases MUST be treated as read-only data sources.

GrowMetrics MUST NOT perform:

* INSERT
* UPDATE
* DELETE
* DROP
* ALTER
* TRUNCATE
* CREATE
* GRANT
* REVOKE

operations against customer databases.

External database credentials MUST never be exposed to:

* frontend code
* browser clients
* AI model prompts
* logs
* analytics
* error messages

Database credentials MUST remain server-side.

Whenever possible, customers should use dedicated read-only database credentials.

The application should verify that an external connection has appropriate
read-only access before enabling analytics.

### III. Tenant Isolation

Every business belongs to an organization and workspace.

The system MUST enforce tenant isolation at the backend and database access layers.

A user MUST never be able to access another organization's:

* datasets
* files
* reports
* conversations
* recommendations
* simulations
* alerts
* business data
* database connections

by modifying an ID in a request.

Authorization MUST be checked server-side.

Frontend visibility is never considered authorization.

### IV. Least Privilege

Every component must receive only the permissions required to perform its job.

Examples:

* Frontend receives no database credentials.
* AI agents receive only approved tools.
* External database connections are read-only.
* Workers receive only required queue permissions.
* Users receive only permissions granted by their role.
* API endpoints validate organization/workspace ownership.

Do not use broad permissions when narrower permissions are possible.

### V. AI Must Use Controlled Tools

Business agents MUST use approved tools for business-specific operations.

Possible tools include:

```text
get_workspace_datasets
get_dataset_schema
get_dataset_sample
run_readonly_sql
calculate_metric
compare_periods
group_by_dimension
find_anomalies
generate_chart
get_business_context
```

Agents MUST NOT have unrestricted access to the application infrastructure.

Agents MUST NOT directly access:

* operating system commands
* arbitrary filesystem operations
* shell commands
* database credentials
* deployment credentials
* secrets

unless a future feature explicitly requires such access and security review
approves it.

### VI. Deterministic Calculations

Business calculations SHOULD be performed by deterministic backend logic
whenever possible.

Examples:

* revenue totals
* percentage changes
* profit calculations
* margins
* period comparisons
* scenario calculations
* thresholds
* alert conditions

The LLM may explain calculations, but it should not be the source of truth for
numerical calculations.

Example:

```text
User:
What is the revenue change?

Backend:
calculate_revenue_change()

Agent:
Explain the result.
```

### VII. Simulation Transparency

Business simulations MUST clearly distinguish between:

1. Historical facts
2. Calculated values
3. Assumptions
4. Projections
5. Recommendations

Simulation results MUST include the assumptions used.

The system MUST NOT present an estimated future outcome as a guaranteed result.

If insufficient data exists for a simulation, the system MUST communicate that
limitation instead of inventing assumptions silently.

### VIII. Evidence-Based AI

Important AI findings MUST be traceable to underlying data.

Where appropriate, the UI should allow users to inspect:

* source dataset
* relevant metric
* calculation
* SQL query
* comparison period
* supporting records or aggregates

The system should distinguish:

```text
Observed
Calculated
Inferred
Projected
Recommended
```

Do not claim causation when the system only established correlation.

### IX. Data Quality Before Intelligence

Data must be validated before being used for important analytics.

The ingestion system should detect:

* missing values
* duplicate records
* invalid dates
* invalid numeric values
* inconsistent types
* suspicious values
* possible relationships

AI analysis should be aware of important data-quality problems.

A warning should be shown when data quality can materially affect an analysis.

### X. Async Processing for Expensive Operations

Long-running operations MUST NOT block normal HTTP requests.

Use background jobs for operations such as:

* Excel processing
* large CSV imports
* database synchronization
* anomaly detection
* weekly report generation
* email delivery
* scheduled analysis

Use Redis/Upstash queues for asynchronous work.

Jobs should support:

* status
* retries
* failure handling
* logging
* idempotency where appropriate

### XI. Security by Default

All external input MUST be validated.

Use schema validation such as Zod where appropriate.

Security-sensitive areas include:

* authentication
* authorization
* file uploads
* database connections
* SQL generation
* AI tools
* email recipients
* background jobs
* API endpoints

Never trust:

* client-provided organization IDs
* client-provided workspace IDs
* client-provided role information
* AI-generated SQL
* uploaded file metadata
* external database connection information

### XII. Secrets Management

Secrets MUST never be hard-coded.

Examples:

```text
DATABASE_URL
GROQ_API_KEY
R2_SECRET_ACCESS_KEY
EMAIL_PASSWORD
SESSION_SECRET
```

Secrets belong in environment variables or an appropriate secrets-management
system.

Never commit:

```text
.env
.env.local
private keys
API keys
database passwords
```

Never print secrets in logs.

### XIII. API Boundary

The frontend MUST NOT directly access:

* PostgreSQL
* Prisma
* customer databases
* Redis credentials
* R2 credentials
* Groq credentials

The frontend communicates with the backend API.

Architecture:

```text
Next.js
   ↓
Express API
   ↓
Services
   ↓
Prisma / Workers / AI
```

### XIV. Separation of Concerns

The project must maintain clear separation between:

```text
Routes
Controllers
Services
Repositories / Database
Workers
AI Agents
AI Tools
Validation
Infrastructure
```

Do not place business logic inside React components.

Do not place large business workflows inside Express route handlers.

Do not place database queries directly inside frontend code.

### XV. Multi-Tenant Data Model

The application should use the conceptual model:

```text
User
 ↓
Organization
 ↓
Workspace
 ↓
Data Sources
 ↓
Datasets
 ↓
Analytics
 ↓
AI / Reports / Recommendations
```

The dashboard belongs to a workspace, not an uploaded file.

Multiple sources may contribute to the same workspace.

### XVI. AI Is Not the System of Record

AI-generated output must never become the authoritative source for business data.

The system of record remains:

```text
Database
+
Validated business calculations
+
Explicit user configuration
```

AI output should be treated as an interpretation or recommendation unless
explicitly persisted and approved by the user.

### XVII. Human Oversight

Important business actions should remain human-controlled.

GrowMetrics may:

* detect
* analyze
* explain
* recommend
* simulate
* notify

But it should not silently perform consequential business changes.

For example, an AI recommendation may say:

> Inventory appears insufficient.

It may create a recommendation or task.

It should not automatically modify the customer's inventory database.

### XVIII. Auditability

Important actions should be auditable.

Record appropriate events such as:

* data source creation
* file upload
* data import
* database connection
* AI investigation
* simulation
* report generation
* alert creation
* recommendation creation
* notification sending
* permission changes

Audit logs MUST NOT contain secrets.

### XIX. Production Quality

A feature is not considered complete merely because the UI exists.

A production feature should include the appropriate combination of:

```text
UI
API
Validation
Authorization
Database
Error Handling
Loading States
Logging
Testing
Security
```

Features must be designed for real users, not only demo data.

### XX. Testing

Important business logic MUST be testable.

Tests should cover:

* calculations
* authorization
* tenant isolation
* data mapping
* imports
* simulation logic
* alert conditions
* AI tool behavior
* API behavior

Critical workflows should have integration or end-to-end tests.

### XXI. Observability

The application should provide enough observability to diagnose failures.

Track appropriate:

* request IDs
* job IDs
* agent run IDs
* latency
* errors
* queue status
* database errors
* AI tool calls
* AI execution duration

Never log sensitive secrets or unnecessary business data.

### XXII. Performance

Do not load large datasets into application memory unnecessarily.

Prefer:

* database aggregation
* pagination
* streaming
* indexes
* query limits
* caching
* background workers

AI agents should retrieve only the data necessary to answer the user's question.

### XXIII. Maintainability

Prefer simple, explicit architecture over unnecessary abstraction.

Code should be:

* readable
* typed
* modular
* testable
* documented where necessary

Do not introduce a framework or library merely because it is popular.

Every major dependency should have a clear purpose.

### XXIV. Specification Before Implementation

Features must be specified before significant implementation begins.

For each feature:

```text
Specification
    ↓
Clarification
    ↓
Plan
    ↓
Implementation
    ↓
Testing
    ↓
Review
```

Do not implement large features from vague requirements.

### XXV. No Silent Architecture Changes

AI coding agents MUST NOT make major architectural changes without documenting
the reason.

Examples include:

* replacing PostgreSQL
* replacing Prisma
* changing the queue system
* changing authentication architecture
* changing the AI framework
* changing tenant architecture
* introducing another backend
* changing the external database strategy

Such changes require explicit approval.

### XXVI. Definition of Done

A feature is complete only when:

1. The specification is satisfied.
2. The implementation matches the specification.
3. Relevant tests pass.
4. TypeScript passes.
5. Linting passes.
6. Database migrations are valid.
7. Authorization is verified.
8. Error handling exists.
9. Security requirements are satisfied.
10. Documentation is updated where necessary.

## Technology Stack & Platform Constraints

Build a production-quality, multi-tenant SaaS application. Use the following
stack unless there is a strong technical reason to introduce another technology
(justified and approved per Principle XXV).

* **Frontend**: Next.js (App Router), TypeScript, React, Tailwind CSS,
  shadcn/ui, Recharts, React Hook Form, Zod, and TanStack Query where appropriate.
* **Backend**: Node.js, Express.js, TypeScript. Expose a clean REST API; keep
  frontend and backend responsibilities separated. Do not put all business logic
  inside Next.js API routes.
* **Main database**: PostgreSQL with Prisma ORM. Stores users, organizations,
  workspaces, memberships, subscriptions, datasets, data sources, imports,
  schemas, relationships, business metrics, dashboards, conversations, agent
  runs, recommendations, alerts, reports, and audit logs.
* **AI**: OpenAI Agents SDK with Groq API as the model provider. Keep the AI
  provider abstract so another model provider can be introduced later. Never
  hard-code the application around a single model.
* **Background processing**: Redis (Upstash Redis) with queue-based background
  jobs for imports, synchronization, anomaly detection, reports, email delivery,
  and scheduled analysis. Long-running operations MUST NOT run synchronously in
  HTTP requests.
* **Email**: Nodemailer behind a reusable email service supporting weekly
  reports, business alerts, and notifications. Email templates MUST be separated
  from business logic.
* **Object storage**: Cloudflare R2 for original uploaded files and generated
  files when appropriate. Never use object storage as the analytics database.
* **External database connectors**: read-only access only (initially PostgreSQL
  and MySQL); architecture must allow additional engines later.
* **Secrets**: environment variables or a secrets-management system. Never
  commit `.env`, keys, or passwords; never print secrets in logs.
* **Testing**: unit, integration, and end-to-end tests as described in
  Principle XX and the Development Workflow section.
* **Subscriptions**: entitlements MUST be enforced in the backend. Never rely on
  frontend checks alone for feature access or usage limits.

## Development Workflow & Quality Gates

Work incrementally. Do not generate the entire application in one large step.

Build order:

1. Architecture, database schema, folder structure, environment configuration,
   authentication, organizations/workspaces.
2. Data sources, file ingestion, datasets, dashboard.
3. AI Analyst, Investigation, Simulator.
4. Recommendations, Alerts, Reports, Email.
5. Testing, security, observability, performance, deployment.

After each phase:

1. Run the application.
2. Run tests.
3. Check TypeScript.
4. Check linting.
5. Check database migrations.
6. Fix errors.
7. Verify the feature manually.
8. Only then move to the next phase.

Required workflow per feature (Principle XXIV): Specification, Clarification,
Plan, Implementation, Testing, Review.

Every implementation plan MUST include a **Constitution Check** gate. The
constitution is non-negotiable within feature scope: conflicts must be resolved
by adjusting the spec, plan, or tasks, not by diluting or silently ignoring a
principle. If a principle itself needs to change, that requires a separate,
explicit constitution amendment.

Architecturally significant decisions (framework, data model, API, security,
tenant architecture, stack changes) MUST be documented as ADRs with reasoning
and tradeoffs before implementation.

## Governance

This constitution takes precedence over individual implementation preferences.

When a new implementation conflicts with this constitution:

1. Identify the conflict.
2. Explain the technical reason.
3. Propose a compliant alternative.
4. Do not silently violate the principle.

Any amendment to this constitution is intentional and documented: record the
reason, update this file, and bump the version.

**Versioning policy** (semantic versioning):

* **MAJOR**: backward-incompatible removals or redefinitions of principles or
  governance structure.
* **MINOR**: new principle/section added, or materially expanded guidance.
* **PATCH**: clarifications, wording, typo fixes, and non-semantic refinements.

**Compliance review**: every plan/spec MUST pass the Constitution Check gate;
PRs and reviews verify compliance; conflicts are resolved per the procedure
above. See `architecture.md` and `opencode.md` for runtime development guidance.

**Interpretation**: for this constitution, MUST denotes an absolute requirement;
SHOULD denotes a strong recommendation that must be followed unless a documented
reason exists at the point of implementation.

**Version**: 1.0.0 | **Ratified**: 2026-09-18 | **Last Amended**: 2026-09-18