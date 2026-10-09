# Data Model: Phase 3 — AI Layer

**Feature**: `003-ai`
**Date**: 2026-09-22
**Source**: [`spec.md`](./spec.md) Key Entities, [`plan.md`](./plan.md) Phase 1, [`research.md`](./research.md) R1–R8, root `research.md` §7 (agent tools/evidence), §8 (simulator), §9 (queues)
**Database**: PostgreSQL (Neon) via Prisma ORM. All IDs are UUIDs. All timestamps are `timestamptz` (Prisma `DateTime`).

## Entity Overview

```text
Workspace   (1) ----< Conversation
Conversation (1) ----< Message
Message    (1) ----0..1 AgentRun          # message that produced a run (or finding)
AgentRun    (1) ----< ToolCallRecord

Workspace   (1) ----< Investigation
Investigation (1) ----< InvestigationFinding
Investigation (1) ----< AgentRun          # runs that executed the investigation

Workspace   (1) ----< Simulation
Simulation  (1) ----< SimulationScenario
SimulationScenario (1) ----< SimulationResult
SimulationScenario (1) ----< AgentRun     # explanation run (nullable)

Workspace   (1) ----< MappingSuggestion
MappingSuggestion (1) ---- 1 AgentRun     # nullable; the run that produced it (AI)
```

All Phase 3 entities are scoped under `organizationId` (and `workspaceId` for workspace-level resources). Every query MUST include the organization/workspace predicate resolved from the authenticated user (FR-015, Principle III).

## 1. Conversation

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `title` | String | required, default `New conversation`, 1–120 chars | derived from first message |
| `kind` | `ConversationKind` enum | default `ANALYST` | `ANALYST` (Phase 3) |
| `status` | Enum | default `ACTIVE` | e.g. `ACTIVE`, `ARCHIVED` |
| `createdById` | UUID | → User, required | owner |
| `createdAt` / `updatedAt` | DateTime | indexed | `updatedAt` drives list ordering |

- **Relations**: `messages`, `runs` (via messages).
- **Index**: `@@index([organizationId, workspaceId, updatedAt])` for list ordering.

## 2. Message

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `conversationId` | UUID | FK → Conversation, required, indexed | |
| `role` | `MessageRole` enum | required | `USER`, `ASSISTANT`, `TOOL` |
| `kind` | `MessageKind` enum | required | `CHAT`, `FINDING`, `CHART`, `ERROR` |
| `content` | String? | nullable | text/finding summary |
| `evidenceClass` | `EvidenceClass` enum? | nullable | label for assistant figures |
| `toolCallId` | UUID? | → ToolCallRecord, nullable | message↔tool linkage |
| `agentRunId` | UUID? | → AgentRun, nullable | run that produced this message |
| `payload` | Json? | nullable | structured (chart spec, finding ref, evidence refs) |
| `createdAt` | DateTime | indexed | in-conversation ordering |

- **Relations**: `conversation`, `toolCall`, `agentRun`.
- **Ordering**: conversation query orders by `createdAt`; `conversationId` index covers the load.
- **Invariant**: any assistant message containing a business figure sets `evidenceClass`; findings reference `payload.evidence` IDs (FR-003).

## 3. AgentRun

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `kind` | `AgentKind` enum | required | `ANALYST`, `INVESTIGATION`, `SIMULATION`, `MAPPING` |
| `jobId` | UUID? | → Job, nullable, indexed | the jobs-table row that ran it |
| `conversationId` | UUID? | → Conversation, nullable | analyst runs |
| `investigationId` | UUID? | → Investigation, nullable | investigation runs |
| `simulationScenarioId` | UUID? | → SimulationScenario, nullable | explanation runs |
| `mappingSuggestionId` | UUID? | → MappingSuggestion, nullable | mapping runs |
| `model` | String | required | e.g. `llama-3.3-70b-versatile` (config) |
| `promptVersion` | String | required | prompt hash/version for reproducibility |
| `status` | `AgentRunStatus` enum | required | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `STOPPED` |
| `startedAt` / `completedAt` | DateTime? | nullable | |
| `latencyMs` | Int? | nullable | wall-clock duration |
| `inputTokens` / `outputTokens` | Int?, default 0 | nullable | model usage |
| `steps` | Int | default 0 | tool-loop iterations |
| `toolsUsed` | Json | default `[]` | distinct tool names |
| `error` | String? | nullable | sanitized failure summary |
| `runKey` | String | required, **unique** | idempotency `workspaceId:conversationId:nonce` |
| `createdAt` | DateTime | indexed | |

- **Relations**: `toolCalls`, `messages`.
- **Stop semantics**: `STOPPED` = budget exceeded (FR-004) — UI shows safe state, partial results retained.
- **Index**: `@@index([organizationId, workspaceId, createdAt])`.

