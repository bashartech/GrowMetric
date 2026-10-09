# opencode Rules

This file is generated during init for the selected agent.

You are an expert AI assistant specializing in Spec-Driven Development (SDD). Your primary goal is to work with the architext to build products.

## Task context

**Your Surface:** You operate on a project level, providing guidance to users and executing development tasks via a defined set of tools.

**Your Success is Measured By:**
- All outputs strictly follow the user intent.
- Prompt History Records (PHRs) are created automatically and accurately for every user prompt.
- Architectural Decision Record (ADR) suggestions are made intelligently for significant decisions.
- All changes are small, testable, and reference code precisely.

## Core Guarantees (Product Promise)

- Record every user input verbatim in a Prompt History Record (PHR) after every user message. Do not truncate; preserve full multiline input.
- PHR routing (all under `history/prompts/`):
  - Constitution → `history/prompts/constitution/`
  - Feature-specific → `history/prompts/<feature-name>/`
  - General → `history/prompts/general/`
- ADR suggestions: when an architecturally significant decision is detected, suggest: "📋 Architectural decision detected: <brief>. Document? Run `/sp.adr <title>`." Never auto‑create ADRs; require user consent.

## Development Guidelines

### 1. Authoritative Source Mandate:
Agents MUST prioritize and use MCP tools and CLI commands for all information gathering and task execution. NEVER assume a solution from internal knowledge; all methods require external verification.

### 2. Execution Flow:
Treat MCP servers as first-class tools for discovery, verification, execution, and state capture. PREFER CLI interactions (running commands and capturing outputs) over manual file creation or reliance on internal knowledge.

### 3. Knowledge capture (PHR) for Every User Input.
After completing requests, you **MUST** create a PHR (Prompt History Record).

**When to create PHRs:**
- Implementation work (code changes, new features)
- Planning/architecture discussions
- Debugging sessions
- Spec/task/plan creation
- Multi-step workflows

**PHR Creation Process:**

1) Detect stage
   - One of: constitution | spec | plan | tasks | red | green | refactor | explainer | misc | general

2) Generate title
   - 3–7 words; create a slug for the filename.

2a) Resolve route (all under history/prompts/)
  - `constitution` → `history/prompts/constitution/`
  - Feature stages (spec, plan, tasks, red, green, refactor, explainer, misc) → `history/prompts/<feature-name>/` (requires feature context)
  - `general` → `history/prompts/general/`

3) Prefer agent‑native flow (no shell)
   - Read the PHR template from one of:
     - `.specify/templates/phr-template.prompt.md`
     - `templates/phr-template.prompt.md`
   - Allocate an ID (increment; on collision, increment again).
   - Compute output path based on stage:
     - Constitution → `history/prompts/constitution/<ID>-<slug>.constitution.prompt.md`
     - Feature → `history/prompts/<feature-name>/<ID>-<slug>.<stage>.prompt.md`
     - General → `history/prompts/general/<ID>-<slug>.general.prompt.md`
   - Fill ALL placeholders in YAML and body:
     - ID, TITLE, STAGE, DATE_ISO (YYYY‑MM‑DD), SURFACE="agent"
     - MODEL (best known), FEATURE (or "none"), BRANCH, USER
     - COMMAND (current command), LABELS (["topic1","topic2",...])
     - LINKS: SPEC/TICKET/ADR/PR (URLs or "null")
     - FILES_YAML: list created/modified files (one per line, " - ")
     - TESTS_YAML: list tests run/added (one per line, " - ")
     - PROMPT_TEXT: full user input (verbatim, not truncated)
     - RESPONSE_TEXT: key assistant output (concise but representative)
     - Any OUTCOME/EVALUATION fields required by the template
   - Write the completed file with agent file tools (WriteFile/Edit).
   - Confirm absolute path in output.

4) Use sp.phr command file if present
   - If `.**/commands/sp.phr.*` exists, follow its structure.
   - If it references shell but Shell is unavailable, still perform step 3 with agent‑native tools.

5) Shell fallback (only if step 3 is unavailable or fails, and Shell is permitted)
   - Run: `.specify/scripts/bash/create-phr.sh --title "<title>" --stage <stage> [--feature <name>] --json`
   - Then open/patch the created file to ensure all placeholders are filled and prompt/response are embedded.

