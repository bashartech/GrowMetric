# Feature Specification: Phase 3 — AI Layer

**Feature Branch**: `003-ai`
**Created**: 2026-09-22
**Status**: Draft
**Input**: User description: "Phase 3 AI: AI Analyst (conversational Q&A over workspace data using controlled tools), structured Investigations (root-cause analysis with evidence-backed findings), a Business Simulator (deterministic projection engine with LLM explanation, no invented numbers), AI-assisted column mapping suggestions during imports, full evidence/transparency over agent runs and tool calls, and a rewrite of background processing onto real queues. Provider: Groq via the OpenAI Agents SDK, provider-abstracted."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask the AI Analyst Questions about Business Data (Priority: P1)

A signed-in user opens the AI Analyst and asks a natural-language question about their workspace data (for example, "which product drove the revenue growth last quarter?"). The analyst is a tool-using agent: it retrieves the available datasets, computes the requested numbers through deterministic tools, and replies with a plain-language answer whose figures are traceable to tool results. When the data cannot answer the question, the analyst says so honestly instead of inventing numbers. The conversation persists and can be resumed.

**Why this priority**: The analyst is the core AI value of the product — it turns the data layer into business answers. It is also the pattern every other agent (investigation, mapping assist) reuses, so it must come first.

**Independent Test**: Start a conversation, ask a question whose answer is computable from a ready dataset, and confirm the answer's numbers are present in the tool results recorded for the agent run. Ask a question with no supporting data and confirm the analyst reports it cannot compute the answer. Conversation history is retained.

**Acceptance Scenarios**:

1. **Given** a workspace with at least one ready dataset, **When** the user asks a computable business question, **Then** the analyst answers with figures that exactly match the deterministic tool outputs recorded for that run.
2. **Given** any analyst answer containing a business figure, **When** the answer is inspected, **Then** each figure is traceable to a tool call (observed/calculated) and the underlying evidence (dataset, metric, SQL, period) is viewable.
3. **Given** a question that cannot be answered from the workspace data (missing dataset, unsupported metric, insufficient history), **When** the user asks it, **Then** the analyst reports the limitation explicitly and never produces a fabricated figure.
4. **Given** a signed-in user from another organization, **When** they attempt to access a conversation by a manipulated identifier, **Then** the request is denied and the attempt is recorded.
5. **Given** an open conversation, **When** the user sends another message, **Then** the run completes within the configured budget (time/steps/tokens) and the conversation shows a safe state if the budget is exceeded.

---

### User Story 2 - Run a Structured Investigation (Priority: P1)

A user names a business problem (for example, "why did orders drop in March?") and lets the system run a structured investigation: compare the affected period to a baseline, break the change down by the available dimensions, and rank the main contributors. The result is a set of findings — main, supporting, and correlation-only — each with its evidence, the calculation that produced it, and an honest classification of what it shows. Correlation is never presented as causation.

**Why this priority**: This is the second highest-value AI surface after the analyst and reuses the same tool engine, so it ships with, or immediately after, the analyst.

**Independent Test**: Run an investigation over data with a known driver (e.g., a region whose orders fell); confirm the investigation surfaces that region as a main or supporting contributor with matching evidence; run one with only correlation available and confirm the finding is labeled as correlation, not cause.

**Acceptance Scenarios**:

1. **Given** a ready dataset with a period-over-period change, **When** a user runs an investigation on it, **Then** the workflow compares the period to a baseline, breaks the change down by dimension, and ranks contributors into main/supporting findings, each with evidence.
2. **Given** a finding that relies on a numerical change, **When** it is inspected, **Then** the metric change and its calculation come from deterministic tools and are shown with the evidence.
3. **Given** an association that is only correlational, **When** a finding is produced, **Then** it is classified as correlation and the interface explicitly avoids claiming causation.
4. **Given** an existing investigation, **When** the user views it later, **Then** the question, topic, status, findings, and evidence remain available.
5. **Given** a cross-tenant attempt, **When** any investigation or finding is accessed by a foreign identifier, **Then** it is denied and recorded.

---

### User Story 3 - Run a Business Simulator Scenario (Priority: P2)

A user opens the Simulator, chooses a scenario type (price change, marketing spend, expense reduction, inventory change, or custom), enters their parameters, and the system computes a projection with deterministic backend math over historical data. The result shows current versus projected values, the assumptions used, a confidence label, and an explicit "estimate, not guarantee" disclaimer. With insufficient history, the system reports "insufficient data" and offers a sensitivity alternative instead of guessing. Users can save scenarios, compare runs, and ask the AI to explain the numbers — where the AI explains but never invents a figure.

