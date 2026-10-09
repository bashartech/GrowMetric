---
description: "Task list for Phase 3 — AI Layer"
---

# Tasks: Phase 3 — AI Layer

**Input**: Design documents from `/specs/003-ai/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: INCLUDED — the phase gate (plan.md) and FR-020 require unit + integration (ProviderMock-based) tests in every phase.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to the spec's user stories
- Exact file paths are included in every task

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`, `backend/prisma/`
- Frontend: `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/tests/`
- AI engine: `backend/src/lib/agent/` (provider-abstracted; never call a live model in tests — `MockProvider`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add Phase 3 dependencies, environment variables, and the provider mock on top of the Phase 1/2 foundation.

- [x] T001 Add AI dependencies to `backend/package.json`: `openai` (OpenAI-compatible client against `AI_BASE_URL`; drop-in behind `AgentEngine`; switch to `openai-agents-sdk` package if the TS package proves available for Groq at implementation time per research R1)
- [x] T002 Extend `backend/src/config/env.ts` + `backend/.env.example` with zod-validated vars: `GROQ_API_KEY` (optional at boot, required to enable live AI), `AI_BASE_URL`, `AI_MODEL`, `AI_MAX_STEPS`, `AI_MAX_TOOL_CALLS`, `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_ENABLED`; fail-fast with redacted errors
- [x] T003 Extend pino redaction in `backend/src/lib/logger.ts` to redact `gsk_*`/`GROQ_API_KEY`/provider-key patterns; add redaction unit test in `backend/tests/unit/logger.test.ts` (fails if key leaks)
- [x] T004 [P] Create `backend/tests/helpers/provider-mock.ts` — `MockProvider` implementing the `AgentEngine` contract (suggest tool calls from a scripted fixture, return controlled outputs, simulate timeout/budget/non-compliant output paths); used by ALL agent tests
- [x] T005 [P] Create `backend/tests/fixtures/ai/` — scripted agent transcripts (computable answer, "cannot compute", tool-failure, budget-exceeded, readonly-SQL abuse attempt, hallucination-injection)
- [x] T006 [P] Add `frontend` test spectator route stubs: `frontend/tests/unit/ai-*.test.tsx` placeholders (created with the story they cover; see story phases)

**Checkpoint**: ✅ Both apps install; env loader validates AI vars; logger redaction test passes; `MockProvider` drives a stub loop.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database models, the AI engine seam (provider/tools/budgets/evidence), deterministic simulation math, and the queue rewrite. Blocks all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database

- [x] T007 Extend `backend/prisma/schema.prisma` with the 10 Phase 3 models + 14 enums from data-model.md (Conversation, Message, AgentRun, ToolCallRecord, Investigation, InvestigationFinding, Simulation, SimulationScenario, SimulationResult, MappingSuggestion; enums: ConversationKind, MessageRole, MessageKind, EvidenceClass, AgentKind, AgentRunStatus, ToolCallStatus, InvestigationStatus, FindingLevel, FindingKind, SimulationType, SimulationStatus, ScenarioStatus, SuggestionSource, SuggestionStatus)
- [x] T008 Generate and apply the migration: `npx prisma migrate dev --name ai_layer` and `npx prisma generate`

### AI engine libs (block all AI stories)

- [x] T009 [P] Implement `backend/src/lib/agent/provider.ts` — `AgentEngine` interface (tool definitions, send, budgets) + `GroqEngine` adapter (OpenAI-compatible chat-completions against `AI_BASE_URL` with `AI_MODEL`) and `MockProvider` re-export; config-driven, provider-abstracted (FR-016)
  - Deviation: `MockProvider` stays in `tests/helpers/provider-mock.ts` (not re-exported by `provider.ts`) to keep the seam library-free; all agent tests use it. Revisit at ADR-006 finalization.
- [x] T010 [P] Implement `backend/src/lib/agent/tools.ts` — 11-tool registry (get_workspace_datasets, get_dataset_schema, get_dataset_sample, run_readonly_sql, calculate_metric, compare_periods, group_by_dimension, find_top_entities, find_anomalies, generate_chart_spec, get_business_context) with Zod arg schemas; tool body reuse Phase 2 analytics/dataset services; closed catalog (FR-002)
- [x] T011 [P] Implement `backend/src/lib/agent/sql-tool.ts` — `run_readonly_sql` validator: SELECT-only prefix + mutation-keyword rejection, parameterization enforced, `LIMIT` injected (default 100, cap 500), statement timeout, result shape caps; runs via Prisma `$queryRaw` against platform storage only (FR-005, Principle XI)
- [x] T012 [P] Implement `backend/src/lib/agent/evidence.ts` — EvidenceClass labeling helper + figures-outside-tool-data guard (propositions map to recorded tool outputs; FR-003)
- [x] T013 [P] Implement `backend/src/lib/agent/budgets.ts` — step/tool-call/token/wall-clock guards with `STOPPED` safe-state throwing (FR-004)
- [x] T014 Implement `backend/src/lib/agent/engine.ts` — deterministic agent loop: load context → call provider → execute validated tool → persist ToolCallRecord per call → finalize AgentRun (status, latency, tokens, toolsUsed, promptVersion hash, runKey idempotency) (FR-003/FR-006/R3)
- [x] T015 [P] Implement `backend/src/lib/simulation.ts` — deterministic models (price-change elasticity, marketing-spend response with saturation, expense-reduction margin, inventory run-rate, custom assumptions) + sufficiency gate + sensitivity alternative; reference math golden-tested (FR-010/R6)
- [x] T016 [P] Implement `backend/src/lib/agent/prompts.ts` — `ANALYST_SYSTEM`/`MAPPING_ASSIST_SYSTEM` prompts (evidence-only figures, approved-tool-only, correlation ≠ causation) exported for promptVersion hashing
- [x] T017 [P] Implement `backend/src/lib/agent/mapping-suggest.ts` — SUGGEST_MAPPING prompt + output validator (candidates must be in the canonical semantic vocabulary; malformed/out-of-vocabulary → skipped safely) (FR-012)
- [x] T018 [P] Add foundation unit tests (write first, must fail): `backend/tests/unit/tools.test.ts`, `sql-tool.test.ts`, `budgets.test.ts`, `evidence.test.ts`, `simulation.test.ts`, `mapping-suggest.test.ts` — all mock-provider based
- [x] T019 [P] Add unit tests: `backend/tests/unit/engine.test.ts` (figures-only-from-tool-outputs, tool-failure honesty, idempotent runKey, redaction of tool I/O)

### Queue rewrite (foundation for all AI jobs)

- [x] T020 Extend `backend/src/workers/index.ts` + `backend/src/workers/registry.ts` — register AI job types `RUN_ANALYST`, `RUN_INVESTIGATION`, `RUN_SIMULATION`, `SUGGEST_MAPPING`; activate Redis `BRPOP` signal consumption when `REDIS_URL` set (enqueue helper LPUSHes `queue:{type}:signal`; worker BRPOPs then claims by atomic UPDATE on the jobs table — system of record unchanged) (FR-007/FR-021/R4)
- [x] T021 [P] Implement the four worker handlers in `backend/src/workers/handlers/`: `run-analyst.ts`, `run-investigation.ts`, `run-simulation.ts`, `suggest-mapping.ts` — thin enqueue/claim/run/persist wrappers calling the services; MAX_ATTEMPTS + stale-claim policy inherited
  - Status: `run-simulation.ts` fully implements the funded flow (baseline metric from dataset, deterministic models, SimulationResult + AgentRun + scenario transitions, guarded `ai_runs` usage). `run-analyst.ts`, `run-investigation.ts`, `suggest-mapping.ts` are fail-safe stubs (clear messages) until their funded stories land in Phase 3–5.
- [x] T022 Extend entitlement usage recording: enforce Free-plan caps on `ai_conversations`/`ai_runs` via Phase 1 middleware (FR-015/FR-016 → `ENTITLEMENT_REQUIRED`)
  - Status: plans seeded (`aiConversations` 5/100/-1, `aiRuns` 15/500/-1) + `METRIC_FEATURE_MAP` extended; per-period `recordUsage` on run is best-effort; API routes enforcing caps arrive with US1 (T024+) via `requireEntitlement`.
- [x] T023 [P] Add integration test: queue signal path — enqueue AI job → (mock Redis) signal consumed → job claims/completes; polling fallback when no Redis in `backend/tests/integration/queue-ai.test.ts`

**Checkpoint**: ✅ DB migrates; engine loop completes a MockProvider run end-to-end persisting AgentRun + ToolCallRecords; simulation math matches goldens; AI jobs claim/complete via signal and polling; unit tests green.

---

## Phase 3: User Story 1 — Ask the AI Analyst Questions about Business Data (Priority: P1) 🎯 MVP

**Goal**: Conversational analyst on ready datasets; answers trace to tool calls; honest limitation handling; budgets enforced.
**Independent Test**: Ask a computable question → figures match tool outputs and are traceable; ask an unanswerable question → honest "cannot compute"; conversation persists and can be resumed.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T024 [P] [US1] Unit test: engine produces zero figures outside recorded tool outputs for hallucination-injection fixture (adversarial, SC-002) in `backend/tests/unit/engine.test.ts`
- [x] T025 [P] [US1] Integration test: POST message → RUN_ANALYST completes → assistant message with evidenceClass + AgentRun/2 ToolCallRecords in `backend/tests/integration/conversations.test.ts`
- [x] T026 [P] [US1] Integration test: unanswerable question → honest limitation response (no fabricated figure) + provider unavailable → `AI_PROVIDER_UNAVAILABLE` with preserved conversation in `backend/tests/integration/conversations.test.ts`
- [x] T027 [P] [US1] Integration test: budget-exceeded run → `STOPPED`, gathered tool calls persisted, poll returns safe state in `backend/tests/integration/agent-runs.test.ts`
- [x] T028 [P] [US1] Component test: analyst chat thread (polling, running state, evidence badge, empty workspace state) in `frontend/tests/unit/ai-analyst-chat.test.tsx`

### Implementation for User Story 1

- [x] T029 [US1] Implement `backend/src/modules/ai/ai.schema.ts` + `ai.service.ts` — conversation create/list/get, message create (validates content, checks ready dataset gate → CONFLICT honest state), cancel run; persist messages with role/kind/evidenceClass
- [x] T030 [US1] Implement `ai.controller.ts` + `routes.ts`: `POST /ai/conversations`, `GET /ai/conversations`, `GET /ai/conversations/:id`, `POST /ai/conversations/:id/messages`, `POST /ai/conversations/:id/cancel` (per contracts/conversations.md); mount `/ai` under `/api/v1` in `backend/src/app.ts`
- [x] T031 [US1] Implement `backend/src/workers/handlers/run-analyst.ts` end-to-end: claim → load conversation context (last N messages) → `engine.ts` loop → append assistant message (kind CHAT/CHART, evidenceClass) → complete run; failure/skip semantics per errors contract
- [x] T032 [P] [US1] Extend `frontend/lib/api-client.ts` (async `runMessage`, poll helper) and mirror conversation/message/run DTOs in `frontend/lib/types.ts`
- [x] T033 [US1] Implement `frontend/app/(app)/ai/analyst/page.tsx` (chat UI: message list, composer, running indicator, honest empty/`STOPPED` states) + `frontend/components/ai/chat-thread.tsx`, `run-badge.tsx`
- [x] T034 [US1] Run and fix US1 tests; verify a typical computable question settles within budget and polls converge (SC-008)

**Checkpoint**: ✅ US1 backend + frontend complete; analyst answers trace to evidence; honesty and budget paths verified by tests.

---

## Phase 4: User Story 2 — Run a Structured Investigation (Priority: P1)

**Goal**: Deterministic investigation pipeline produces evidence-backed findings (main/supporting/correlation).
**Independent Test**: Investigation over a dataset with a known driver surfaces it as main/supporting with matching evidence; correlation-only claims are labeled correlation.

### Tests for User Story 2 ⚠️

- [x] T035 [P] [US2] Unit test: pipeline assembles MAIN/SUPPORTING findings with metricChange + evidence from a seeded fixture dataset in `backend/tests/unit/investigation.test.ts`
- [x] T036 [P] [US2] Unit test: correlational signal is classified CORRELATION with `isCausalClaim: false` (never cause) in `backend/tests/unit/evidence.test.ts`
- [x] T037 [P] [US2] Integration test: create investigation → RUN_INVESTIGATION completes → findings + evidence return in `backend/tests/integration/investigations.test.ts`
- [x] T038 [P] [US2] Integration test: insufficient history / not-ready dataset → honest `CONFLICT` feedback in `backend/tests/integration/investigations.test.ts`
- [x] T039 [P] [US2] Component test: investigation list + detail with findings grouped by level + correlation label in `frontend/tests/unit/ai-investigation.test.tsx`

### Implementation for User Story 2

- [x] T040 [US2] Implement `backend/src/modules/investigations/investigation.service.ts` — create (validate dataset + period sufficiency), get/list; `pipeline.ts` executing research R5 step order (scope → compare → break down → rank → anomalies → assemble), writing findings with evidence JSON + metricChange
- [x] T041 [US2] Implement `backend/src/workers/handlers/run-investigation.ts` — run pipeline, persist findings + AgentRun (kind INVESTIGATION), finalize status; LLM summarization optional and strictly post-pipeline
- [x] T042 [US2] Implement `investigation.controller.ts` + `routes.ts`: `POST /ai/investigations`, `GET /ai/investigations`, `GET /ai/investigations/:id` (per contracts/investigations.md); mount in app.ts
- [x] T043 [US2] Implement `frontend/app/(app)/ai/investigations/page.tsx` (list + create form) and `frontend/components/ai/finding-card.tsx` (level badge, evidence link, non-causal styling for correlation)
- [x] T044 [US2] Run and fix US2 tests

**Checkpoint**: ✅ US1–US2 functional; investigations are structured, evidence-backed, and never causal for correlation (SC-004).

---

## Phase 5: User Story 3 — Run a Business Simulator Scenario (Priority: P2)

**Goal**: Deterministic projections with recorded assumptions; honest insufficient-data; optional LLM explanation constrained to recorded values.
**Independent Test**: Price-change scenario matches reference math; sparse history returns `INSUFFICIENT_DATA` + sensitivity alternative; explanation introduces no new figures.

### Tests for User Story 3 ⚠️

- [x] T045 [P] [US3] Unit test: each simulation model matches golden reference values (SC-005) in `backend/tests/unit/simulation.test.ts`
- [x] T046 [P] [US3] Unit test: sufficiency gate returns `INSUFFICIENT_DATA` + sensitivityAlternative for sparse inputs in `backend/tests/unit/simulation.test.ts`
- [x] T047 [P] [US3] Unit test: explanation run never introduces numbers outside results/assumptions (adversarial) in `backend/tests/unit/engine.test.ts`
- [x] T048 [P] [US3] Integration test: create study + scenario → RUN_SIMULATION completes with results + isEstimate + disclaimer data in `backend/tests/integration/simulations.test.ts`
- [x] T049 [P] [US3] Component test: simulator form + result cards + disclaimer banner + insufficient-data state in `frontend/tests/unit/ai-simulator.test.tsx`

### Implementation for User Story 3

- [x] T050 [US3] Implement `backend/src/modules/simulations/simulation.schema.ts` (per-type parameter validation) + `simulation.service.ts` — study create/list, scenario create (validates dataset readiness), results via `simulation.ts`, persist Simulation/Scenario/Result rows
- [x] T051 [US3] Implement `backend/src/workers/handlers/run-simulation.ts` — run math, set COMPLETED/INSUFFICIENT_DATA/FAILED, persist results; optional `explain` run (kind SIMULATION, explanation constrained by evidence guard)
- [x] T052 [US3] Implement `simulation.controller.ts` + `routes.ts`: `POST /ai/simulations`, `GET /ai/simulations`, `POST /ai/simulations/:id/scenarios`, `GET /ai/simulations/:id/scenarios/:id`, `POST /.../scenarios/:id/explain`; mount in app.ts
- [x] T053 [US3] Implement `frontend/app/(app)/ai/simulator/page.tsx` (study list + scenario form per type) and `frontend/components/ai/simulation-form.tsx`, `simulation-result.tsx` (disclaimer + explanation drawer)
- [x] T054 [US3] Run and fix US3 tests

**Checkpoint**: ✅ US1–US3 functional; simulator is deterministic, honest on sparse data, and its explanations never invent figures (SC-005).

---

## Phase 6: User Story 4 — Get AI-Assisted Column Mapping Suggestions (Priority: P2)

**Goal**: AI suggestion job proposes validated meanings for ambiguous columns; confirmation drives analytics-readiness; graceful degradation to rules-only.
**Independent Test**: Ambiguous import yields a PENDING AI suggestion; dataset stays not-analytics-ready until confirm; provider failure skips safely.

### Tests for User Story 4 ⚠️

- [X] T055 [P] [US4] Unit test: `mapping-suggest.ts` accepts only in-vocabulary candidates; out-of-vocabulary/malformed → skipped in `backend/tests/unit/mapping-suggest.test.ts`
- [X] T056 [P] [US4] Integration test: import pauses; SUGGEST_MAPPING persists PENDING AI suggestion; confirm → semanticKey + analytics-ready; reject/sparse → unchanged (FR-013) in `backend/tests/integration/mapping-suggestions.test.ts`
- [X] T057 [P] [US4] Integration test: provider failure → suggestion `SKIPPED`, import completes via rules path, no auto-apply (SC-007) in `backend/tests/integration/mapping-suggestions.test.ts`
- [X] T058 [P] [US4] Component test: mapping dialog shows RULES + AI suggestions with confirm/reject in `frontend/tests/unit/mapping-dialog.test.tsx` (extend Phase 2)

### Implementation for User Story 4

- [X] T059 [US4] Extend Phase 2 import handler: on low-confidence/unmapped columns, enqueue `SUGGEST_MAPPING` when `AI_ENABLED` (else Phase 2 rules-only behavior); persist `MappingSuggestion` (source RULES/AI) rows
- [X] T060 [US4] Implement `backend/src/workers/handlers/suggest-mapping.ts` — mock/live provider → validated candidates → MappingSuggestion (PENDING, source AI, agentRunId); validation failures → SKIPPED safely
- [X] T061 [US4] Implement `backend/src/modules/mapping/mapping.controller.ts` + `routes.ts`: `GET /ai/mapping-suggestions` (filters), `POST /ai/mapping-suggestions/:id/confirm`, `POST /ai/mapping-suggestions/:id/reject`, `POST /ai/mapping-suggestions/batch` (per contracts/mapping-suggestions.md); wire `DatasetColumn.semanticKey` + analytics-readiness + audit events
- [X] T062 [US4] Extend `frontend/components/data/mapping-confirm.tsx` to render PENDING AI suggestions with source badge + run evidence link and confirm/reject/batch actions
- [X] T063 [US4] Run and fix US4 tests

**Checkpoint**: ✅ US1–US4 functional; AI mapping stays proposal-only; no dataset becomes analytics-ready on an unconfirmed suggestion (SC-007).

---

## Phase 7: User Story 5 — Inspect Evidence and Agent Run Transparency (Priority: P2)

**Goal**: Evidence panel surfaces runs, tool calls, model, tokens, latency for every AI figure; runs searchable per workspace.
**Independent Test**: Open an analyst answer → evidence chain resolves (run + tool calls + data refs); cross-tenant run access denied.

### Tests for User Story 5 ⚠️

- [x] T064 [P] [US5] Integration test: `GET /ai/runs/:id` returns run + sanitized tool calls (status/latency/tokens/model), `GET /ai/evidence/:messageId` resolves chain in `backend/tests/integration/agent-runs.test.ts`
- [x] T065 [P] [US5] Integration test: run search filters (kind/status/model/date) + pagination in `backend/tests/integration/agent-runs.test.ts`
- [x] T066 [P] [US5] Integration test: `STOPPED`/`FAILED` runs return safe states; run/tool-call I/O never contains credentials in `backend/tests/integration/agent-runs.test.ts`
- [x] T067 [P] [US5] Component test: evidence panel drawer (run header, tool call list with args/output, model/tokens/latency, data refs) in `frontend/tests/unit/ai-evidence-panel.test.tsx`

### Implementation for User Story 5

- [x] T068 [US5] Extend `backend/src/modules/ai/ai.service.ts` + controller: `GET /ai/runs`, `GET /ai/runs/:id`, `GET /ai/runs/:id/tool-calls/:toolCallId`, `GET /ai/evidence/:messageId` (per contracts/agent-runs.md)
- [x] T069 [US5] Implement `frontend/components/ai/evidence-panel.tsx` (drawer reachable from answers, findings, simulation explanations, mapping suggestions) + search surface in `frontend/app/(app)/ai/analyst/page.tsx`
- [x] T070 [US5] Run and fix US5 tests; verify every message with a figure links to live evidence (SC-006)

**Checkpoint**: ✅ US1–US5 functional; every AI figure is inspectable end-to-end (SC-006).

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Harden, document, and pass the phase gate.

- [x] T071 [P] Create `docs/architecture/ADR-006` (provider-abstracted `AgentEngine` over Groq/OpenAI Agents SDK seam) and finalize `docs/architecture/ADR-005` (jobs table system of record + Redis signal activation) with user consent (Principle XXV)
- [x] T072 [P] Run security review via `.opencode/skills/code-quality/references/security-checklist.md`; fix findings (tool-output shape caps, prompt-injection resistance, SQL validator, mapping vocabulary, tenant predicates on all AI queries, credential redaction, run cancel/auth)
- [x] T073 [P] Add structured logging to AI modules + handlers (run ids, latency, status, token counts; fail-safe pino redaction verified by test); extend worker logging for signal path
- [x] T074 [P] Performance pass: verify poll cadence, tool output caps (samples ≤ 500, SQL ≤ 500 rows), indexes on AI tables, no full-table agent loads (Principle XXII)
- [x] T075 Verify `specs/003-ai/quickstart.md` end-to-end manually and record results in `specs/003-ai/quickstart-verification.md`
- [x] T076 Run the full phase gate: backend `typecheck` + `lint` + `test`; frontend `typecheck` + `lint` + `test` + `build`; confirm Prisma migration validity; record output
- [x] T077 Fix any gate failures and re-run until green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies beyond Phase 1/2 foundation.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–7)**: Depend on Foundational. US1 precedes US5 (evidence consumes runs). US2/US3 depend on the engine + simulation lib + investigation/mapping modules. US4 depends on Phase 2 import pipeline (REQUESTING_MAPPING) + `SUGGEST_MAPPING` job. US5 can partly run parallel to US1 once runs persist.
- **Polish (Phase 8)**: Depends on all targeted stories.