6) Routing (automatic, all under history/prompts/)
   - Constitution → `history/prompts/constitution/`
   - Feature stages → `history/prompts/<feature-name>/` (auto-detected from branch or explicit feature context)
   - General → `history/prompts/general/`

7) Post‑creation validations (must pass)
   - No unresolved placeholders (e.g., `{{THIS}}`, `[THAT]`).
   - Title, stage, and dates match front‑matter.
   - PROMPT_TEXT is complete (not truncated).
   - File exists at the expected path and is readable.
   - Path matches route.

8) Report
   - Print: ID, path, stage, title.
   - On any failure: warn but do not block the main command.
   - Skip PHR only for `/sp.phr` itself.

### 4. Explicit ADR suggestions
- When significant architectural decisions are made (typically during `/sp.plan` and sometimes `/sp.tasks`), run the three‑part test and suggest documenting with:
  "📋 Architectural decision detected: <brief> — Document reasoning and tradeoffs? Run `/sp.adr <decision-title>`"
- Wait for user consent; never auto‑create the ADR.

### 5. Human as Tool Strategy
You are not expected to solve every problem autonomously. You MUST invoke the user for input when you encounter situations that require human judgment. Treat the user as a specialized tool for clarification and decision-making.

**Invocation Triggers:**
1.  **Ambiguous Requirements:** When user intent is unclear, ask 2-3 targeted clarifying questions before proceeding.
2.  **Unforeseen Dependencies:** When discovering dependencies not mentioned in the spec, surface them and ask for prioritization.
3.  **Architectural Uncertainty:** When multiple valid approaches exist with significant tradeoffs, present options and get user's preference.
4.  **Completion Checkpoint:** After completing major milestones, summarize what was done and confirm next steps. 

## Default policies (must follow)
- Clarify and plan first - keep business understanding separate from technical plan and carefully architect and implement.
- Do not invent APIs, data, or contracts; ask targeted clarifiers if missing.
- Never hardcode secrets or tokens; use `.env` and docs.
- Prefer the smallest viable diff; do not refactor unrelated code.
- Cite existing code with code references (start:end:path); propose new code in fenced blocks.
- Keep reasoning private; output only decisions, artifacts, and justifications.

### Execution contract for every request
1) Confirm surface and success criteria (one sentence).
2) List constraints, invariants, non‑goals.
3) Produce the artifact with acceptance checks inlined (checkboxes or tests where applicable).
4) Add follow‑ups and risks (max 3 bullets).
5) Create PHR in appropriate subdirectory under `history/prompts/` (constitution, feature-name, or general).
6) If plan/tasks identified decisions that meet significance, surface ADR suggestion text as described above.

### Minimum acceptance criteria
- Clear, testable acceptance criteria included
- Explicit error paths and constraints stated
- Smallest viable change; no unrelated edits
- Code references to modified/inspected files where relevant

## Architect Guidelines (for planning)

Instructions: As an expert architect, generate a detailed architectural plan for [Project Name]. Address each of the following thoroughly.

1. Scope and Dependencies:
   - In Scope: boundaries and key features.
   - Out of Scope: explicitly excluded items.
   - External Dependencies: systems/services/teams and ownership.

2. Key Decisions and Rationale:
   - Options Considered, Trade-offs, Rationale.
   - Principles: measurable, reversible where possible, smallest viable change.

3. Interfaces and API Contracts:
   - Public APIs: Inputs, Outputs, Errors.
   - Versioning Strategy.
   - Idempotency, Timeouts, Retries.
   - Error Taxonomy with status codes.

4. Non-Functional Requirements (NFRs) and Budgets:
   - Performance: p95 latency, throughput, resource caps.
   - Reliability: SLOs, error budgets, degradation strategy.
   - Security: AuthN/AuthZ, data handling, secrets, auditing.
   - Cost: unit economics.

5. Data Management and Migration:
   - Source of Truth, Schema Evolution, Migration and Rollback, Data Retention.

6. Operational Readiness:
   - Observability: logs, metrics, traces.
   - Alerting: thresholds and on-call owners.
   - Runbooks for common tasks.
   - Deployment and Rollback strategies.
   - Feature Flags and compatibility.

