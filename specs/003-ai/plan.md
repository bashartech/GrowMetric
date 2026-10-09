# Implementation Plan: Phase 3 — AI Layer

**Branch**: `003-ai` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-ai/spec.md`
**Design reference**: repository root `research.md` (§7 AI, §8 simulator, §9 queues, §13 testing) and `architecture.md`; phase research in `./research.md`

## Summary

Deliver the AI layer of GrowMetrics on top of the Phase 2 data layer: a tool-using **AI Analyst** (conversational Q&A with evidence-traced figures), **structured Investigations** (root-cause workflow producing main/supporting/correlation findings), a **Business Simulator** (deterministic projection engine with LLM explanation limited to recorded values), **AI-assisted column mapping suggestions** gated behind user confirmation, full **evidence/transparency** over persisted agent runs and tool calls, and the **queue rewrite** that activates the Redis signal layer while keeping the jobs table as the system of record. All work sits on top of the Phase 1/2 foundation (auth, tenancy, jobs table, entitlements, audit, datasets/analytics). The AI provider is Groq via an OpenAI-compatible client (constitution stack), provider-abstracted. Automated tests (unit + integration) are part of the phase gate.

## Technical Context

**Language/Version**: TypeScript 5.x; Node.js 20 LTS (ESM)
**Primary Dependencies**:
- Backend (new): OpenAI-compatible client for Groq (typically the `openai` SDK against `https://api.groq.com/openai/v1`, or the OpenAI **Agents SDK** TS package when available at implementation time — resolved against the `AgentEngine` seam in [research.md](./research.md) R1); `ioredis` (already present, now activated for signal consumption)
- Backend (existing, reused): Express, Prisma, `zod`, `pino` (redact), jobs registry (Phase 1), entitlement + audit middleware (Phase 1), `analytics-sql` builders, `mapping-rules`, `infer`, dataset repo, external-db read-only SQL validation
- Frontend (new): none beyond the existing stack (Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, `react-hook-form` + zod, TanStack Query, `recharts`, `lucide-react`)
- Queue signal: `ioredis` when `REDIS_URL` is configured (jobs table remains system of record)
**Storage**: PostgreSQL on Neon via Prisma (10 new Phase 3 models); no new object storage
**Testing**: Backend Vitest + Supertest (unit for engine/tools/budgets/simulation/mapping/redaction; integration for agent lifecycle, tenant isolation, mapping flow); Frontend Vitest + React Testing Library; provider behavior mocked (a `MockProvider` implements the `AgentEngine` contract so tests never call a live model); Playwright remains Phase 5
**Target Platform**: Web (Node.js server + modern browsers); agent runs enqueued as jobs, never blocking requests
**Project Type**: Web application — two independent folders (`backend/`, `frontend/`)
**Performance Goals**: typical analyst question completes within the 60 s budget; run/tool persistence under 1 s overhead; polls every ~2 s; tool outputs row-capped (sample ≤ 500, SQL ≤ 500 rows)
**Constraints**: provider-abstracted; LLM never invents business numbers (FR-003); tool catalog closed (11 tools); free-SQL validated read-only on platform storage only; budgets enforced (steps/tool calls/time/tokens); every run and tool call persisted; no SSE in v1; mapping suggestions never auto-apply; cross-tenant denied on every AI resource
**Scale/Scope**: Multi-organization SaaS; single user per workspace; 10 new Prisma models + 3 new enums; 5 new backend modules + 1 AI engine lib + 4 job handlers; 3 frontend AI routes + evidence panel + mapping-dialog wiring

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 2 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Data-First Architecture | Agents retrieve data only via tools; engine-level guard prevents invented figures; evidence classification on every figure | PASS |
| II. Read-Only External DB | External DB access unchanged (Phase 2, read-only); AI runs SQL only against platform storage, validated SELECT-only | PASS |
| III. Tenant Isolation | Every AI resource query scoped via authenticated org/workspace; cross-tenant AI tests required | PASS |
| IV. Least Privilege | Agents get only the 11 approved tools; no shell/FS/secrets/credentials; SQL tool SELECT-only + bounded | PASS |
| V. AI Must Use Controlled Tools | Closed tool catalog; engines call tools only; no unstructured infrastructure access | PASS |
| VI. Deterministic Calculations | Metrics/change/simulation math all deterministic backend logic; LLM explains only | PASS |
| VII. Simulation Transparency | Sufficiency gate; assumptions recorded; current vs projected; confidence; isEstimate; disclaimer; no fabricated baselines | PASS |
| VIII. Evidence-Based AI | Findings/answers carry evidence (dataset, metric, calculation, SQL, period); OBSERVED/CALCULATED/… labels; correlation ≠ causation | PASS |
| IX. Data Quality Before Intelligence | Tools refuse READY_WITH_WARNINGS sources for critical metrics (Phase 2 quality gate reused); analyst surfaces warnings | PASS |
| X. Async Processing for Expensive Operations | Analyst/investigation/simulation/mapping runs are jobs (RUN_ANALYST etc.); requests only enqueue; UI polls | PASS |
| XI. Security by Default | Zod on all bodies/queries/params + tool args; run_readonly_sql validator; provider outputs shape-checked; budgets | PASS |
| XII. Secrets Management | GROQ_API_KEY env-only; `.env` gitignored; pino redaction extended; API key never in tool I/O, logs, or prompts | PASS |
| XIII. API Boundary | Frontend talks only to REST API; never Prisma/DB/Redis/Groq directly | PASS |
| XIV. Separation of Concerns | `routes → controllers → services → Prisma`; AI logic in `lib/agent` engine + modules + worker handlers; thin controllers | PASS |
| XV. Multi-Tenant Data Model | User → Organization → Workspace → Datasets → AI (conversations/investigations/simulations) hierarchy preserved | PASS |
| XVI. AI Not System of Record | AI output never authoritative; numbers from stored data + validated calculations + explicit user config; mapping confirmed by user | PASS |
| XVII. Human Oversight | Mapping suggestions require confirmation; investigations/simulations are analysis, never auto-actions | PASS |
| XVIII. Auditability | Conversation/investigation/simulation/mapping-confirm events recorded; no secrets or payloads | PASS |
| XIX. Production Quality | Full vertical slices (UI + API + validation + auth + DB + errors + loading + logging + tests + security) per story | PASS |
| XX. Testing | Unit (engine loop, tools, SQL validator, budgets, simulator math, evidence classifier, mapping validator) + integration (agent lifecycle, isolation, mapping) + component UI | PASS |
| XXI. Observability | AgentRun + ToolCallRecord persisted; run IDs in logs; latency/tokens/status tracked; pino redaction of credentials | PASS |
| XXII. Performance | Tool outputs row-capped; SQL LIMIT-ed; polling instead of SSE; no full-table loads; indexes on AI tables; small sample fetches | PASS |
| XXIII. Maintainability | Small typed modules; `AgentEngine`/`tools`/`simulation` seams; provider abstraction; one purpose per dependency | PASS |
| XXIV. Specification Before Implementation | Spec + this plan + research precede implementation (this phase set) | PASS |
| XXV. No Silent Architecture Changes | Queue rewrite keeps jobs table + Redis-signal only (ADR-005 finalized); AI provider behind a seam (ADR-006 pending) — both documented for user consent before implementation | PASS (ADR pending) |
| XXVI. Definition of Done | Gate: spec satisfied, tests, type-check, lint, migrations, authorization, errors, docs, transparency (evidence panel) | PASS |