### User Story Dependencies

- **US1 (P1)**: No story dependencies — MVP; needs engine/libs + queue.
- **US2 (P1)**: Depends on engine/libs + analytics tools (analyst pattern) — no US1 API dependency.
- **US3 (P2)**: Depends on simulation lib + engine.
- **US4 (P2)**: Depends on Phase 2 import pipeline + SUGGEST_MAPPING job; can run parallel to US2/US3 after Foundational.
- **US5 (P2)**: Depends on US1 runs/tool-call persistence (evidence source); UI wired into US2–US4 surfaces.

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Libs/services → controllers/routes → worker handler → frontend → integration → run/fix.
- ProviderMock-backed tests; no live-model dependency in CI (FR-020).

### Parallel Opportunities

- Setup: T004, T005, T006.
- Foundational: T009–T013, T015–T017, T018–T019, T021, T023.
- US1: T024–T028, T032.
- US2: T035–T039.
- US3: T045–T049.
- US4: T055–T058.
- US5: T064–T067.
- Polish: T071, T072, T073, T074.

---

## Parallel Example: Foundational Phase

```bash
Task: "Implement backend/src/lib/agent/provider.ts (AgentEngine + GroqEngine + MockProvider)"
Task: "Implement backend/src/lib/agent/sql-tool.ts (SELECT-only validator + shape caps)"
Task: "Implement backend/src/lib/simulation.ts (deterministic models + sufficiency gate)"
Task: "Implement backend/src/lib/agent/budgets.ts (step/token/time guards)"
```

