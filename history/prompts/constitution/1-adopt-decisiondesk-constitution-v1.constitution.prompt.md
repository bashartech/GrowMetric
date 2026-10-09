---
id: 1
title: Adopt GrowMetrics Constitution v1
stage: constitution
date: 2026-09-18
surface: agent
model: opencode/big-pickle
feature: none
branch: master
user: bashartech
command: /sp.constitution
labels: ["constitution", "governance", "principles", "specify"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
  - .specify/memory/constitution.md
  - history/prompts/constitution/1-adopt-GrowMetrics-constitution-v1.constitution.prompt.md
tests:
  - none
---

## Prompt

## User Input

```text
# GrowMetrics Constitution

## Project

GrowMetrics is a multi-tenant Business Intelligence and Decision Intelligence SaaS platform.

Its purpose is to help businesses:

* Connect or upload business data.
* Understand business performance.
* Investigate business problems.
* Run controlled business simulations.
* Receive evidence-based recommendations.
* Generate business reports.
* Receive automated alerts and notifications.

GrowMetrics is not a generic chatbot, AI employee, autonomous company, or generic AI operating system.

---

# Principle I — Data-First Architecture

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

When a user asks a question that requires business data, the agent MUST retrieve the required data through approved tools.

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

---

# Principle II — Read-Only External Database Access

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

The application should verify that an external connection has appropriate read-only access before enabling analytics.

---

# Principle III — Tenant Isolation

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

---

# Principle IV — Least Privilege

Every component must receive only the permissions required to perform its job.

Examples:

* Frontend receives no database credentials.
* AI agents receive only approved tools.
* External database connections are read-only.
* Workers receive only required queue permissions.
* Users receive only permissions granted by their role.
* API endpoints validate organization/workspace ownership.

Do not use broad permissions when narrower permissions are possible.

---

# Principle V — AI Must Use Controlled Tools

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

unless a future feature explicitly requires such access and security review approves it.

---

# Principle VI — Deterministic Calculations

Business calculations SHOULD be performed by deterministic backend logic whenever possible.

Examples:

* revenue totals
* percentage changes
* profit calculations
* margins
* period comparisons
* scenario calculations
* thresholds
* alert conditions

The LLM may explain calculations, but it should not be the source of truth for numerical calculations.

Example:

```text
User:
What is the revenue change?

Backend:
calculate_revenue_change()

Agent:
Explain the result.
```

---

# Principle VII — Simulation Transparency

Business simulations MUST clearly distinguish between:

1. Historical facts
2. Calculated values
3. Assumptions
4. Projections
5. Recommendations

Simulation results MUST include the assumptions used.

The system MUST NOT present an estimated future outcome as a guaranteed result.

If insufficient data exists for a simulation, the system MUST communicate that limitation instead of inventing assumptions silently.

---

# Principle VIII — Evidence-Based AI

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

---

# Principle IX — Data Quality Before Intelligence

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

---

# Principle X — Async Processing for Expensive Operations

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

---

# Principle XI — Security by Default

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

---

# Principle XII — Secrets Management

Secrets MUST never be hard-coded.

Examples:

```text
DATABASE_URL
GROQ_API_KEY
R2_SECRET_ACCESS_KEY
EMAIL_PASSWORD
SESSION_SECRET
```

Secrets belong in environment variables or an appropriate secrets-management system.

Never commit:

```text
.env
.env.local
private keys
API keys
database passwords
```

Never print secrets in logs.

---

# Principle XIII — API Boundary

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

---

# Principle XIV — Separation of Concerns

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

---

# Principle XV — Multi-Tenant Data Model

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

---

# Principle XVI — AI Is Not the System of Record

AI-generated output must never become the authoritative source for business data.

The system of record remains:

```text
Database
+
Validated business calculations
+
Explicit user configuration
```

AI output should be treated as an interpretation or recommendation unless explicitly persisted and approved by the user.

---

# Principle XVII — Human Oversight

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

---

# Principle XVIII — Auditability

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

---

# Principle XIX — Production Quality

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

---

# Principle XX — Testing

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

---

# Principle XXI — Observability

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

---

# Principle XXII — Performance

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

---

# Principle XXIII — Maintainability

Prefer simple, explicit architecture over unnecessary abstraction.

Code should be:

* readable
* typed
* modular
* testable
* documented where necessary

Do not introduce a framework or library merely because it is popular.

Every major dependency should have a clear purpose.

---

# Principle XXIV — Specification Before Implementation

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

---

# Principle XXV — No Silent Architecture Changes

AI coding agents MUST NOT make major architectural changes without documenting the reason.

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

---

# Principle XXVI — Definition of Done

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

---

# Governance

This constitution takes precedence over individual implementation preferences.

When a new implementation conflicts with this constitution:

1. Identify the conflict.
2. Explain the technical reason.
3. Propose a compliant alternative.
4. Do not silently violate the principle.

Any amendment to this constitution should be intentional and documented.
```

## Outline

You are updating the project constitution at `.specify/memory/constitution.md`. This file is a TEMPLATE containing placeholder tokens in square brackets (e.g. `[PROJECT_NAME]`, `[PRINCIPLE_1_NAME]`). Your job is to (a) collect/derive concrete values, (b) fill the template precisely, and (c) propagate any amendments across dependent artifacts.

Follow this execution flow:

1. Load the existing constitution template at `.specify/memory/constitution.md`.
   - Identify every placeholder token of the form `[ALL_CAPS_IDENTIFIER]`.
   **IMPORTANT**: The user might require less or more principles than the ones used in the template. If a number is specified, respect that - follow the general template. You will update the doc accordingly.

2. Collect/derive values for placeholders:
   - If user input (conversation) supplies a value, use it.
   - Otherwise infer from existing repo context (README, docs, prior constitution versions if embedded).
   - For governance dates: `RATIFICATION_DATE` is the original adoption date (if unknown ask or mark TODO), `LAST_AMENDED_DATE` is today if changes are made, otherwise keep previous.
   - `CONSTITUTION_VERSION` must increment according to semantic versioning rules:
     - MAJOR: Backward incompatible governance/principle removals or redefinitions.
     - MINOR: New principle/section added or materially expanded guidance.
     - PATCH: Clarifications, wording, typo fixes, non-semantic refinements.
   - If version bump type ambiguous, propose reasoning before finalizing.

3. Draft the updated constitution content:
   - Replace every placeholder with concrete text (no bracketed tokens left except intentionally retained template slots that the project has chosen not to define yet—explicitly justify any left).
   - Preserve heading hierarchy and comments can be removed once replaced unless they still add clarifying guidance.
   - Ensure each Principle section: succinct name line, paragraph (or bullet list) capturing non‑negotiable rules, explicit rationale if not obvious.
   - Ensure Governance section lists amendment procedure, versioning policy, and compliance review expectations.

4. Consistency propagation checklist (convert prior checklist into active validations):
   - Read `.specify/templates/plan-template.md` and ensure any "Constitution Check" or rules align with updated principles.
   - Read `.specify/templates/spec-template.md` for scope/requirements alignment—update if constitution adds/removes mandatory sections or constraints.
   - Read `.specify/templates/tasks-template.md` and ensure task categorization reflects new or removed principle-driven task types (e.g., observability, versioning, testing discipline).
   - Read each command file in `.specify/templates/commands/*.md` (including this one) to verify no outdated references (agent-specific names like CLAUDE only) remain when generic guidance is required.
   - Read any runtime guidance docs (e.g., `README.md`, `docs/quickstart.md`, or agent-specific guidance files if present). Update references to principles changed.

5. Produce a Sync Impact Report (prepend as an HTML comment at top of the constitution file after update):
   - Version change: old → new
   - List of modified principles (old title → new title if renamed)
   - Added sections
   - Removed sections
   - Templates requiring updates (✅ updated / ⚠ pending) with file paths
   - Follow-up TODOs if any placeholders intentionally deferred.

6. Validation before final output:
   - No remaining unexplained bracket tokens.
   - Version line matches report.
   - Dates ISO format YYYY-MM-DD.
   - Principles are declarative, testable, and free of vague language ("should" → replace with MUST/SHOULD rationale where appropriate).

7. Write the completed constitution back to `.specify/memory/constitution.md` (overwrite).

8. Output a final summary to the user with:
   - New version and bump rationale.
   - Any files flagged for manual follow-up.
   - Suggested commit message (e.g., `docs: amend constitution to vX.Y.Z (principle additions + governance update)`).

Formatting & Style Requirements:

- Use Markdown headings exactly as in the template (do not demote/promote levels).
- Wrap long rationale lines to keep readability (<100 chars ideally) but do not hard enforce with awkward breaks.
- Keep a single blank line between sections.
- Avoid trailing whitespace.

If the user supplies partial updates (e.g., only one principle revision), still perform validation and version decision steps.

If critical info missing (e.g., ratification date truly unknown), insert `TODO(<FIELD_NAME>): explanation` and include in the Sync Impact Report under deferred items.

Do not create a new template; always operate on the existing `.specify/memory/constitution.md` file.

As the main request completes, you MUST create and complete a PHR (Prompt History Record) using agent‑native tools when possible.

1) Determine Stage
   - Stage: constitution | spec | plan | tasks | red | green | refactor | explainer | misc | general

