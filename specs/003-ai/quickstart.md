# Quickstart: Phase 3 — AI Layer

**Feature**: `003-ai`
**Goal**: Run both apps plus the worker (with optional Redis signal) and verify the Phase 3 gate: analyst answers trace to tool calls → structured investigation against a dataset with a known driver → simulator math + disclaimer → AI mapping suggestion stays pending until confirmed → evidence panel shows runs/tool calls → tenant isolation on every AI resource → zero secrets/credentials leaked.

## Prerequisites

- Phase 1 + Phase 2 installed and gated (see `specs/002-data-layer/quickstart.md`)
- Node.js 20 LTS + npm (ESM)
- A PostgreSQL database (Neon recommended)
- An OpenAI-compatible **Groq** API key (`GROQ_API_KEY`) for live AI paths — the automated gate uses a `MockProvider` and does NOT require a key
- Optional: Redis/Upstash `REDIS_URL` for the signal layer (jobs-table polling works without it)

## 1. Environment

Add to `backend/.env` (alongside Phase 1/2 vars):

```dotenv
# AI provider (Groq, OpenAI-compatible)
GROQ_API_KEY="gsk_..."            # never commit; pino redaction extended
AI_BASE_URL="https://api.groq.com/openai/v1"
AI_MODEL="llama-3.3-70b-versatile"
AI_MAX_STEPS=10                   # max tool-loop iterations per run
AI_MAX_TOOL_CALLS=12
AI_TIMEOUT_MS=60000               # wall-clock budget per run
AI_MAX_TOKENS=2048
AI_ENABLED="true"                 # false => AI surfaces show disabled/honest state

# Queue signal (optional; jobs table is the system of record without it)
REDIS_URL=""                      # e.g. rediss://default:...@upstash
```

`frontend/.env.local` — unchanged from Phase 2 (`NEXT_PUBLIC_API_URL`).

## 2. Backend + Worker

```powershell
cd backend
npm install            # + openai (or openai-agents-sdk) SDK for Groq
npx prisma migrate dev --name ai_layer   # +10 models, +14 enums (additive)
npm run seed
npm run dev            # API on :4000
```

In a second terminal (worker):

```powershell
cd backend
npm run worker         # polls jobs table; activates Redis BRPOP when REDIS_URL set
```

## 3. Frontend

```powershell
cd frontend
npm install
npm run dev            # on :3000
```

## 4. Manual Verification (Phase Gate)

1. Sign in (Phase 1 flow). Ensure a dataset is `READY` (import one in Data Hub if not).
2. **AI Analyst**: open **AI → Analyst**, ask a computable question (e.g., "what was total revenue?"). Confirm the answer appears after the run settles, figures match the Data Hub/dashboard values, and the **Evidence** icon opens the run with its tool calls.
3. **Honesty check**: ask something the data cannot answer; confirm the analyst replies it cannot compute it (no made-up numbers).
4. **Investigation**: open **AI → Investigations**, create one on `orders` for the previous full month vs the preceding period. Confirm MAIN/SUPPORTING findings with `metricChange` and evidence; any correlational claim is labeled correlation, never cause.
5. **Simulator**: open **AI → Simulator**, create a study, run a `PRICE_CHANGE` scenario. Confirm `projectedValue`/`changePct` match the reference math, the disclaimer ("estimate, not a guarantee") renders, and `INSUFFICIENT_DATA` appears for sparse history (with a sensitivity alternative proposal) instead of a fake figure.
6. **AI mapping assist**: import a file with an ambiguous column while `AI_ENABLED=true`. Confirm a `PENDING` AI suggestion appears in the mapping dialog; confirm the dataset stays not-analytics-ready until **Confirm**; after confirm, the column becomes analytics-ready.
7. **Evidence/transparency**: open run records from any answer/finding/suggestion — model, status, latency, tokens, tools, and each tool call's input/output are visible.
8. **Tenant isolation**: register a second account; attempt to reach the first account's conversation/investigation/simulation/suggestion/run by ID — all 404, attempts recorded.
9. **Secrets**: grep backend logs, audit rows, and debug the network tab during an analyst run — `gsk_` never appears; `GET /ai/runs/:id` returns sanitized tool I/O only.

## 5. Automated Gate

```powershell
# backend (uses MockProvider — no live AI needed; GROQ_API_KEY only for manual runs)
cd backend
npm run typecheck
npm run lint
npm run test

# frontend
cd frontend
npm run typecheck
npm run lint
npm run test
npm run build
```

All must pass before Phase 4 (Automation) begins. Adversarial AI tests (figures-outside-tool-data, budget excess, readonly-SQL abuse) are part of `backend/tests/unit` + `tests/integration` and run with the mock provider.

## 6. Troubleshooting

- **Analyst returns `AI_PROVIDER_UNAVAILABLE`**: check `GROQ_API_KEY`/`AI_BASE_URL` and network; conversation is preserved, re-send allowed.
- **Run stuck in `PENDING`**: confirm the worker is running (`npm run worker`); with `REDIS_URL` set, confirm the signal key `queue:RUN_ANALYST:signal` is being popped.
- **`CONFLICT` on analyst/investigation**: the dataset is `READY_WITH_WARNINGS` or history is insufficient — resolve mapping or broaden the period (FR-009).
- **Suggestion never appears**: `AI_ENABLED=false` or the provider failed during `SUGGEST_MAPPING` (row marked `SKIPPED`) — import still completes via rules path.
- **`INSUFFICIENT_DATA` on simulator**: fewer data points than the model requires — use the sensitivity alternative or a different model/type.
- **Budget-stopped run**: `STOPPED` with gathered tool calls visible; rephrase/simplify the question.
- **Next.js 16**: read `frontend/node_modules/next/dist/docs/` before writing App Router code (per repo convention).