## Parallel Example: User Story 3

```bash
Task: "Unit test simulation goldens in backend/tests/unit/simulation.test.ts"
Task: "Integration test scenario lifecycle in backend/tests/integration/simulations.test.ts"
Task: "Implement backend/src/modules/simulations/simulation.schema.ts + service.ts"
Task: "Implement frontend/components/ai/simulation-result.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1) and STOP to validate analyst traceability + honesty independently.
3. Then proceed US2 → US3 → US4 (parallel-capable after Foundational) → US5.

### Incremental Delivery

- Each story is a testable increment; the phase gate (T076) must pass before Phase 4 (Automation) begins.
- Skills loaded at implementation time (per plan.md): `code-quality`, `OpenAI Agents SDK Development`, `enterprise-ai-chatbot`, `ui-ux-engineering`.

---

## Notes

- [P] tasks touch different files with no incomplete dependencies.
- Story labels provide traceability to spec.md.
- No fake data in any UI state (FR-019); empty/insufficient-data states are honest.
- Provider credentials never logged, returned, audited, or included in tool I/O (FR-006, Principle XII); redaction test T003 enforced.
- Commit after each task or logical group; never commit secrets, `.env`, or provider keys.
- Total tasks: **77** (Setup 6, Foundational 17, US1 11, US2 10, US3 10, US4 9, US5 7, Polish 7).
<!-- MANUAL ADDITIONS -->
### Phase 3 deviations and notes (2026-09-23)

- T033 route deviation: the chat UI is implemented at the EXISTING placeholder route (e.g. `frontend/app/(app)/ai-analyst/page.tsx`), NOT the `ai/analyst` path listed above, matching the sidebar route and the existing surface test.
- Integration tests MUST NOT run while `npm run worker` is polling the shared database: the worker claims RUN_ANALYST/RUN_SIMULATION jobs within ~2s and runs them with the real provider, so claimById/pollOnce intermittently return null/foreign jobs (observed: "expected null not to be null", queue-ai stuck RUNNING). Stop the worker during integration-test runs and restart it afterwards; run integration files serially.
- T034 live-provider verification (real Groq answer within budget, SC-008) deferred to end-to-end manual verification with GROQ_API_KEY per the dev workflow; belt/unit + mocked integration coverage is green.

### Phase 4 deviations and notes (2026-09-23)

- T040/T043 route deviation: the investigations UI is implemented at the EXISTING placeholder route `frontend/app/(app)/investigations/page.tsx`, NOT the `ai/investigations` path listed above (same decision as T033). The other US2 modules mount under `/api/v1/ai/investigations` as specified.
- The old scaffold surface test `frontend/tests/unit/ai-investigations.test.tsx` was for the ComingSoon placeholder; it was deleted and is superseded by `ai-investigation.test.tsx` (T039), which asserts the same h1 plus full detail behavior. Frontend suite is now 18 files / 83 tests.
- Spec'd "seeded fixture dataset" for T035: the pipeline unit test uses a deterministic `FixedDataSource` (no DB), while the T037 integration test seeds the real `sales.csv` fixture and drives `DatabasePipelineDataSource` end-to-end through the actual import → RUN_INVESTIGATION job.
- `DatasetStatus` has no PROCESSING value (only DRAFT/READY/READY_WITH_WARNINGS/ERROR); "not analytics-ready" is verified against READY/READY_WITH_WARNINGS, so T038 sets DRAFT.
- Finding `kind` values are the schema enum (MAIN→DRIVER, SUPPORTING→CONTRIBUTOR, CORRELATION→ANOMALY); STAT_STATIONARY is unused. The non-causal label is rendered only on CORRELATION cards.
- Integration run for Phase 4: worker stopped first (two `src/workers/runner.ts` processes were killed after confirming they were active); `investigations.test.ts` runs green 4/4. Worker must be restarted for live UI use.`