**Gate result**: PASS — no violations require justification.

## Skills (loaded at implementation time to prevent common errors)

> The implementation agents must load the following skills before writing code for this phase. AGENTS.md documents them for every session.

- **code-quality** (repo `.claude/skills/code-quality`) — MUST be loaded before ANY `.ts`/`.tsx` editing in this phase (structure, type safety, error handling, security).
- **OpenAI Agents SDK Development** (repo `.opencode/skills/openai-agents-sdk`) — agent/handoff/guardrail/tool patterns for the analyst, tool loop, and budgets.
- **enterprise-ai-chatbot** (global `~/.claude/skills/enterprise-ai-chatbot`) — Groq + OpenAI-compatible wiring reference (base URL config, key handling, LLM-as-judge/evals patterns reused by the mapping suggester and Phase 5 harness).
- **ui-ux-engineering** (repo `.opencode/skills/ui-ux-engineering`) — chat/investigation/simulator/evidence-panel components: loading, empty, insufficient-data, and error states.
- **nodejs / python / fastapi skills** — NOT applicable here (backend is Express/TypeScript; the assistant skills are FastAPI-oriented).

## Project Structure

### Documentation (this feature)

```text
specs/003-ai/
├── plan.md              # This file (/sp.plan command output)
├── spec.md              # Feature specification (story/FR/SC)
├── research.md          # Phase 0 output (R1–R8 technical decisions)
├── data-model.md        # Phase 1 output (10 entities + Prisma mapping)
├── quickstart.md        # Phase 1 output (run/verify guide)
├── contracts/           # Phase 1 output (API contracts)
│   ├── conversations.md
│   ├── investigations.md
│   ├── simulations.md
│   ├── agent-runs.md
│   ├── mapping-suggestions.md
│   └── errors.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/sp.tasks command)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma        # +10 Phase 3 models (3–5 enums)
│   └── migrations/          # +1 migration (ai-layer)
├── src/
│   ├── config/env.ts        # + AI_MODEL, AI_MAX_STEPS, AI_MAX_TOOL_CALLS,
│   │                        #   AI_TIMEOUT_MS, AI_MAX_TOKENS, GROQ_API_KEY (already seed)
│   ├── lib/
│   │   ├── agent/           # AI engine (provider-abstracted) — NEW
│   │   │   ├── provider.ts        # AgentEngine contract + Groq/Agents-SDK adapter
│   │   │   ├── engine.ts          # tool loop, budgets, evidence labeling
│   │   │   ├── tools.ts           # 11-tool catalog + registry + Zod arg schemas
│   │   │   ├── sql-tool.ts        # run_readonly_sql validator (SELECT-only, LIMIT, timeout, shape)
│   │   │   ├── evidence.ts        # classification (OBSERVED|CALCULATED|…)
│   │   │   ├── budgets.ts         # step/tool-call/token/time guards
│   │   │   └── mapping-suggest.ts # SUGGEST_MAPPING prompt + output validator
│   │   └── simulation.ts     # deterministic projection math + sufficiency gate
│   ├── modules/
│   │   ├── ai/               # ai.routes/controller/service (conversations, agents, evidence)
│   │   ├── investigations/   # investigation.routes/controller/service (pipeline + findings)
│   │   ├── simulations/      # simulation.routes/controller/service (scenarios/results)
│   │   └── mapping/          # mapping-suggestion endpoints (confirm/reject/list)
│   └── workers/
│       ├── index.ts          # worker loop (+ Redis BRPOP signal consumption)
│       └── handlers/
│           ├── run-analyst.ts        # RUN_ANALYST job
│           ├── run-investigation.ts  # RUN_INVESTIGATION job (R5 pipeline)
│           ├── run-simulation.ts     # RUN_SIMULATION job
│           └── suggest-mapping.ts    # SUGGEST_MAPPING job
├── tests/
│   ├── unit/               # engine, tools, sql-tool, budgets, simulation, evidence,
│   │                       # mapping-suggest validator, mock-provider
│   └── integration/        # conversations, investigations, simulations, mapping-flow,
│                           # tenant-isolation-ai, agent-runs, queue-signal
└── (jobs table, workers unchanged; ioredis activated)

frontend/
├── app/(app)/
│   ├── ai/
│   │   ├── analyst/page.tsx          # US1 chat (poll-based)
│   │   ├── investigations/page.tsx   # US2 list + detail + findings
│   │   └── simulator/page.tsx        # US3 scenario form + results + explanation
│   └── data-hub/data-sources/        # US4 mapping-dialog now shows MappingSuggestion rows
├── components/
│   ├── ai/                           # chat-thread, run-badge, evidence-panel, finding-card,
│   │                                 # simulation-form, simulation-result, insight-chart
│   └── data/mapping-confirm.tsx      # extended to render pending suggestions
├── hooks/                            # use-conversation, use-investigation, use-simulation,
│                                     # use-agent-run, use-mapping-suggestions (react-query)
└── lib/
    ├── api-client.ts                 # + AI endpoints (run progress polling helper)
    └── types.ts                      # + Phase 3 DTOs mirrored from contracts/
```

