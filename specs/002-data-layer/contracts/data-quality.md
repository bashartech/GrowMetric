# Contract: Data Quality

**Base**: `/api/v1/datasets/:id/quality` — authenticated, tenant-scoped.

---

## GET /datasets/:id/quality

Data-quality report for the current version of a dataset (FR-014/FR-025).

**200**
```json
{
  "success": true,
  "data": {
    "datasetId": "...",
    "version": 1,
    "status": "WARNINGS",
    "totalRows": 45213,
    "columnCount": 8,
    "missingValuePct": 2.1,
    "duplicateRowPct": 0.4,
    "invalidNumberPct": 0.2,
    "invalidDatePct": 0.1,
    "numericOutlierCount": 14,
    "detail": [
      {
        "columnId": "...",
        "columnName": "total",
        "level": "INFO",
        "message": "0.3% of cells failed decimal parsing and were stored as null.",
        "sample": ["abc", "", null]
      },
      {
        "columnId": "...",
        "columnName": "date",
        "level": "WARNING",
        "message": "Column detected as DATE; 0.7% of values were ambiguous and parsed as text.",
        "sample": ["01/15/2026", "2026-01-15", "jan-2026"]
      }
    ]
  }
}
```

**Errors**: `NOT_FOUND` (404) when no report exists for the dataset/version.

---

## GET /datasets/:id/quality?version=2

Quality report for a specific version.

**200**: same shape as above for version 2.

---

## POST /datasets/:id/quality/recompute

Recompute the quality report for the current version (manual re-profile, e.g., after mapping changes).

**200**: `{ "success": true, "data": { "status": "WARNINGS", "totalRows": 45213, "missingValuePct": 2.1, "..." } }`

**Errors**: `NOT_FOUND` (404), `CONFLICT` (409) when already recomputing.

---

## Quality status semantics

| Status | Meaning | Analytics ready? |
| --- | --- | --- |
| `CLEAN` | No warnings | Yes |
| `WARNINGS` | Missing/invalid/outlier warnings present | No for gated/all-risk analytics; surfaced in UI (FR-015) |
| `ERROR` | Could not produce a valid profile | No |

Warnings MUST be surfaced in the UI before analytics derived from the data are relied upon (FR-015, Principle IX).