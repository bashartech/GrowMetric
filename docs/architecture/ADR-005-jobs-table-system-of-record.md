# ADR-005: Jobs Table as System of Record (Redis as Optional Signal Layer)

- **Status:** Accepted
- **Date:** 2026-09-22 (Updated: 2026-09-23)
- **Feature:** 002-data-layer, 003-ai-layer
- **Context:** Import and sync work (file parsing, dataset version building, external-DB reads) is asynchronous. Workers need a durable, retryable job queue that survives restarts, guarantees at-least-once execution with a bounded attempt cap, and keeps an auditable trail of what ran. A standalone queue broker (Redis/BullMQ) would add an external dependency; this deployment prefers to stay on Postgres for correctness-critical state while keeping the door open for a fast signal channel.

## Decision

Treat the **Prisma `Job` table as the single system of record** for asynchronous work, with per-domain job records (e.g., `ImportJob`) as the domain-facing state, and use a **best-effort in-process poller** as the current signal mechanism. Redis is declared in configuration but not used at runtime; it is reserved as a future signal/pub-sub layer.

- **Enqueue**: `enqueueJob` inserts a `Job` row (`status=PENDING`, `runAt`, `payload` JSON, org-scoped). Domain records like `ImportJob` reference their `Job` via a `jobId` foreign key.
- **Claim**: the worker poller (`claimNextJob`) does an atomic compare-and-set — select the oldest due `PENDING` job with `attempts < MAX_ATTEMPTS` (3), then `updateMany(where { id, status: PENDING })` to `RUNNING` + increment attempts. The guarded update makes the claim exclusive under concurrency.
- **Outcome**: handlers call `completeJob`/`failJob` on the same row; `failJob` requeues (`PENDING` + `runAt=now+60s`) until attempts are exhausted, then `FAILED`. `requeueJobForMapping` pauses a job while awaiting user column-mapping confirmation.
- **Import lifecycle**: `ImportJob.status` (QUEUED → RUNNING → COMPLETED/FAILED/REQUESTING_MAPPING) is written in the same logical unit as the domain state so the API and audit trail reflect truth; the `Job` row is the execution-side author of retry/attempts.
- **Worker topology**: a single in-process setInterval loop (plus a manual runner for tests) polls the table; handlers are registered in a type→handler registry.
- **Redis signal activation (Phase 3)**: When `REDIS_URL` is set, the queue activates an optional signal path: `enqueueJob` pushes a lightweight signal (`LPUSH queue:{type}:signal`), and the worker consumes signals via `BRPOP` with a 5s timeout before falling back to polling. The `Job` table remains the system of record; Redis only accelerates claim latency from ~2s (polling) to <100ms. All claim/complete/fail logic stays table-authoritative.

## Consequences

### Positive

- Durable by construction: queue state is transactional with the database, so an enqueued import survives restarts and is never stranded outside the DB.
- Retries, attempts, timestamps, and last errors are inspectable and auditable via the same tables the API reads.
- Zero extra infrastructure and no truth-divergence between a broker and the database.
- **Phase 3 addition**: Redis signal path reduces AI job latency (conversational analyst, investigations, simulations) from 2s polling to sub-100ms, improving user experience without sacrificing durability or testability (signal failures fall back to polling).

### Negative

- Polling adds latency and DB load versus a push-based broker; mitigated by a modest poll interval and short-running handlers. **Phase 3**: Redis signals mitigate this when available.
- High throughput is bounded by single-table contention; cross-instance workers must rely on the CAS claim (correct, but that one shared table is the serialization point).
- No native scheduling/fan-out features that a broker (BullMQ) would provide out of the box.

## Alternatives Considered

- **BullMQ on Redis as the primary queue**: rejected as the *source of truth* — a Redis failure or lost job would diverge from the audit/domain state the product depends on; keeping Postgres authoritative makes job state consistent with `ImportJob`/`Dataset` in one transaction.
- **BullMQ + Postgres write-through**: viable, but adds an always-on Redis dependency and dual-write complexity for a workload that today is low-volume (uploads + periodic DB syncs).
- **Synchronous processing in the request path**: rejected — user uploads must return immediately (`QUEUED`) so large files and slow external DBs do not block HTTP responses.

## References

- Feature Spec: `specs/002-data-layer/spec.md` (FR-004, FR-005, US1/US6), `specs/003-ai/spec.md` (FR-007, FR-021)
- Implementation: `backend/src/jobs/queue.ts`, `backend/src/workers/{index,registry,runner}.ts`, `backend/src/workers/handlers/{import-data,sync-database,run-analyst,run-investigation,run-simulation,suggest-mapping}.ts`, `backend/prisma/schema.prisma`
- Related ADRs: ADR-004 (relational-split value storage), ADR-006 (agent engine provider abstraction)

## Phase 3 Enhancements (2026-09-23)

**Job Types Extended**: Phase 3 adds four AI job types — `RUN_ANALYST`, `RUN_INVESTIGATION`, `RUN_SIMULATION`, `SUGGEST_MAPPING` — all backed by the same Jobs table system of record. Each creates an `AgentRun` row and persists `ToolCallRecord` evidence during execution.

**Redis Signal Path**: Activated when `REDIS_URL` is set; gracefully degrades to polling when Redis is unavailable. `signalQueuedJob()` pushes to `queue:{type}:signal`, `consumeAiSignal()` blocks on `BRPOP` for 5s, then the worker atomically claims from the Jobs table as before. Integration tests verify both signal and polling-fallback paths (T023).

**Stale Claim Recovery**: Jobs stuck `RUNNING` beyond a threshold (5 minutes default) are reclaimed by the poller, ensuring failed workers don't block the queue forever.

## Phase 4 Enhancements (2026-09-28)

**Job Types Extended**: Phase 4 adds four automation job types — `RUN_ANOMALY_DETECTION`, `EVALUATE_ALERT_RULES`, `GENERATE_REPORT`, `SEND_EMAIL` — backed by the same Jobs table system of record. Each automation job runs deterministically against the analytics pipeline (no LLM). Redis-signal consumption (`consumeAiSignal`) was extended to cover these types; polling remains the fallback.

**Deterministic Automation**: Anomaly detection, alert-rule evaluation, and report generation are executed by worker handlers over the existing analytics/metrics services. Entitlement usage (`recordUsage`) is recorded best-effort after each run (`anomaly_detection`, `alerts`, `reports`).

**Email Delivery**: `SEND_EMAIL` jobs fan out to `EmailDelivery` rows (status `QUEUED → SENDING → SENT`); see ADR-007 for the delivery/fallback architecture.