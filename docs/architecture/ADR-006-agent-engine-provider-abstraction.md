# ADR-006: Agent Engine Provider Abstraction

**Status**: Accepted  
**Date**: 2026-09-23  
**Phase**: 3 (AI Layer)  
**Deciders**: Engineering Team  

---

## Context

Phase 3 introduces AI-powered features (conversational analyst, investigations, simulations, mapping assistance) that require:

1. **Provider independence**: Ability to switch between AI providers (Groq, OpenAI, others) without changing application logic
2. **Testability**: Deterministic testing without live model calls (FR-020)
3. **Traceability**: Every AI-generated figure must trace to recorded tool outputs (FR-003, FR-006)
4. **Budget enforcement**: Hard limits on steps, tool calls, tokens, and wall-clock time (FR-004)
5. **Tool safety**: Closed catalog of validated tools with read-only SQL enforcement (FR-005, Principle XI)

The system must never fabricate data, must persist evidence for every claim, and must fail safely when budgets are exceeded.

---

## Decision

We implement a **provider-abstracted `AgentEngine` interface** with the following architecture:

### 1. AgentEngine Interface

```typescript
interface AgentEngine {
  readonly model: string;
  runOnce(context: AgentContext): Promise<AgentEngineResult>;
}
```

- **Single responsibility**: Execute one turn of the agent loop (call provider → return tool requests or final answer)
- **Stateless**: All context passed explicitly; no hidden provider state
- **Result types**: `tool-calls` (requires execution) or `final` (conversation complete)

### 2. Provider Implementations

**GroqEngine** (production):
- Wraps Groq's OpenAI-compatible API (`openai` npm package)
- Configured via `AI_BASE_URL`, `AI_MODEL`, `GROQ_API_KEY`
- Maps our tool definitions to OpenAI function-calling format
- Extracts tool calls or final content from chat completion responses

**MockProvider** (tests only):
- Scriptable scenarios with deterministic turn sequences
- Never calls live models (FR-020)
- Simulates timeout, budget exhaustion, malformed output, and hallucination injection
- Located in `tests/helpers/provider-mock.ts`

### 3. Agent Loop (`engine.ts`)

The deterministic loop orchestrates:

1. **Load context**: System prompt, user prompt, conversation history, tool results
2. **Call provider**: Via `AgentEngine.runOnce()`
3. **Execute tools**: Validate requests, run against closed tool catalog, cap output sizes
4. **Record evidence**: Persist `ToolCallRecord` per call with arguments + sanitized output
5. **Enforce budgets**: Check steps, tool calls, tokens, wall-clock time; throw `STOPPED` on breach
6. **Finalize run**: Write `AgentRun` (status, latency, tokens, `toolsUsed`, `promptVersion` hash, `runKey` idempotency)

**Guarantees**:
- Every tool call is recorded before the next provider round-trip
- Budget stops are safe states with gathered evidence persisted
- Figures-outside-tool-data guard rejects hallucinations (FR-003)
- Provider credentials never logged, returned, or audited (FR-006)

### 4. Tool System (`tools.ts`, `sql-tool.ts`)

**Closed catalog** (11 tools):
- `get_workspace_datasets`, `get_dataset_schema`, `get_dataset_sample`
- `run_readonly_sql` (SELECT-only, parameterized, LIMIT-injected, timeout)
- `calculate_metric`, `compare_periods`, `group_by_dimension`, `find_top_entities`, `find_anomalies`
- `generate_chart_spec`, `get_business_context`

**Safety**:
- SQL validator rejects mutation keywords (INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE)
- All queries run via Prisma `$queryRaw` with statement timeout
- Result caps: 500 rows max per SQL query, 500 rows max per sample
- Tool bodies reuse Phase 2 analytics/dataset services (single source of truth)

### 5. Budget System (`budgets.ts`)

Hard limits enforced per run:
- **Steps**: Default 10, max 20 (env: `AI_MAX_STEPS`)
- **Tool calls**: Default 12, max 30 (env: `AI_MAX_TOOL_CALLS`)
- **Tokens**: Default 50k, max 100k (env: `AI_MAX_TOKENS`)
- **Wall clock**: Default 60s, max 300s (env: `AI_TIMEOUT_MS`)

On breach: throw exception → catch in loop → persist gathered tool calls → finalize run with `STOPPED` status and safe error message.

**Status mapping**:
- Budget exceeded → `STOPPED`
- Provider timeout/error → `FAILED`
- Successful completion → `COMPLETED`