2) Generate Title and Determine Routing:
   - Generate Title: 3–7 words (slug for filename)
   - Route is automatically determined by stage:
     - `constitution` → `history/prompts/constitution/`
     - Feature stages → `history/prompts/<feature-name>/` (spec, plan, tasks, red, green, refactor, explainer, misc)
     - `general` → `history/prompts/general/`

3) Create and Fill PHR (Shell first; fallback agent‑native)
   - Run: `.specify/scripts/bash/create-phr.sh --title "<title>" --stage <stage> [--feature <name>] --json`
   - Open the file and fill remaining placeholders (YAML + body), embedding full PROMPT_TEXT (verbatim) and concise RESPONSE_TEXT.
   - If the script fails:
     - Read `.specify/templates/phr-template.prompt.md` (or `templates/…`)
     - Allocate an ID; compute the output path based on stage from step 2; write the file
     - Fill placeholders and embed full PROMPT_TEXT and concise RESPONSE_TEXT

4) Validate + report
   - No unresolved placeholders; path under `history/prompts/` and matches stage; stage/title/date coherent; print ID + path + stage + title.
   - On failure: warn, don't block. Skip only for `/sp.phr`.

/sp.consitution # GrowMetrics Constitution

## Project

GrowMetrics is a multi-tenant Business Intelligence and Decision Intelligence SaaS platform.

