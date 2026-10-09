# Research: Phase 3 — AI Layer

**Feature**: `003-ai`
**Status**: Draft (pending user verification)
**Date**: 2026-09-22
**Source of truth**: root `research.md` §7 (AI agent/tool architecture), §8 (simulator architecture), §9 (queue architecture), §14 (roadmap) + `architecture.md` + `.specify/memory/constitution.md`
**Scope**: Resolve the Phase 3 technical questions R1–R8 documented below. Design documents only — no code locked before user verification.

---

## R1 — AI framework and provider (Groq + OpenAI Agents SDK)

The data layer deliberately deferred all AI to Phase 3; `research.md` §7 defines the agent types, and the constitution (Technology Stack) mandates "OpenAI Agents SDK with Groq API as the model provider," provider-abstracted.

Decision: build a thin, internally-owned **`AgentEngine`** seam over an OpenAI-compatible client pointed at **Groq** (`https://api.groq.com/openai/v1`, key `GROQ_API_KEY`). The engine owns the tool loop, budgets, evidence labeling, and persistence (matching constitution V, VI, VIII) rather than delegating the whole loop to a file-chat SDK. The OpenAI Agents SDK is the adherence point — implementers will first try its TypeScript package against Groq; if that package is not available for this runtime, the same interface is backed by the plain OpenAI-compatible SDK (`openai` npm / Groq endpoint) behind the identical `AgentEngine` interface. Model name, temperature, max tokens, budget, and timeout come from config (`AI_MODEL`, `AI_MAX_TOOL_CALLS`, `AI_TIMEOUT_MS`, `AI_MAX_STEPS`).

Key constraints resolved:
- Provider only ever receives: tool definitions + tool results + the current question. It never receives credentials, raw file contents, or cross-tenant data (Principle II, IV, XIII).
- Tool-call responses are validated (schema + shape caps) before the provider sees them (Principle XI: "Never trust AI-generated SQL", and §7 LLM boundaries).
- Every turn is recorded in `AgentRun` + `ToolCallRecord` (Principle XXI, VIII).

**Decision**: Internal `AgentEngine` abstraction; OpenAI-compatible client on Groq; OpenAI Agents SDK as the framework adherence point when its TS package is available; config-driven model/budgets.

---

## R2 — Tool catalog and validation boundary

Tools from `research.md` §7, implemented as pure functions over the existing analytics/data modules (never over raw customer DBs):

```text
get_workspace_datasets()          -> list of workspace datasets (id, name, kind, rows, status)
get_dataset_schema(datasetId)     -> typed columns + semantic keys
get_dataset_sample(datasetId, n)  -> bounded sample rows (LIMIT)
run_readonly_sql(query)           -> validated SELECT over platform storage
calculate_metric(metric, filters) -> aggregation via analytics-sql builders (SUM/AVG/COUNT/MIN/MAX)
compare_periods(metric, A, B)     -> period-over-period change
group_by_dimension(metric, dim)   -> breakdown with LIMIT
find_top_entities(metric, dim, k) -> top/bottom k by value
find_anomalies(metric, period)    -> IQR/deviation check (basic; full detector is Phase 4)
generate_chart_spec(data)         -> chart config from tool data (renders in UI)
get_business_context()            -> workspace context blurb (datasets present, quality gates)
```

Validation boundary (all deterministic, unit-tested):
- **`run_readonly_sql`** is the only free-SQL tool and is strictly gated: SELECT-only prefix check + mutation-keyword rejection (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE/COPY/EXPLAIN — anything that mutates), parameterization enforced, `LIMIT` injected (default 100, cap 500), statement timeout, result shape capped (columns bound, rows bound) before reaching the model. It runs **only against the platform's own PostgreSQL** dataset storage via Prisma `$queryRaw` (read-only), never against customer/external databases.
- Tool args are Zod-validated; tool outputs are schema + shape-capped; failures produce a structured "tool failed" result rather than a free-form error that the model might guess around.
- Dataset/column identifiers are validated against the workspace's own resources (Principle III) before any tool executes.

