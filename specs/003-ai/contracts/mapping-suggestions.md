# Contract: AI-Assisted Mapping Suggestions

**Base**: `/api/v1/ai/mapping-suggestions` — authenticated, tenant-scoped. Suggestions are proposals only; dataset analytics-readiness changes only on user confirmation (FR-012/FR-013).

---

## GET /ai/mapping-suggestions

List suggestions, filterable by `datasetId`, `importJobId`, `status` (default `PENDING`).

**Response**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "sg-uuid",
        "importJobId": "import-uuid",
        "datasetId": "ds-uuid",
        "column": { "id": "col-uuid", "name": "ambiguous_col", "type": "TEXT", "representativeSample": ["…"] },
        "semanticKey": "revenue",
        "businessMeaning": "Revenue",
        "source": "AI",
        "status": "PENDING",
        "confidence": 0.84,
        "agentRunId": "run-uuid"
      }
    ],
    "meta": { "page": 1, "perPage": 20, "total": 1 }
  }
}
```

- `source: RULES` rows arrive from deterministic mapping (Phase 2 `REQUESTING_MAPPING` path); `source: AI` rows arrive from the `SUGGEST_MAPPING` job (FR-012).
- Empty list (`items: []`) when nothing pending.

---

## POST /ai/mapping-suggestions/:id/confirm

Confirm a suggestion; applies `semanticKey`/`businessMeaning` to the column and flags the column analytics-ready.

**Request**: `{}`

**Response**
```json
{ "success": true, "data": { "id": "sg-uuid", "status": "CONFIRMED", "columnId": "col-uuid", "semanticKey": "revenue", "analyticsReady": true } }
```

Concurrent confirmations on the same column serialize via a per-dataset optimistic lock (row version on `DatasetColumn`); a racing confirm returns `CONFLICT`.

**Errors**: `NOT_FOUND` (404, foreign/unknown or already-resolved id), `CONFLICT` (409, racing update), `VALIDATION_ERROR` (400, suggestion not resolvable).

---

## POST /ai/mapping-suggestions/:id/reject

Reject a suggestion; the column stays unmapped and the dataset unchanged (stays not-analytics-ready for that column until a confirmed mapping exists).

**Response**: `{ "success": true, "data": { "id": "sg-uuid", "status": "REJECTED", "analyticsReady": false } }`

---

## POST /ai/mapping-suggestions/batch

Confirm/reject several pending suggestions for one import in one request (mapping-confirm dialog UX).

**Request**
```json
{ "importJobId": "import-uuid", "decisions": [ { "suggestionId": "sg-1", "action": "CONFIRM" }, { "suggestionId": "sg-2", "action": "REJECT" } ] }
```

**Response**: per-suggestion results; any failure is isolated and reported (`results[]` with per-item status), never a partial silent apply.

---

## Conventions

- Confirmation writes `data-source.mapping.confirm`/`reject` audit events (no payloads) (FR-018).
- AI suggestions that fail provider/budget validation are marked `SKIPPED` — the import completes safely, no mapping auto-applied (FR-013/SC-007).