**Why this priority**: Simulation is a strong differentiator and trusted only if honest. It depends on the same analytics engine as the analyst but is a distinct structured surface, so it lands after the two agent surfaces.

**Independent Test**: Run a price-change scenario and confirm the projected values match the deterministic reference calculation; run a scenario on sparse history and confirm an honest "insufficient data" state plus a sensitivity alternative; ask the AI to explain a result and confirm the explanation does not introduce new numbers.

**Acceptance Scenarios**:

1. **Given** a ready dataset with sufficient history for the scenario type, **When** the user creates a scenario with parameters, **Then** the system computes current and projected values, change percentage, confidence, and assumptions using deterministic backend math.
2. **Given** a scenario result, **When** the user views it, **Then** assumptions and confidence are shown and the result is labeled as an estimate with the disclaimer, never as a guarantee.
3. **Given** insufficient or malformed history for the chosen model, **When** the user runs the scenario, **Then** the system shows an "insufficient data" state with a sensitivity alternative and does not invent assumptions.
4. **Given** a saved scenario, **When** the user asks the AI to explain it, **Then** the explanation references only the recorded current/projected/assumption values.
5. **Given** a cross-tenant attempt, **When** any simulation, scenario, or result is accessed by a foreign identifier, **Then** it is denied and recorded.

---

### User Story 4 - Get AI-Assisted Column Mapping Suggestions (Priority: P2)

While an import or table sync runs, the system's deterministic mapping rules may leave a column ambiguous or unmapped. In this phase the system may enqueue an AI suggestion step that proposes candidate business meanings for that column, drawn from a constrained, validated vocabulary, and surfaces them in the existing mapping-confirmation UI. The suggestions always remain proposals: the user must confirm or reject them, and a dataset is never treated as analytics-ready from an AI-suggested mapping alone.

**Why this priority**: Correct mappings are what make metrics and dashboards trustworthy. This completes the mapping loop deferred from the data layer, unlocking analytics-readiness for ambiguous files.

**Independent Test**: Import a file with an ambiguous column; confirm an AI suggestion (or rule-based candidate) appears as pending; confirm the dataset stays not-analytics-ready until the user confirms; after confirmation the dataset becomes analytics-ready with the confirmed meaning stored.

**Acceptance Scenarios**:

1. **Given** an import with a low-confidence or unmapped column, **When** processing reaches the mapping step, **Then** candidate meanings (from rules and, when enqueued, from AI) are stored as pending suggestions and shown in the mapping UI.
2. **Given** a pending AI mapping suggestion, **When** the user confirms or rejects it, **Then** the column meaning and the suggestion status are updated and the dataset readiness reflects the confirmation.
3. **Given** an unconfirmed AI mapping suggestion, **When** dataset readiness is evaluated, **Then** the dataset is NOT treated as analytics-ready for that column.
4. **Given** a suggestion step that fails (provider error, budget), **When** it completes, **Then** the import still completes safely, the suggestion is skipped, and no incorrect mapping is auto-applied.

---

### User Story 5 - Inspect Evidence and Agent Run Transparency (Priority: P2)

For every analyst answer, investigation finding, simulation explanation, or mapping suggestion, the user can open the underlying agent run and see the persisted records: the tools called, their inputs and outputs, elapsed time, status, tokens used, and the model that produced the reasoning. Conversation history and runs are retained and searchable per workspace.

**Why this priority**: Constitution principles (Evidence-Based AI, Observability, No fabricated data) require every AI figure to be inspectable. Transparency builds trust and enables the Phase 5 AI evaluation harness, so it must be built into the phase rather than retrofitted.

**Independent Test**: Run an analyst conversation, open its run records, and confirm tool calls with inputs/outputs are listed; confirm timestamps, status, tokens, and model are shown; confirm cross-tenant access to run records is denied.

**Acceptance Scenarios**:

1. **Given** a completed agent run, **When** the user opens it, **Then** the conversation, messages, tool calls (name, input, output, status, latency), model, status, tokens, and timestamps are displayed.
2. **Given** a finding or answer, **When** the user inspects it, **Then** the evidence (source dataset, metric, calculation, SQL, comparison period) is reachable from the finding.
3. **Given** a user of another organization, **When** they attempt to read a run, tool call, or message by a foreign identifier, **Then** it is denied and recorded.