**Decision**: 11-tool catalog behind one `tools` registry; strict validation module (`validateReadOnlySql`, shape caps) reusing the Phase 2 `analytics-sql` builders and tenant scoping.

---

## R3 — Agent loop, budgets, and persistence

Agent loop (`engine.ts`): user message → load conversation context (last N messages) → tool loop with max steps → final assistant message, all under budget. Budgets are config: max steps (e.g., 10), max tool calls (e.g., 12), wall-clock timeout (e.g., 60 s), output caps. Any budget hit ends the run as `STOPPED` with a safe user-facing message and persists everything gathered so far (never silent truncation into a wrong conclusion).

Persistence: one `AgentRun` per assistant turn (or per investigation/simulation/mapping job) recording agent type, model, status, latency, tokensUsed, toolsUsed, error; one `ToolCallRecord` per tool call with input/output/status/latency/error. Evidence classification is added to messages (content class OBSERVED|CALCULATED|INFERRED|PROJECTED|RECOMMENDED) so the UI can label figures.

Idempotency: each run carries a `runKey` (workspaceId+conversationId+nonce) so retried jobs do not duplicate runs.

**Decision**: Deterministic loop in `engine.ts`; budgets and persistence as above; runs idempotent via `runKey`.

---

## R4 — Queue rewrite (Redis signal layer vs jobs table)

Constitution mandates Redis/Upstash for background work; `research.md` §9 keeps the `jobs` table as the system of record with Redis purely as signal ("rewrites to queues" roadmap item).

Decision: keep the Phase 1/2 jobs-table-as-system-of-record design (ADR-005 made explicit), and in Phase 3:
- Register new job types: `RUN_ANALYST`, `RUN_INVESTIGATION`, `RUN_SIMULATION`, `SUGGEST_MAPPING`.
- Activate the **Redis signal layer**: worker BRPOPs `queue:{type}:signal` for jobs the app LPUSHes at enqueue; the worker still claims by atomic UPDATE on the jobs table (system of record). When `REDIS_URL` is not configured, the worker falls back to table polling (as in Phase 2). No behavior change for jobs that already exist (`IMPORT_DATA`, `SYNC_DATABASE`).
- Agent runs are enqueued as jobs (`RUN_ANALYST`, etc.) — never executed in the request path (Principle X); the conversation UI polls `GET /api/v1/ai/conversations/:id` or message list until the run completes.
- Stale-claim timeout (same policy as imports) and `MAX_ATTEMPTS` with safe failure states.

This resolves "rewrites to queues" within the ratified architecture (no new queue technology; `ioredis` already a Phase 2 dependency).

**Decision**: Jobs table remains system of record; add AI job types; activate optional Redis BRPOP signal; polling fallback without Redis; agent runs always enqueued.

---

## R5 — Investigation workflow (structured, not chat)

`research.md` §7: investigation is structured. Decision:
- `INVESTIGATION` job runs an explicit procedural pipeline (deterministic, in our code — not a free chat): (1) scope the metric/dataset + baseline vs target period, (2) compute the overall delta via `calculate_metric`/`compare_periods`, (3) break the delta down by available dimensions via `group_by_dimension` (drill in order of cardinality), (4) rank contributors by absolute contribution, (5) run `find_anomalies` for supporting signals, (6) assemble `InvestigationFinding` rows (MAIN/SUPPORTING/CORRELATION) with evidence JSON (calculation, SQL, dataset, period, values) and a metricChange.
- An LLM step may summarize and phrase the findings within the dialogue, but the findings' numbers and classification come from steps 1–5; the LLM cannot add findings.
- Correlation-only signals are labeled CORRELATION and the UI prohibits causal phrasing.

**Decision**: Deterministic pipeline assembles findings; LLM is limited to summarization of already-computed findings.

---

## R6 — Simulation engine (deterministic math, LLM explains only)

`research.md` §8 design, implemented as pure functions (`simulation.ts`):
- Sufficiency gate first: requires minimum sample size and period coverage per model; else `INSUFFICIENT_DATA` + a sensitivity alternative.
- Models (deterministic, unit-tested against reference math):
  - Price change → elasticity estimate (log-log OLS or mid-point elasticity) on historical price/qty.
  - Marketing spend → spend-response estimate (linear/log fit with saturation cap).
  - Expense reduction → margin arithmetic (pure).
  - Inventory → run-rate depletion (pure).
  - Custom → user-supplied assumptions, labeled as such.