**Structure Decision**: Two-folder web application (backend + frontend), matching the ratified architecture. AI logic is isolated in `backend/src/lib/agent/` (provider-abstracted) so the provider Swap (ADR-006) is a one-file change and every tool is unit-testable without a live model. Worker handlers are thin wrappers that enqueue → claim → run → persist; all math lives in services/libs. Frontend adds an `ai/` route group and an `ai/` component set; no new frontend dependencies.

## Phase 0 — Research (summary; full detail in [research.md](./research.md))

Key decisions for Phase 3:

- **Provider seam**: internal `AgentEngine`; OpenAI-compatible client on Groq; OpenAI Agents SDK as the adherence point when its TS package is available (R1).
- **Tools**: 11 approved tools in a closed registry; `run_readonly_sql` strictly validated, SELECT-only, on platform storage only (R2).
- **Engine**: deterministic loop + budgets + evidence labels + persisted AgentRun/ToolCallRecord, idempotent by runKey (R3).
- **Queues**: jobs table stays system of record; Redis activated as signal; new AI job types; polling fallback (R4).
- **Investigation**: procedural pipeline computes findings; LLM summarizes only (R5).
- **Simulator**: `simulation.ts` deterministic math + sufficiency/sensitivity gate; LLM explanation constrained to recorded values (R6).
- **Mapping assist**: proposal-only `MappingSuggestion` rows; user confirmation drives analytics-readiness (R7).
- **Frontend**: poll-based chat (no SSE v1), recharts reuse, evidence panel, mapping-dialog wiring (R8).