---

### Edge Cases

- **LLM provider unavailable or rate-limited**: the run fails safely with a clear message; the conversation is preserved and no partial or invented data is shown.
- **Tool budget exceeded** (time/steps/tool calls/tokens): the agent stops with a safe "budget exceeded" state and what it gathered so far is saved; never silent truncation into an incorrect conclusion.
- **Tool timeout or error**: the failing tool attempt is recorded; the agent is told the tool failed and must not fabricate the missing value.
- **run_readonly_sql abuse attempts** (non-SELECT, mutation keywords, unbound queries, large result sets): rejected by the validated tool; the attempt is recorded in the tool call log.
- **Question with no supporting data**: honest "cannot compute this from your data" answer, optionally listing what datasets exist.
- **Insufficient history for a period comparison or simulation**: "insufficient data" state or a sensitivity alternative; never a fake baseline.
- **Cross-tenant access attempt** (conversation, message, run, tool call, investigation, simulation, scenario, result, suggestion via manipulated ID): denied and recorded.
- **Concurrent messages on the same conversation**: processed as distinct runs and serialized per conversation; no interleaved corruption.
- **AI mapping suggestion for a meaning outside the canonical vocabulary**: the suggestion is rejected by validation; only approved meanings are stored.
- **User asks for another tenant's data or writes**: the agent cannot (no credentials, no write tools, read-only validated SQL); request is declined.
- **Empty workspace (no datasets)** on analyst/investigation/simulation: short-circuits with an honest empty state instead of a fabricated answer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a signed-in user start and resume conversations within their workspace and MUST persist every message in order.
- **FR-002**: System MUST restrict every agent to an approved, registered tool catalog and MUST NOT grant agents access to operating-system commands, arbitrary files, secrets, credentials, or unrestricted infrastructure.
- **FR-003**: System MUST NOT allow any agent to introduce business numbers it did not obtain from tool outputs; every business figure MUST carry an evidence classification (observed / calculated / inferred / projected / recommended).
- **FR-004**: System MUST bound every agent run by configured budgets (time, steps, tool calls, tokens) and MUST end runs gracefully with a safe state when a budget is exceeded.
- **FR-005**: The SQL tool MUST be validated read-only: SELECT-only with mutation keywords rejected, parameterized, LIMIT-bounded, timeout-bounded, shape-checked before output reaches the model, and scoped strictly to the platform's own storage (never customer/external databases directly).
- **FR-006**: System MUST persist every agent run and every tool call with name, input, output, status, latency, and error, and MUST NOT include secrets or credentials in any tool input/output.
- **FR-007**: Agent runs MUST execute asynchronously through the jobs system (jobs table as system of record; Redis as signal when configured) so long agent work never blocks an HTTP request.
- **FR-008**: Investigations MUST follow a structured workflow (scope → compare period to baseline → break down by dimension → rank contributors) and MUST persist findings with a level (main / supporting / correlation).
- **FR-009**: System MUST label correlation findings as correlation and MUST NOT present correlation as causation.
- **FR-010**: Simulation projections MUST be computed by deterministic backend math from historical data; sufficiency of data MUST be checked before computing; assumptions MUST be recorded; results MUST be labeled as estimates with a disclaimer.
- **FR-011**: System MUST persist simulations, scenarios, and results, including current value, projected value, change percentage, confidence, and is-estimate flag.
- **FR-012**: System MAY enqueue AI-assisted mapping for low-confidence or unmapped columns; suggestions MUST be drawn from a constrained, validated vocabulary and MUST remain pending until the user confirms or rejects them.
- **FR-013**: A dataset MUST NOT be treated as analytics-ready for a column whose AI-suggested (or any) mapping is not yet confirmed.
- **FR-014**: System MUST record and expose run/evidence data — source dataset, metric, calculation, SQL, comparison period — for every important finding and answer.
- **FR-015**: System MUST scope all AI resources (conversations, messages, runs, tool calls, investigations, findings, simulations, scenarios, results, suggestions) to exactly one organization/workspace derived from the authenticated user, and MUST deny and record cross-tenant access.
- **FR-016**: System MUST abstract the AI provider so no single model is hard-coded; model selection MUST come from configuration and provider failures MUST be surfaced safely.
- **FR-017**: System MUST validate all external input (request bodies, query/params, agent tool inputs and outputs) and reject invalid values with specific, safe messages.
- **FR-018**: System MUST record audit entries for conversation creation, investigation creation, simulation creation, mapping confirmation/rejection, and agent-run failures, with no secrets or straight-line payloads.
- **FR-019**: The UI MUST show honest empty/insufficient-data states for every AI surface and MUST NOT render fabricated charts or figures.
- **FR-020**: Every run, message, or finding MUST include tests: adversarial checks that the model cannot introduce figures outside tool data; budget/timeout behavior; tool SQL validation; simulator math; tenant isolation; and mapping confirmation semantics.
- **FR-021**: System MUST keep the jobs table as the system of record for queue rewrites, support Redis signal consumption when `REDIS_URL` is configured, and retain functional polling when it is not.