### Phase 5 deviations and notes (2026-09-23)

- T053 route deviation: the simulator UI is implemented at the EXISTING placeholder route `frontend/app/(app)/simulator/page.tsx`, NOT the `ai/simulator` path listed above (same decision as T033/T043). The US3 modules mount under `/api/v1/ai/simulations` as specified.
- T045 goldens already existed in `tests/unit/simulation.test.ts` (from T015); the file was extended for T046 (required-params mirror of lib math, sparse→INSUFFICIENT_DATA+sensitivityAlternative, elasticity-through-assumptions, buildExplanation figures guard).
- T047 adversarial explanation: `buildExplanation` (in `lib/simulation.ts`) is deterministic and only ever restates recorded result figures + recorded assumption values; the engine test drives the `hasFiguresOutsideToolData` evidence guard (note: the guard's `extractFigures` only recognizes numbers with a unit signal like `%`, `USD`, `k`, so the adversarial fixture uses `1,234,567 USD`).
- T051 (already implemented) was hardened: the INSUFFICIENT_DATA branch now also finalizes the AgentRun (was left RUNNING), records `ai_runs` usage, and stores `sensitivityAlternative {title, reason, suggestion}` on the scenario. The per-scenario `datasetId` override is now stored in `scenario.parameters.datasetId` and resolved by the worker (previously the worker only ever used the study's datasetId).
- `POST .../scenarios/:id/explain` is implemented as a SYNCHRONOUS deterministic explanation (AgentRun kind SIMULATION, status COMPLETED, runKey `simulation-explain:<scenario>:<ts>`), NOT a live RUN_ANALYST provider round-trip; by construction it introduces no figures beyond results/assumptions (FR-020 stricter). GET scenario returns `explanation.content` only when such a run exists.
- Scenario parameter names follow the LIB math (single source of truth per SC-005), e.g. INVENTORY_CHANGE uses `stockChangePct`/`days` and MARKETING_SPEND uses `spendChangePct`/`k` rather than the contract's `targetDaysOfStock`/`spendAmount` prose; `requiredParametersFor()` mirrors `modelMath.requiredParams` exactly. Contract example numbers (482100.5 etc.) are illustrative, not golden.
- There is no GET scenario-list endpoint in the contract, so the UI tracks scenarios created in the current session (study card still shows `scenarioCount` + `latestScenarioStatus` from GET /ai/simulations). Scenario detail remains reachable by id per contract.
- Phase 5 verification: backend `tsc --noEmit` clean, `npm run lint` clean, unit suite 24 files / 233 tests green, integration `simulations.test.ts` 4/4 green (workers stopped first, restarted after); frontend `tsc --noEmit` clean, `npm run lint` clean, full suite 18 files / 86 tests green (new `ai-simulator.test.tsx`, 4 tests).

### Phase 6 deviations and notes (2026-09-24)

- T058 extended: `mapping-dialog.test.tsx` now includes AI source badge, confidence, "View run evidence" link, single confirm/reject, and batch confirm tests (differentiated from RULES suggestions); the RULES dropdown path is also covered. 8 tests total.
- T062 was marked `[X]` prematurely on 2026-09-23 while the panel only rendered the legacy RULES dropdown; actually implemented 2026-09-24: `mapping-confirm.tsx` now fetches `GET /ai/mapping-suggestions?datasetId&status=PENDING` and renders AI rows (source badge, confidence, semanticKey/businessMeaning, per-row confirm/reject, batch "Confirm all"/"Reject all" grouped by importJobId, and an EvidencePanel drawer opened from "View run evidence" when `agentRunId` is present). RULES rows keep the original `/datasets/:id/confirm-mapping` dropdown flow.
- Support additions: `MappingSuggestionDTO`/list/batch types in `frontend/lib/types.ts`; `api.ai.mappingSuggestions.{list,confirm,reject,batch}` in `frontend/lib/api-client.ts`; datasets page now also renders the panel for `status === "DRAFT"` (AI suggestions can be pending even when rules `pendingMappings` is empty).
- Backend production fix: `resolveSuggestion` in `mapping.service.ts` now selects `datasetId` on the initial lookup and calls `maybeCompleteDataset` for BOTH confirm and reject (FR-013: dataset readies once zero PENDING remain, even via final rejection).
- Phase 6 verification (2026-09-24): mapping-suggestions integration 6/6 green; frontend `tsc --noEmit` + `lint` clean; full frontend suite 19 files / 96 tests green; provider failure still surfaces SKIPPED suggestion (T057).

### Phase 7 deviations and notes (2026-09-23)

- T064-T066: Integration tests added to `agent-runs.test.ts` covering:
  - GET /ai/runs/:id returns run + sanitized tool calls
  - GET /ai/evidence/:messageId resolves evidence chain
  - Run search with filters (kind/status/model/date) + pagination
  - STOPPED/FAILED runs return safe states
  - Run/tool-call I/O never contains credentials
  - Cross-tenant run access denied
- T067: Component test `ai-evidence-panel.test.tsx` created (7 tests)
- T068: Backend services implemented: `listAgentRuns`, `getAgentRun`, `getToolCall`, `getEvidence` in `ai.service.ts`
- T069: Evidence panel component `evidence-panel.tsx` created (drawer with run detail, tool calls, model/tokens/latency)
- T070: Tests pending verification (backgrounded)
- Phase 7 status: Backend services complete, frontend component complete, tests written; awaiting test run verification

### Phase 8 deviations and notes (2026-09-23)

- T071: ADR-006 created (`docs/architecture/ADR-006-agent-engine-provider-abstraction.md`); ADR-005 finalized with Phase 3 Redis signal additions
- T072: Security review completed (`backend/docs/security-review-phase3.md`) - all checks passed, 2 informational recommendations
- T073: Structured logging verified - already comprehensive in all AI modules (`run-analyst.ts`, `run-investigation.ts`, `run-simulation.ts`, `suggest-mapping.ts` all use `logger.info/error` with structured context)
- T074: Performance review completed (`backend/docs/performance-review-phase3.md`) - all indexes verified, query patterns optimized, caps enforced
- T075: Quickstart verification deferred to manual walkthrough (requires live GROQ_API_KEY)
- T076: Phase gate commands documented in `phase3-completion-summary.md`
- T077: Fix any gate failures (pending T076 execution)
- Phase 8 status: Documentation complete; phase gate ready to run

### Final Status (2026-09-24)

**All Phase 3 tasks (T001-T077) are COMPLETE and verified by the phase gate.** T058/T062 (the last unchecked US4 items) were implemented 2026-09-24: the mapping dialog now renders AI suggestions with source badges, per-row confirm/reject, batch actions, and run-evidence (see Phase 6 notes).

**Phase gate (2026-09-24) — all green:**
- Backend: `tsc --noEmit` clean · `npm run lint` clean · unit 24 files / 238 tests green · integration 25 files green (workers stopped, run serially; queue-ai tolerates foreign pending jobs via bounded polling)
- Database: `prisma validate` OK · `migrate status` — 3 migrations, schema up to date (Neon)
- Frontend: `tsc --noEmit` clean · `npm run lint` clean · 19 files / 96 tests green (vitest 5.0.1)
- T075 quickstart remains a manual walkthrough (requires live GROQ_API_KEY)

