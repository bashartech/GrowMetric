# Contract: Agent Runs & Evidence (Transparency)

**Base**: `/api/v1/ai/runs` — authenticated, tenant-scoped. Backs the US5 Evidence panel: every run and tool call is inspectable (FR-006, FR-014, Principle XXI).

---

## GET /ai/runs/:id

Full run detail + tool calls.

**Response**
```json
{
  "success": true,
  "data": {
    "id": "run-uuid",
    "kind": "ANALYST",
    "model": "llama-3.3-70b-versatile",
    "promptVersion": "sha256:1a2b…",
    "status": "COMPLETED",
    "startedAt": "...", "completedAt": "...", "latencyMs": 4210,
    "steps": 4,
    "inputTokens": 1200, "outputTokens": 310,
    "toolsUsed": ["get_workspace_datasets", "calculate_metric", "group_by_dimension"],
    "conversationId": "convo-uuid",
    "investigationId": null,
    "error": null,
    "toolCalls": [
      {
        "id": "tc1", "name": "calculate_metric", "sequence": 0,
        "arguments": { "metricKey": "revenue", "datasetId": "ds-uuid", "period": { "from": "2026-01-01", "to": "2026-03-31" }, "aggregation": "SUM" },
        "output": { "value": 482100.5, "unit": "USD" },
        "status": "SUCCESS", "latencyMs": 42, "error": null,
        "createdAt": "..."
      }
    ]
  }
}
```

- `arguments`/`output` are persisted-sanitized values (no credentials ever, FR-006/Principle XII).
- `STOPPED` runs return gathered tool calls and a safe notice; `FAILED` runs return the sanitized `error`.

---

## GET /ai/runs

Search runs by `kind`, `status`, `model`, `from`/`to` (createdAt), paginated — powers the run-history surface and future Phase 5 eval (SC-006).

---

## GET /ai/runs/:id/tool-calls/:toolCallId

Single tool call detail (full persisted output) — used by the evidence copy/link surface.

---

## GET /ai/evidence/:messageId

Resolve a message to its evidence chain: run → tool calls → underlying data references.

**Response**
```json
{
  "success": true,
  "data": {
    "messageId": "m2", "evidenceClass": "CALCULATED",
    "run": { "id": "run-uuid", "status": "COMPLETED", "model": "llama-3.3-70b-versatile" },
    "toolCalls": [ { "id": "tc1", "name": "calculate_metric", "arguments": { "metricKey": "revenue", "datasetId": "ds-uuid" }, "output": { "value": 482100.5 } } ],
    "dataRefs": [ { "kind": "dataset", "id": "ds-uuid", "name": "sales-2026", "metric": "revenue", "calculation": "SUM(total) over period", "sql": "SELECT SUM(total) FROM dataset_numeric_value ...", "period": "Q1-2026" } ]
  }
}
```

---

## Conventions

- All scope via authenticated org/workspace (FR-015); foreign run/tool-call ids → `NOT_FOUND` + audit.
- Used by the Evidence panel popover/drawer in analyst, investigation, simulator, and mapping UIs.
- No secrets, tokens, or raw provider transcripts are ever returned (FR-006); tool I/O is the inspection surface.