Its purpose is to help businesses:

* Connect or upload business data.
* Understand business performance.
* Investigate business problems.
* Run controlled business simulations.
* Receive evidence-based recommendations.
* Generate business reports.
* Receive automated alerts and notifications.

GrowMetrics is not a generic chatbot, AI employee, autonomous company, or generic AI operating system.

---

# Principle I — Data-First Architecture

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

When a user asks a question that requires business data, the agent MUST retrieve the required data through approved tools.

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

---

# Principle II — Read-Only External Database Access

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

The application should verify that an external connection has appropriate read-only access before enabling analytics.

---

# Principle III — Tenant Isolation

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

---

# Principle IV — Least Privilege

Every component must receive only the permissions required to perform its job.

Examples:

* Frontend receives no database credentials.
* AI agents receive only approved tools.
* External database connections are read-only.
* Workers receive only required queue permissions.
* Users receive only permissions granted by their role.
* API endpoints validate organization/workspace ownership.

Do not use broad permissions when narrower permissions are possible.

---

# Principle V — AI Must Use Controlled Tools

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

unless a future feature explicitly requires such access and security review approves it.

---

# Principle VI — Deterministic Calculations

Business calculations SHOULD be performed by deterministic backend logic whenever possible.

Examples:

* revenue totals
* percentage changes
* profit calculations
* margins
* period comparisons
* scenario calculations
* thresholds
* alert conditions

The LLM may explain calculations, but it should not be the source of truth for numerical calculations.

Example:

```text
User:
What is the revenue change?

Backend:
calculate_revenue_change()

Agent:
Explain the result.
```

---

# Principle VII — Simulation Transparency

Business simulations MUST clearly distinguish between:

1. Historical facts
2. Calculated values
3. Assumptions
4. Projections
5. Recommendations

Simulation results MUST include the assumptions used.