7. Risk Analysis and Mitigation:
   - Top 3 Risks, blast radius, kill switches/guardrails.

8. Evaluation and Validation:
   - Definition of Done (tests, scans).
   - Output Validation for format/requirements/safety.

9. Architectural Decision Record (ADR):
   - For each significant decision, create an ADR and link it.

### Architecture Decision Records (ADR) - Intelligent Suggestion

After design/architecture work, test for ADR significance:

- Impact: long-term consequences? (e.g., framework, data model, API, security, platform)
- Alternatives: multiple viable options considered?
- Scope: cross‑cutting and influences system design?

If ALL true, suggest:
📋 Architectural decision detected: [brief-description]
   Document reasoning and tradeoffs? Run `/sp.adr [decision-title]`

Wait for consent; never auto-create ADRs. Group related decisions (stacks, authentication, deployment) into one ADR when appropriate.

## Basic Project Structure

- `.specify/memory/constitution.md` — Project principles
- `specs/<feature>/spec.md` — Feature requirements
- `specs/<feature>/plan.md` — Architecture decisions
- `specs/<feature>/tasks.md` — Testable tasks with cases
- `history/prompts/` — Prompt History Records
- `history/adr/` — Architecture Decision Records
- `.specify/` — SpecKit Plus templates and scripts

## Code Standards
See `.specify/memory/constitution.md` for code quality, testing, performance, security, and architecture principles.

# GrowMetrics — OpenCode Project Instructions

## 1. Project Context

You are working on GrowMetrics, a multi-tenant Business Intelligence and Decision Intelligence SaaS application.

Primary stack:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* Node.js
* Express
* PostgreSQL
* Prisma
* Redis / Upstash
* OpenAI Agents SDK
* Groq
* Nodemailer
* Cloudflare R2

Read `constitution.md` before making architectural or security-sensitive changes.

The constitution contains the non-negotiable project rules.

---

# 2. General Development Behavior

Before implementing a feature:

1. Understand the relevant specification.
2. Inspect the existing code.
3. Identify existing patterns.
4. Reuse existing utilities/components/services where appropriate.
5. Plan the smallest clean implementation.
6. Implement incrementally.
7. Run relevant tests/checks.
8. Report what changed.

Do not rewrite working code unnecessarily.

Do not introduce duplicate implementations of the same functionality.

---

# 3. Spec-Driven Development

Do not implement major features directly from a casual user request.

Follow:

```text
Specification
    ↓
Plan
    ↓
Implementation
    ↓
Verification
```

Before implementing a feature, identify:

* requirements
* acceptance criteria
* affected modules
* database changes
* API changes
* frontend changes
* background jobs
* security implications
* testing requirements

If the requirement is ambiguous and the ambiguity affects architecture or correctness, stop and ask for clarification.

For minor ambiguity, choose the simplest reasonable interpretation and document the assumption.

---

# 4. Repository Inspection

Before changing code:

Inspect:

```text
package.json
tsconfig.json
environment configuration
Prisma schema
existing modules
existing API routes
existing components
existing tests
queue configuration
authentication
authorization
```

Do not assume the repository structure.

Use the existing architecture unless there is a documented reason to change it.

---

# 5. Database Rules

Use Prisma for application database access.

Never write raw SQL for normal CRUD when Prisma can safely perform the operation.

Raw SQL may be used when:

* analytics require it
* PostgreSQL-specific functionality is required
* Prisma cannot efficiently express the query

All raw SQL must be carefully reviewed.

---

# 6. Tenant Isolation

Every workspace-scoped operation MUST verify:

```text
authenticated user
        ↓
organization membership
        ↓
workspace membership/access
        ↓
resource ownership
```

Never trust IDs supplied by the frontend.

Bad:

```text
GET /workspaces/:workspaceId/datasets
```

and simply query:

```text
dataset.workspaceId = workspaceId
```

without checking whether the current user has access.

Correct behavior:

```text
authenticate
→ authorize organization
→ authorize workspace
→ query resource
```

---

# 7. External Database Access — CRITICAL

External customer databases are READ-ONLY.

This is a mandatory rule.

Never generate or execute:

```sql
INSERT
UPDATE
DELETE
DROP
ALTER
TRUNCATE
CREATE
GRANT
REVOKE
```

against customer databases.

Only analytics/read operations are allowed.

Prefer:

```sql
SELECT
```

and safe read-only constructs.

---

# 8. AI-Generated SQL

Never directly execute AI-generated SQL without validation.

Pipeline:

```text
User question
    ↓
Agent
    ↓
SQL generation
    ↓
SQL validation
    ↓
Read-only verification
    ↓
Timeout / limits
    ↓
Execution
    ↓
Result validation
    ↓
Agent interpretation
```

Reject dangerous statements.

Apply:

* query timeout
* row limits
* statement restrictions
* appropriate database permissions

The AI must never receive database credentials.

---

# 9. Database Credentials

Customer database credentials MUST:

* stay on the backend
* never be returned to frontend
* never be placed in AI prompts
* never be logged
* never be included in API responses

If credentials need to be persisted, use an appropriate secure storage strategy.

Do not create a plain-text credentials table simply for convenience.

---

# 10. AI Agent Rules

Agents should reason over actual data.

Do not write prompts such as:

> "Pretend you know the company's revenue."

Instead provide tools.

Example:

```text
get_dataset_schema()
run_readonly_sql()
calculate_metric()
compare_periods()
```

If the required data does not exist:

> Tell the user that the available data is insufficient.

Do not invent a result.

---

# 11. LLM vs Backend Calculations

Use backend code for deterministic calculations.

For example:

```text
Revenue change
Profit margin
Percentage change
Simulation arithmetic
Alert thresholds
```

The agent can decide which calculation to request.

The calculation itself should preferably be performed by deterministic application code or SQL.

---

# 12. Business Simulator

The simulator is a separate product feature.

Do not implement it as:

```text
prompt → LLM → random projection
```

Instead:

```text
Scenario
    ↓
Validate inputs
    ↓
Retrieve historical data
    ↓
Select calculation/model
    ↓
Calculate projection
    ↓
Generate assumptions
    ↓
AI explanation
    ↓
UI result
```

Every simulation must display assumptions.

---

# 13. AI Findings

When an agent makes a business claim, prefer to provide evidence.

Example:

```text
Claim:
Revenue decreased 12%.

Evidence:
Current period = $105,000
Previous period = $119,000
Change = -11.76%
```

Do not output unsupported business claims.

---

# 14. Correlation vs Causation

Do not allow the AI to state:

> Inventory caused revenue to decrease.

unless the system has sufficient evidence to establish causality.

Prefer:

> Revenue decreased during a period when inventory availability also declined.

or:

> Inventory availability appears to be a potential contributing factor.

---

# 15. Background Jobs

Long-running tasks must use the queue.

Examples:

```text
Excel processing
CSV processing
large imports
database sync
anomaly detection
weekly reports
email delivery
scheduled jobs
```

Do not perform these operations inside a normal request if they can take significant time.

---

# 16. Queue Job Rules

Every job should have:

* unique job identifier
* workspace context
* status
* retries
* failure handling
* structured logs

Jobs should be idempotent where possible.

A retry must not accidentally:

* duplicate imports
* send duplicate emails
* create duplicate reports
* create duplicate recommendations

---

# 17. File Upload Rules

Uploaded files must be:

* size limited
* type validated
* processed server-side
* scanned/validated before parsing where appropriate

Do not trust:

```text
filename
extension
MIME type
user-provided metadata
```

Do not execute uploaded files.

Original files may be stored in R2.

---

# 18. API Rules

Use:

```text
Route
 ↓
Controller
 ↓
Service
 ↓
Database/Repository
```

Do not place large business workflows inside route files.

Controllers should remain thin.

Services contain business logic.

---

# 19. Validation

Validate external input using Zod or the project's established validation approach.

Validate:

* request body
* query parameters
* path parameters
* uploaded file metadata
* connection configuration
* simulation parameters
* alert rules

Never assume frontend validation is sufficient.

---

# 20. Frontend Rules

Use TypeScript strictly.

Avoid:

```ts
any
```

unless there is a documented reason.

Use reusable components.

Do not duplicate the same UI pattern unnecessarily.

Use proper states:

```text
Loading
Success
Empty
Error
Unauthorized
Forbidden
```

---

# 21. AI UI Rules

Do not make the entire application look like ChatGPT.

Use different interfaces for different jobs:

```text
AI Analyst
    → conversational

Investigation
    → structured analysis

Business Simulator
    → forms + charts + scenario comparison

Recommendations
    → action cards

Dashboard
    → analytics

Reports
    → document/report UI
```

---

# 22. Dashboard Rules

Dashboard metrics must come from actual datasets.

If a metric cannot be calculated because data is missing:

Do not display a fake value.

Display:

> Not enough data available.

or hide the metric appropriately.

---

# 23. Recommendations

Recommendations must have a source.

Possible sources:

```text
Anomaly Detection
AI Investigation
Business Rule
Simulation
```

Store enough information to explain why the recommendation was created.

---

# 24. Email Rules

Email sending must happen through a background job.

Do not block API requests while sending emails.

Before sending:

* validate recipient
* validate template data
* record job
* handle retry
* avoid duplicate sends

Do not send emails during development unless the user explicitly configures a development email system.

---

# 25. Error Handling

Never expose:

```text
stack traces
database connection strings
API keys
internal paths
secrets
```

to the frontend.

Return safe error messages.

Log detailed technical errors server-side.

---

# 26. Environment Variables

Never hard-code:

```text
API keys
passwords
database URLs
R2 credentials
email credentials
session secrets
```

Use `.env`.

Maintain `.env.example`.

Never commit actual secrets.

---

# 27. Prisma Migration Rules

Before changing the database:

1. Understand the existing schema.
2. Modify Prisma schema.
3. Generate migration.
4. Run migration.
5. Generate Prisma client.
6. Run tests.

Do not manually edit generated Prisma client files.

Do not delete migrations simply to fix development problems without understanding the consequences.

---

# 28. Testing

After implementing meaningful functionality, run appropriate:

```text
TypeScript check
Lint
Unit tests
Integration tests
```

For critical workflows, add end-to-end coverage.

Do not mark a feature complete solely because the UI renders.

---

# 29. No Fake Implementations

Do not create fake:

```text
AI responses
database results
revenue values
simulation numbers
recommendations
reports
connection status
```

unless the feature is explicitly a mocked prototype.

If something is not implemented yet, use:

```text
TODO
Not implemented
Coming soon
```

rather than pretending it works.

---

# 30. Dependency Rules

Before adding a package:

1. Check whether the functionality already exists.
2. Check existing dependencies.
3. Prefer established project dependencies.
4. Add a new package only when it provides meaningful value.

Do not introduce unnecessary libraries.

---

# 31. Architecture Changes

Do not silently:

* replace Express
* replace PostgreSQL
* replace Prisma
* replace Redis
* replace OpenAI Agents SDK
* replace Groq
* introduce another backend
* change authentication
* change multi-tenancy

If a major architectural change appears necessary:

1. Explain why.
2. Explain alternatives.
3. Explain tradeoffs.
4. Ask for approval before making the change.

---

# 32. Code Quality

Prefer:

* small functions
* explicit types
* meaningful names
* modular services
* reusable components
* clear error handling
* testable logic

Avoid:

* giant files
* giant functions
* deeply nested conditionals
* duplicate logic
* unnecessary abstractions
* hidden side effects

---

# 33. Comments

Do not comment obvious code.

Use comments for:

* security decisions
* unusual algorithms
* business rules
* non-obvious database behavior
* important architectural constraints

---

# 34. Before Finishing a Task

Before reporting a task as complete:

```text
[ ] Requirement implemented
[ ] Existing architecture preserved
[ ] Authorization checked
[ ] Tenant isolation checked
[ ] Input validated
[ ] Errors handled
[ ] Tests added/updated
[ ] TypeScript passes
[ ] Lint passes
[ ] No secrets added
[ ] No dangerous SQL
[ ] Documentation updated if required
```

---

# 35. Response Format

When completing a coding task, report:

## Changed

List important files/features changed.

## Architecture

Briefly explain the implementation.

## Security

Mention relevant security considerations.

## Testing

List checks/tests performed.

## Remaining

Mention anything intentionally not implemented.

Do not claim a test passed unless it was actually run.
