# Contract: Business Simulator

**Base**: `/api/v1/ai/simulations` — authenticated, tenant-scoped. All math is `simulation.ts` deterministic backend logic (FR-010); LLM explanation is limited to recorded values (research R6).

---

## POST /ai/simulations

Create a simulation study (holds scenarios).

**Request**
```json
{ "name": "Pricing strategy Q4", "datasetId": "ds-uuid" }
```

**Response**: `{ "success": true, "data": { "id": "sim-uuid", "name": "Pricing strategy Q4", "datasetId": "ds-uuid", "status": "ACTIVE", "createdAt": "..." } }`

---

## POST /ai/simulations/:id/scenarios

Create a scenario and enqueue its `RUN_SIMULATION` job (deterministic math).

**Request**
```json
{
  "name": "Price +10%",
  "type": "PRICE_CHANGE",
  "parameters": { "priceChangePct": 10, "elasticity": -1.3 },
  "datasetId": "ds-uuid"
}
```

Model-specific parameters (validated per type):
- `PRICE_CHANGE`: `priceChangePct`, optional `elasticity` (omit → estimate from history)
- `MARKETING_SPEND`: `spendAmount` (new monthly spend), optional `saturationAt`
- `EXPENSE_REDUCTION`: `reductionPct`
- `INVENTORY_CHANGE`: `targetDaysOfStock`
- `CUSTOM`: `assumptionRows` (labeled user assumptions)

**202**
```json
{
  "success": true,
  "data": {
    "id": "scn-uuid", "simulationId": "sim-uuid", "type": "PRICE_CHANGE",
    "status": "RUNNING", "jobId": "...",
    "assumptions": [ { "key": "elasticity", "value": -1.3, "source": "user" } ]
  }
}
```

**Errors**: `VALIDATION_ERROR` (400, invalid parameters for type), `NOT_FOUND` (404), `CONFLICT` (409, dataset not ready).

---

## GET /ai/simulations/:id/scenarios/:id

**Response**
```json
{
  "success": true,
  "data": {
    "id": "scn-uuid", "simulationId": "sim-uuid", "name": "Price +10%", "type": "PRICE_CHANGE",
    "status": "COMPLETED",
    "parameters": { "priceChangePct": 10, "elasticity": -1.3 },
    "assumptions": [ { "key": "elasticity", "value": -1.3, "source": "user" } ],
    "confidence": 0.82,
    "results": [
      { "metricKey": "revenue", "currentValue": 482100.5, "projectedValue": 508000.0, "changePct": 5.4, "confidence": 0.82, "isEstimate": true }
    ],
    "disclaimer": "Projection — estimate, not a guarantee.",
    "isEstimate": true,
    "sensitivityAlternative": null,
    "modelVersion": "elasticity-loglog-v1",
    "explanation": { "agentRunId": "run-uuid", "status": "COMPLETED", "content": "At +10% price with elasticity −1.3, projected revenue is …" }
  }
}
```

- `isEstimate: true` always (FR-010); the same flag ships to the UI disclaimer banner.
- When history is insufficient: `status: "INSUFFICIENT_DATA"`, `results: []`, `sensitivityAlternative: { title, reason, suggestion }` (FR-010/SC-005) — never invented numbers.
- `explanation.agentRunId` is set when an explain run was enqueued; explanation content may not introduce numbers not present in `results`/`assumptions` (adversarial test FR-020).

---

## GET /ai/simulations

List studies (reverse-chronological) with scenario counts and latest status.

---

## POST /ai/simulations/:id/scenarios/:id/explain

Optionally enqueue an `RUN_ANALYST`-style explanation run constrained to recorded values; returns the run id to poll.

**Response**: `{ "success": true, "data": { "agentRunId": "run-uuid", "status": "PENDING" } }`

---

## Conventions

- Math only in `simulation.ts` (reference-checked in tests against `tests/unit/simulation.test.ts` golden values, SC-005).
- Confidence and assumptions are always recorded and displayed (FR-010); results are never cached/materialized across requests (computed live or stored per scenario on completion).