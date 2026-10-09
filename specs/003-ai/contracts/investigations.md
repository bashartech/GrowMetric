# Contract: Structured Investigations

**Base**: `/api/v1/ai/investigations` — authenticated, tenant-scoped. Investigations run the deterministic pipeline as a `RUN_INVESTIGATION` job (research R5); findings come only from that pipeline.

---

## POST /ai/investigations

Create and enqueue a structured investigation.

**Request**
```json
{
  "title": "Orders dropped in March",
  "question": "why did orders drop in March?",
  "topic": "orders",
  "datasetId": "ds-uuid",
  "periodTarget": { "from": "2026-03-01", "to": "2026-03-31" },
  "periodBaseline": { "from": "2026-01-01", "to": "2026-02-28" }
}
```

- `datasetId` optional — when omitted, the pipeline picks the first analytics-ready dataset matching `topic`.
- `periodTarget`/`periodBaseline` optional — defaults: latest complete period vs the preceding equal-length period.

**202**
```json
{
  "success": true,
  "data": {
    "id": "inv-uuid",
    "status": "RUNNING",
    "jobId": "...",
    "periodTarget": { "from": "2026-03-01", "to": "2026-03-31" },
    "periodBaseline": { "from": "2026-01-01", "to": "2026-02-28" }
  }
}
```

**Errors**: `VALIDATION_ERROR` (400), `NOT_FOUND` (404, foreign/unknown dataset), `CONFLICT` (409, dataset not analytics-ready or insufficient history for the comparison → honest state, FR-009).

---

## GET /ai/investigations

List investigations (reverse-chronological) with `status`, `findingCount`.

---

## GET /ai/investigations/:id

Full investigation with findings grouped by level.

**Response**
```json
{
  "success": true,
  "data": {
    "id": "inv-uuid",
    "title": "Orders dropped in March",
    "question": "why did orders drop in March?",
    "topic": "orders",
    "status": "COMPLETED",
    "periodTarget": { "from": "2026-03-01", "to": "2026-03-31" },
    "periodBaseline": { "from": "2026-01-01", "to": "2026-02-28" },
    "agentRun": { "id": "run-uuid", "status": "COMPLETED", "model": "llama-3.3-70b-versatile", "toolsUsed": ["compare_periods", "group_by_dimension", "find_anomalies"] },
    "findings": [
      {
        "id": "f1", "level": "MAIN",
        "title": "Orders fell 22% in March, concentrated in the North region",
        "summary": "March orders were 39,000 vs a 50,000 baseline (−22%). The North region accounts for 70% of the decline.",
        "metricChange": { "metricKey": "orders", "value": 39000, "baselineValue": 50000, "changePct": -22.0, "periodA": "...", "periodB": "..." },
        "evidence": { "datasetId": "ds-uuid", "metric": "orders", "calculation": "SUM(orders) group by region", "sql": "SELECT region, SUM(qty) ...", "period": "Mar-2026 vs Jan–Feb-2026" },
        "confidence": 0.87,
        "isCausalClaim": false
      }
    ]
  }
}
```

- Findings are split: `findings.main[]`, `findings.supporting[]`, `findings.correlation[]` for display ordering (or a flat array with `level`, per frontend preference).
- CORRELATION findings carry `isCausalClaim: false` always (FR-009); the UI renders correlational claims with an explicit non-causal label.

**Errors**: `NOT_FOUND` (404, foreign/unknown id → audit).

---

## Conventions

- Pipeline order fixed (research R5): scope → compare → break down by dimension → rank → anomalies → assemble.
- Numbers (`metricChange`, evidence) are always deterministic pipeline output; the LLM only paraphrases (FR-008).
- Evidence JSON is exactly what the Evidence panel shows (US5): dataset, metric, calculation, SQL, period (FR-014).