- Outputs: `SimulationResult` rows (currentValue, projectedValue, changePct, confidence, isEstimate), `assumptions` (recorded), disclaimer in UI.
- LLM involvement: an optional `explain_simulation` tool renders an interpretation **restricted to the recorded values**; an engine-level check asserts the LLM explanation introduces no new numeric literals outside the values provided (adversarial test).

**Decision**: `simulation.ts` math engine; sufficiency + sensitivity gate; LLM explanation constrained to recorded values; results persisted.

---

## R7 — AI-assisted mapping suggestions

Phase 2 mapping is deterministic-only (R4 of data layer). Phase 3 adds an AI assist that stays a *proposal*:
- When `mapping-rules` marks a column LOW confidence/unmapped during an import/sync handler, the worker enqueues a `SUGGEST_MAPPING` job (only when the provider is configured).
- The suggestion job sends the column name, sample values, type, and the canonical semantic vocabulary to the model and asks for a constrained candidate list. Output is validated: candidates must be in the approved vocabulary (or validated dataset-specific labels with reason), each with a confidence; malformed/unvetted output → job fails safely, no mapping applied.
- `MappingSuggestion` rows (source RULES|AI, status PENDING) persist. The existing mapping-confirm dialog shows pending suggestions; confirm/reject updates `DatasetColumn.semanticKey` + suggestion status + dataset analytics-readiness.
- FR-013 semantics: the dataset stays not-analytics-ready for that column until confirmation.

**Decision**: `SUGGEST_MAPPING` job → validated `MappingSuggestion` rows → user confirmation drives readiness; provider absence degrades gracefully to rules-only (Phase 2 behavior).

---

## R8 — Frontend surfaces and streaming

- Routes under the existing shell (`app/(app)/`): `ai/analyst` (chat), `ai/investigations` (list + detail), `ai/simulator` (form + results), plus wiring of mapping suggestions into the existing `data-hub/data-sources` mapping dialog and an AI **Evidence panel** (opens run/tool-call records) reachable from answers/findings.
- No SSE in v1: the conversation/message UI polls the REST endpoints every ~2 s (reusing the Phase 2 polling pattern from import status); the jobs table is the source of truth for "run running".
- Charts suggested by the agent render through the existing `recharts` wrappers (dashboard chart components), fed only by tool data (`generate_chart_spec`).
- Empty/insufficient-data states reuse `components/signals/*`.

**Decision**: Poll-based chat/run progression (no SSE v1), recharts reuse for agent charts, evidence panel as a shared component.

---

## Resolved / open questions

Resolved for Phase 3:
1. **Provider**: Groq (OpenAI-compatible) behind an internal `AgentEngine` seam; OpenAI Agents SDK as adherence point when its TS package is available.
2. **Queues**: jobs-table system of record retained; Redis activated as signal only; new job types `RUN_ANALYST|RUN_INVESTIGATION|RUN_SIMULATION|SUGGEST_MAPPING`.
3. **Tool scope**: 11 approved tools; free-SQL gated and validated read-only against platform storage only.
4. **Investigation**: deterministic pipeline produces findings; LLM summarizes, cannot add findings.
5. **Simulator**: deterministic math models + sufficiency gate; LLM explanation constrained to recorded values.
6. **Mapping assist**: proposal-only `MappingSuggestion`; confirmation flips analytics-readiness.

Deferred (defaults chosen):
- SSE/streaming chat (poll in v1; SSE possible later without model changes).
- Full anomaly-detection worker and recommendations (Phase 4); alerts/reports/email (Phase 4).
- Model fine-tuning, function-calling eval harness, prompt-versioning — consumed by the Phase 5 AI evaluation harness; ToolCallRecords are the raw material for it.
- Multi-provider runtime switching UI (env/provider config only in Phase 3).

---

*Research gate for this phase: resolved questions above feed plan.md, data-model.md, contracts/, and tasks.md after user verification.*