## 4. ToolCallRecord

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `agentRunId` | UUID | FK → AgentRun, required, indexed | |
| `name` | String | required | from the 11-tool registry |
| `argumentsJson` | Json | required | sanitized args (no credentials) |
| `outputJson` | Json? | nullable | sanitized result (no credentials) |
| `status` | `ToolCallStatus` enum | required | `SUCCESS`, `ERROR`, `TIMEOUT`, `STOPPED` |
| `error` | String? | nullable | sanitized tool error |
| `latencyMs` | Int? | nullable | |
| `sequence` | Int | required | 0-based call order within run |
| `createdAt` | DateTime | | |

- **Relations**: `agentRun`.
- **Unique**: `@@unique([agentRunId, sequence])`.
- **Security**: `argumentsJson`/`outputJson` sanitized by the tools layer (secret stripping, shape caps) before persistence (FR-006, Principle XII).

## 5. Investigation

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `title` | String | required, 1–120 chars | e.g. "Orders dropped in March" |
| `question` | String | required, 1–2000 chars | user framing |
| `topic` | String | required | canonical topic slug |
| `status` | `InvestigationStatus` enum | default `RUNNING` | `RUNNING`, `COMPLETED`, `FAILED` |
| `datasetId` | UUID? | → Dataset, nullable | primary dataset analyzed |
| `periodTarget` | Json? | nullable | target period bounds |
| `periodBaseline` | Json? | nullable | comparison baseline |
| `error` | String? | nullable | sanitized |
| `createdById` | UUID | → User, required | |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `findings`, `runs`, `messages`.
- **Unique**:  `@@index([organizationId, workspaceId, createdAt])`.

## 6. InvestigationFinding

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `investigationId` | UUID | FK → Investigation, required, indexed | |
| `level` | `FindingLevel` enum | required | `MAIN`, `SUPPORTING`, `CORRELATION` (FR-008/FR-009) |
| `kind` | `FindingKind` enum | required | `DRIVER`, `ANOMALY`, `CONTRIBUTOR`, `STAT_STATIONARY` |
| `title` | String | required, ≤ 160 chars | |
| `summary` | String | required | plain-language, no invented numbers |
| `metricChange` | Json? | nullable | `{ value, changePct, periodA, periodB }` (deterministic) |
| `evidence` | Json | required | dataset refs, metric, calculation, SQL, period (FR-014) |
| `confidence` | Decimal? | nullable | 0–1 when computable |
| `isCausalClaim` | Boolean | default `false` | MUST stay false for CORRELATION (FR-009) |
| `createdAt` | DateTime | | |

- **Relations**: `investigation`.
- **Invariant**: findings are produced only by the deterministic pipeline; the LLM may paraphrase, never create findings (research R5).

## 7. Simulation

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `datasetId` | UUID? | → Dataset, nullable | primary input dataset |
| `name` | String | required, ≤ 120 chars | |
| `status` | `SimulationStatus` enum | default `ACTIVE` | `ACTIVE`, `ARCHIVED` |
| `createdById` | UUID | → User, required | |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `scenarios`.

## 8. SimulationScenario

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `simulationId` | UUID | FK → Simulation, required, indexed | |
| `type` | `SimulationType` enum | required | `PRICE_CHANGE`, `MARKETING_SPEND`, `EXPENSE_REDUCTION`, `INVENTORY_CHANGE`, `CUSTOM` (FR-010/research R6) |
| `name` | String | required, ≤ 120 chars | |
| `parameters` | Json | required | validated per-model inputs |
| `assumptions` | Json | required | recorded for transparency (FR-010) |
| `modelVersion` | String | required | e.g. `elasticity-loglog-v1` |
| `status` | `ScenarioStatus` enum | default `PENDING` | `PENDING`, `RUNNING`, `COMPLETED`, `INSUFFICIENT_DATA`, `FAILED` |
| `confidence` | Decimal? | nullable | model-level confidence (0–1) |
| `sensitivityAlternative` | Json? | nullable | alternative offered when insufficient data |
| `error` | String? | nullable | sanitized |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `simulation`, `results`, `runs` (explanation).

## 9. SimulationResult

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `simulationScenarioId` | UUID | FK → SimulationScenario, required, indexed | |
| `metricKey` | String | required | e.g. `revenue` |
| `currentValue` | Decimal | required | deterministic |
| `projectedValue` | Decimal | required | deterministic |
| `changePct` | Decimal | required | computed |
| `confidence` | Decimal? | nullable | |
| `isEstimate` | Boolean | default `true` | always truthy for projections (FR-010) |
| `assumptionKey` | String? | nullable | which assumption produced this row |
| `createdAt` | DateTime | | |

- **Relations**: `scenario`.
- **Invariant**: values always from `simulation.ts` math; UI shows the disclaimer alongside (FR-010/SC-005).