## Phase 1 — Design & Contracts

- `data-model.md`: 10 Prisma models (Conversation, Message, AgentRun, ToolCallRecord, Investigation, InvestigationFinding, Simulation, SimulationScenario, SimulationResult, MappingSuggestion) + enums, fields, relations, indexes.
- `contracts/`: conversations, investigations, simulations, agent-runs (runs/tool calls/evidence), mapping-suggestions, errors (extends Phase 1/2 codes with AI codes).
- `quickstart.md`: env additions (AI_*, enabled REDIS optional), worker with queue signal, verification steps incl. a provider-mock smoke test.

## Phase 2 — Tasks

`tasks.md` — phased by user story with tests written first (FR-020) and phase gates per story; Setup (Phase 1) → Foundational (Phase 2) → US1 analyst → US2 investigation → US3 simulator → US4 mapping assist → US5 evidence/transparency → Polish (ADR-005/006, security, observability, phase gate).

## Complexity Tracking

No Constitution Check violations. Architecturally significant decisions documented for user consent before implementation: **ADR-005** (jobs table as system of record + Redis as signal — finalized at activation) and **ADR-006** (provider-abstracted `AgentEngine` over Groq/OpenAI Agents SDK). Both follow Principle XXV (no silent architecture changes).

## Phase Gate (Definition of Done for this phase)

1. `backend`: `tsc --noEmit` passes, lint passes, `vitest` unit + integration pass (ProviderMock used; no live-model dependency in CI), `prisma migrate` applies cleanly (Phase 1+2+3 migrations).
2. `frontend`: `tsc --noEmit` passes, lint passes, `vitest` passes, production build succeeds.
3. Manual checkpoint: register → import a file with an ambiguous column → AI mapping suggestion appears as pending → confirm → import completes → ask the analyst a computable question → answer figures match tool outputs and evidence panel shows the tool calls → run a structured investigation on a dataset with a known driver → confirm the driver surfaces as main/supporting → run a simulator scenario and confirm result math + disclaimer → all AI resources are tenant-isolated (two accounts) → no credential string appears in logs/audit/API/tool I/O.
4. PHR recorded; then Phase 4 (Automation) planning begins only after user verification.