The system MUST NOT present an estimated future outcome as a guaranteed result.

If insufficient data exists for a simulation, the system MUST communicate that limitation instead of inventing assumptions silently.

---

# Principle VIII — Evidence-Based AI

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

---

# Principle IX — Data Quality Before Intelligence

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

---

# Principle X — Async Processing for Expensive Operations

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

---

# Principle XI — Security by Default

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

---

# Principle XII — Secrets Management

Secrets MUST never be hard-coded.

Examples:

```text
DATABASE_URL
GROQ_API_KEY
R2_SECRET_ACCESS_KEY
EMAIL_PASSWORD
SESSION_SECRET
```

Secrets belong in environment variables or an appropriate secrets-management system.

Never commit:

```text
.env
.env.local
private keys
API keys
database passwords
```

Never print secrets in logs.

---

# Principle XIII — API Boundary

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

---

# Principle XIV — Separation of Concerns

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

---

# Principle XV — Multi-Tenant Data Model

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

---

# Principle XVI — AI Is Not the System of Record

AI-generated output must never become the authoritative source for business data.

The system of record remains:

```text
Database
+
Validated business calculations
+
Explicit user configuration
```

AI output should be treated as an interpretation or recommendation unless explicitly persisted and approved by the user.

---

# Principle XVII — Human Oversight

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

---

# Principle XVIII — Auditability

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

---

# Principle XIX — Production Quality

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

---

# Principle XX — Testing

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

---

# Principle XXI — Observability

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

---

# Principle XXII — Performance

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

---

# Principle XXIII — Maintainability

Prefer simple, explicit architecture over unnecessary abstraction.

Code should be:

* readable
* typed
* modular
* testable
* documented where necessary

Do not introduce a framework or library merely because it is popular.

Every major dependency should have a clear purpose.

---

# Principle XXIV — Specification Before Implementation

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

---

# Principle XXV — No Silent Architecture Changes

AI coding agents MUST NOT make major architectural changes without documenting the reason.

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

---

# Principle XXVI — Definition of Done

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

---

# Governance

This constitution takes precedence over individual implementation preferences.

When a new implementation conflicts with this constitution:

1. Identify the conflict.
2. Explain the technical reason.
3. Propose a compliant alternative.
4. Do not silently violate the principle.

Any amendment to this constitution should be intentional and documented.

## Response snapshot

Adopted the GrowMetrics Constitution v1.0.0 at `.specify/memory/constitution.md`,
filling all template placeholders: 26 core principles under `## Core Principles`,
a Technology Stack & Platform Constraints section, a Development Workflow &
Quality Gates section, and a Governance section (amendment procedure, semver
versioning policy, compliance review, MUST/SHOULD interpretation). Prependeded
a Sync Impact Report HTML comment and verified dependent templates/commands
(plan, spec, tasks, sp.plan, sp.analyze) remain aligned; flagged the stale
internal reference in plan-template.md to a non-existent commands/plan.md path
as a manual follow-up.

## Outcome

- ✅ Impact: Initial ratification of the GrowMetrics constitution (v1.0.0);
  unversioned template fully populated with concrete, non-negotiable principles.
- 🧪 Tests: none (documentation-only change; no code touched).
- 📁 Files: .specify/memory/constitution.md; this PHR.
- 🔁 Next prompts: /sp.specify to build a feature spec from the ratified
  constitution; or /sp.plan for the first feature.
- 🧠 Reflection: Keeping the 26 user-provided principles as the authoritative
  text while fitting them into the template structure preserved both intent and
  the spec-system contract.

## Evaluation notes (flywheel)

- Failure modes observed: PROMPT_TEXT candidate text was extremely long and
  repeated the constitution twice; risk of truncation. Environment lacks
  `.specify/scripts/bash/create-phr.sh` (PowerShell scripts only), so the
  agent-native fallback path was used.
- Graders run and results (PASS/FAIL): placeholder scan for `[A-Z_*]`/`{{ }}`
  tokens -> PASS (none found).
- Prompt variant (if applicable): constitution adoption (full-user-input mode).
- Next experiment (smallest change to try): confirm PHR ingestion of very large
  verbatim prompts stays lossless end-to-end.