### 6. Evidence & Traceability (`evidence.ts`)

**EvidenceClass labels**:
- `CALCULATED`: Figures derived from metric/aggregate tool outputs
- `OBSERVED`: Direct dataset samples or schema facts
- `INFERRED`: Multi-step reasoning over recorded data
- `UNKNOWN`: Fallback (should be rare)

**Figures guard**:
- Extracts numbers from final answer content (regex: `\d{1,3}(,\d{3})*(\.\d+)?` with unit signals)
- Compares against recorded tool outputs
- Rejects answers containing figures not present in tool data (adversarial hallucination test)

### 7. Prompt Management (`prompts.ts`)

System prompts exported as constants:
- `ANALYST_SYSTEM`: Conversational analyst guidelines (evidence-only, correlation ≠ causation)
- `MAPPING_ASSIST_SYSTEM`: Column semantic mapping (closed vocabulary)
- Each prompt hashed (`promptVersion: sha256(...)`) and persisted per run for reproducibility

---

## Alternatives Considered

### Alternative 1: Direct OpenAI SDK per feature
**Rejected**: Would scatter provider logic across modules, making provider switches brittle and testing non-deterministic.

### Alternative 2: LangChain or similar framework
**Rejected**: Too heavy, brings dependency risk, and abstracts away the evidence/budget enforcement we need explicit control over.

### Alternative 3: OpenAI Agents SDK (if available for Groq)
**Deferred**: Research (R1) notes the SDK may become available. If adopted, `GroqEngine` becomes a thin wrapper over the SDK's agent runner, but the `AgentEngine` interface and our tool/budget/evidence layers remain unchanged.

---

## Consequences

### Positive

✅ **Provider independence**: Swap Groq for OpenAI/Anthropic/local models by implementing one new `AgentEngine` subclass  
✅ **Testability**: All agent tests use `MockProvider`; CI never needs live API keys  
✅ **Traceability**: Every AI figure maps to a `ToolCallRecord` with arguments + output  
✅ **Budget safety**: Hard limits prevent runaway costs; `STOPPED` is a safe, inspectable state  
✅ **Tool safety**: Closed catalog + SQL validator + read-only enforcement (Principle XI)  
✅ **Auditability**: Evidence panel surfaces runs, tool calls, model, tokens, latency for every claim  

### Negative

⚠️ **Abstraction cost**: One extra indirection vs. direct OpenAI calls; mitigated by clean interface  
⚠️ **Tool duplication risk**: Must keep tool bodies in sync with analytics/dataset services (mitigated by reuse, not reimplementation)  
⚠️ **Prompt brittleness**: LLM behavior depends on prompt phrasing; mitigated by `promptVersion` hashing and evidence guard  

### Risks & Mitigations

**Risk**: Provider output format changes break tool-call parsing  
**Mitigation**: Unit tests cover malformed-output scenarios; `MockProvider` exercises all edge cases

**Risk**: Tool outputs too large, OOM or token budget exceeded  
**Mitigation**: Hard caps (500 rows, 100k tokens), sanitized output shape validator

**Risk**: Hallucination bypasses figures guard  
**Mitigation**: Adversarial test fixtures; guard rejects any number not in recorded tool data

---

## Related

- **ADR-004**: Relational split-value storage (tool outputs query this layer)
- **ADR-005**: Jobs table system of record (AI jobs claim/run via queue)
- **FR-003**: Traceability (evidence chain)
- **FR-004**: Budget enforcement
- **FR-005**: SQL safety
- **FR-006**: No fabricated data, no credential leakage
- **FR-020**: Testable without live models

---

## Implementation

- `backend/src/lib/agent/provider.ts` — `AgentEngine` interface + `GroqEngine`
- `backend/src/lib/agent/engine.ts` — Deterministic agent loop
- `backend/src/lib/agent/tools.ts` — Closed 11-tool catalog
- `backend/src/lib/agent/sql-tool.ts` — SELECT-only validator
- `backend/src/lib/agent/budgets.ts` — Step/token/time guards
- `backend/src/lib/agent/evidence.ts` — Figures guard + EvidenceClass labeling
- `backend/src/lib/agent/prompts.ts` — System prompts with SHA-256 versioning
- `backend/tests/helpers/provider-mock.ts` — `MockProvider` for deterministic tests

All agent tests (unit + integration) are `MockProvider`-backed; no live model dependency.

---

**Signed off**: Phase 3 complete; US1–US5 functional; evidence panel operational (2026-09-23)