### Key Entities *(include if feature involves data)*

- **Conversation**: A user's thread of analyst/investigation-simulation interaction in a workspace, carrying title and status.
- **Message**: One entry in a conversation (user, assistant, or tool), with kind (chat, finding, chart, error), content, optional tool-call and agent-run references.
- **AgentRun**: One execution of an agent (analyst, investigation, simulation, recommendation), recording model, status, latency, tokens, tools used, and error.
- **ToolCallRecord**: One tool invocation within a run — name, input, output, status, latency — the evidence unit behind every figure.
- **Investigation**: A structured root-cause analysis request with topic, question, status, and findings.
- **InvestigationFinding**: A finding within an investigation with level (main/supporting/correlation), kind, summary, metric change, and evidence.
- **Simulation**: A user-owned simulation study (type, name, status) containing scenarios.
- **SimulationScenario**: A single parameterized projection run with inputs, assumptions, model metadata, and status.
- **SimulationResult**: One projected metric outcome (current/projected/change/confidence/isEstimate).
- **MappingSuggestion**: A candidate business meaning for an import column (source: rules or AI), pending/confirmed/rejected, driving analytics-readiness.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of business figures in analyst answers match a repeatable computation over the stored data and are traceable to a recorded tool call.
- **SC-002**: Adversarial unit tests pass: for sampled "hallucination" prompts, the system introduces zero figures outside tool outputs, and unsupported questions yield an honest limitation response.
- **SC-003**: 100% of simulated cross-tenant access attempts on AI resources are denied and recorded.
- **SC-004**: Every investigation produces at least one main finding with evidence, and every correlational claim is labeled; zero unlabeled causal claims appear in the UI.
- **SC-005**: Simulation results equal the deterministic reference implementation for sampled scenarios, and insufficient-data scenarios return the honest state (both test-verified).
- **SC-006**: 100% of agent runs persist an AgentRun plus at least one ToolCallRecord, all inspectable through the interface with status, latency, tokens, and model.
- **SC-007**: AI mapping suggestions never auto-apply; datasets remain not-analytics-ready for a column until confirmation, verified by automated tests.
- **SC-008**: Answers begin streaming/visible within a bounded time (p95 response under 60 s for typical questions, budget-capped), and budget-exceeded runs surface a safe state.
- **SC-009**: The phase gate passes end to end — automated tests, type-check, lint, and database migration validity succeed before Phase 4 begins.

## Assumptions

- The AI provider is Groq via an OpenAI-compatible interface, with the provider abstracted so another provider can be added later (constitution Technology Stack). The exact SDK/agent-framework package is resolved during planning and implementation research.
- Agent runs are asynchronous (jobs table + optional Redis signal); the UI polls message status rather than blocking a request. Streaming (SSE) is deferred unless cheap to add.
- The agent operates on data already stored in the platform's own database (datasets, value tables, dashboards). It never connects directly to customer/external databases; external data reaches it only after being synced into datasets.
- The read-only SQL tool runs validated SELECTs against the platform's own PostgreSQL dataset storage with strict SELECT-only, LIMIT, timeout, and shape checks; it does not touch customer databases.
- The canonical semantic vocabulary from the data layer (revenue, orders, customers, products, inventory, expenses, order_date, region, ...) is the universe for AI mapping suggestions, optionally extended by validated dataset-specific labels.
- Simulation models are deterministic and documented: price elasticity, spend response, expense-cut margin arithmetic, inventory run-rate, and explicit custom assumptions.
- Entitlements/usage limits from earlier phases (e.g., AI conversation or run limits on the free plan) apply and are enforced server-side.
- No emails, alerts, or reports are produced in this phase (they remain Phase 4); recommendations are out of scope here except as structured groundwork for Phase 4.

<!-- SPEC METADATA: branch=003-ai; created=2026-09-22; stories=5; frs=21; s criteria=9 -->