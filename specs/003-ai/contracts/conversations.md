# Contract: AI Conversations (AI Analyst)

**Base**: `/api/v1/ai/conversations` — authenticated, tenant-scoped. Analyst runs are enqueued as jobs (`RUN_ANALYST`); the UI polls message state (FR-007, Principle X). Evidence labels accompany assistant figures (FR-003).

---

## POST /ai/conversations

Create a conversation (empty, first message optional).

**Request**
```json
{ "title": "Q3 revenue question" }
```

**200/201**
```json
{
  "id": "convo-uuid",
  "workspaceId": "ws-uuid",
  "title": "Q3 revenue question",
  "kind": "ANALYST",
  "status": "ACTIVE",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Errors**: `VALIDATION_ERROR` (400).

---

## GET /ai/conversations

List conversations (reverse-chronological), tenant-scoped.

**Response**
```json
{ "success": true, "data": { "items": [ { "id": "...", "title": "...", "status": "ACTIVE", "messageCount": 3, "updatedAt": "..." } ], "meta": { "page": 1, "perPage": 20, "total": 1 } } }
```

Empty workspace shows an honest empty list (`items: []`).

---

## POST /ai/conversations/:id/messages

Send a user message; enqueues a `RUN_ANALYST` job and returns immediately.

**Request**
```json
{ "content": "which product drove the revenue growth last quarter?" }
```

**202**
```json
{
  "messageId": "msg-user-uuid",
  "status": "QUEUED",
  "agentRunId": null,
  "runStatus": "PENDING",
  "conversationId": "convo-uuid"
}
```

**Errors**: `VALIDATION_ERROR` (400, empty/oversized content), `NOT_FOUND` (404, foreign/unknown conversation), `CONFLICT` (409, no analytics-ready datasets → short-circuits with an honest empty-state, SC-003).

---

## GET /ai/conversations/:id

Full conversation with messages resolved to their current run/tool state.

**Response**
```json
{
  "success": true,
  "data": {
    "id": "convo-uuid",
    "messages": [
      { "id": "m1", "role": "USER", "kind": "CHAT", "content": "which product drove the revenue growth last quarter?", "evidenceClass": null, "createdAt": "..." },
      {
        "id": "m2", "role": "ASSISTANT", "kind": "CHAT",
        "content": "Revenue grew 8.2% and the driver was Widget A …",
        "evidenceClass": "CALCULATED",
        "agentRun": {
          "id": "run-uuid", "model": "llama-3.3-70b-versatile", "status": "COMPLETED",
          "latencyMs": 4210, "steps": 4, "toolsUsed": ["get_workspace_datasets", "calculate_metric", "group_by_dimension"]
        },
        "payload": { "evidenceRefs": [ "evidence:datasets/…", "toolCalls/…" ] },
        "createdAt": "..."
      }
    ],
    "nextRun": null
  }
}
```

While a run is in progress, `nextRun` carries `{ runId, status: "RUNNING", startedAt }` and the last assistant message may be absent; the UI polls and shows a running state. `STOPPED` runs surface their gathered state with no partial conclusion (FR-004).

---

## POST /ai/conversations/:id/cancel

Cancel the in-flight agent run (if any); the conversation stays intact.

**Response**: `{ "success": true, "data": { "runId": "...", "status": "STOPPED" } }`

---

## Conventions

- All message/run data is tenant-scoped from the authenticated user (FR-015); foreign conversation ids → `NOT_FOUND` + audit.
- No streaming in v1 (research R8); polling via `GET /ai/conversations/:id` (Phase 2-style helper in `frontend/lib/api-client.ts`).
- Assistant figures MUST trace to `ToolCallRecord` outputs (SC-001) — enforced by the engine and verified by tests (FR-020).