## 10. MappingSuggestion

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `importJobId` | UUID | FK → ImportJob, required, indexed | originating import |
| `datasetId` | UUID? | → Dataset, nullable | set when dataset exists |
| `columnId` | UUID | FK → DatasetColumn, required | target column |
| `semanticKey` | String | required | from approved vocabulary (FR-012) |
| `businessMeaning` | String | required | human label |
| `source` | `SuggestionSource` enum | required | `RULES` or `AI` |
| `status` | `SuggestionStatus` enum | default `PENDING` | `PENDING`, `CONFIRMED`, `REJECTED`, `SKIPPED` |
| `confidence` | Decimal | required | rules confidence or AI score |
| `agentRunId` | UUID? | → AgentRun, nullable | AI runs only |
| `createdAt` / `updatedAt` | DateTime | | |

- **Relations**: `importJob`, `column`, `agentRun`.
- **Index**: `@@index([datasetId, status])` for confirmation batch queries.
- **Invariant**: dataset is NOT analytics-ready for a column while its suggestion is `PENDING` (FR-013); confirm/reject updates it (FR-012/FR-017).

---

## Enums

```prisma
enum ConversationKind    { ANALYST }
enum MessageRole         { USER ASSISTANT TOOL }
enum MessageKind         { CHAT FINDING CHART ERROR }
enum EvidenceClass       { OBSERVED CALCULATED INFERRED PROJECTED RECOMMENDED }
enum AgentKind           { ANALYST INVESTIGATION SIMULATION MAPPING }
enum AgentRunStatus      { PENDING RUNNING COMPLETED FAILED STOPPED }
enum ToolCallStatus      { SUCCESS ERROR TIMEOUT STOPPED }
enum InvestigationStatus { RUNNING COMPLETED FAILED }
enum FindingLevel        { MAIN SUPPORTING CORRELATION }
enum FindingKind         { DRIVER ANOMALY CONTRIBUTOR STAT_STATIONARY }
enum SimulationType      { PRICE_CHANGE MARKETING_SPEND EXPENSE_REDUCTION INVENTORY_CHANGE CUSTOM }
enum SimulationStatus    { ACTIVE ARCHIVED }
enum ScenarioStatus      { PENDING RUNNING COMPLETED INSUFFICIENT_DATA FAILED }
enum SuggestionSource    { RULES AI }
enum SuggestionStatus    { PENDING CONFIRMED REJECTED SKIPPED }
```

## Indexes Summary

- `Conversation.organizationId`, `Conversation.workspaceId`, `Conversation @@index([organizationId, workspaceId, updatedAt])`
- `Message.conversationId`
- `AgentRun.organizationId`, `AgentRun.workspaceId`, `AgentRun.runKey` (unique), `AgentRun.conversationId`, `AgentRun.investigationId`, `AgentRun.jobId`, `AgentRun @@index([organizationId, workspaceId, createdAt])`
- `ToolCallRecord @@unique([agentRunId, sequence])`, `ToolCallRecord.agentRunId`
- `Investigation.organizationId`, `Investigation.workspaceId`, `Investigation @@index([organizationId, workspaceId, createdAt])`
- `InvestigationFinding.investigationId`
- `Simulation.organizationId`, `Simulation.workspaceId`
- `SimulationScenario @@index([simulationId, status])`
- `SimulationResult.simulationScenarioId`
- `MappingSuggestion.organizationId`, `MappingSuggestion.workspaceId`, `MappingSuggestion.importJobId`, `MappingSuggestion @@index([datasetId, status])`

## Seed Data

- **Prompt versions**: initial `ANALYST_SYSTEM` / `MAPPING_ASSIST_SYSTEM` prompt files committed in `backend/src/lib/agent/prompts.ts`, hash at runtime into `AgentRun.promptVersion` — no DB seed needed for Phase 3 (prompt-version table deferred to Phase 5 eval harness).
- **Semantic vocabulary**: reused from Phase 2 canonical vocabulary (revenue, orders, customers, products, inventory, expenses, order_date, region, product, ...) as the allowed universe for `MappingSuggestion.semanticKey` (FR-012).

---

## Migration Notes

- One migration `ai_layer` for all 10 Phase 3 models + 14 enums (additive-safe; Phase 1/2 migrations untouched).
- **Deferred (Phase 4/5)**: Recommendation, Alert, AlertRule, Report/ReportSchedule, EmailLog (Phase 4); PromptVersion/EvalCase/EvalRun (Phase 5 harness). No schema changes needed for queue rewrite (jobs table reused).
- `Decimal` fields use PostgreSQL `NUMERIC`; tool outputs and evidence JSON are stored as JSONb via Prisma `Json` for schema-flexible evidence without sacrificing indexable scalar columns (metric change, confidence).