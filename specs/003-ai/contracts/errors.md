# Contract: Errors (Phase 3 — AI Layer)

**Base**: extends Phase 1/2 error conventions (`/api/v1` error envelope). Phase 3 adds AI-specific codes. All error responses are sanitized (never include credentials, SQL, raw tool output, or secrets — FR-006, Principle XII).

## Envelope

```json
{
  "success": false,
  "error": {
    "code": "LLM_BUDGET_EXCEEDED",
    "message": "The analysis stopped before finishing because it exceeded its step budget. What it gathered so far is saved.",
    "details": { "runId": "...", "status": "STOPPED" }
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid/empty input (message content, title band, scenario parameters for type, decision payloads) |
| 404 | `NOT_FOUND` | Unknown or cross-tenant conversation/message/run/finding/investigation/simulation/scenario/result/suggestion (indistinguishable; recorded) |
| 409 | `CONFLICT` | Dataset not analytics-ready (metrics/analyst), insufficient history (comparison/simulation), racing mapping confirmation, concurrent cancel |
| 422 | `AI_PROVIDER_UNAVAILABLE` | Groq unreachable/rate-limited (safe retryable message displayed; conversation preserved) |
| 422 | `AI_PROVIDER_TIMEOUT` | Provider or tool loop exceeded `AI_TIMEOUT_MS` (run `STOPPED`) |
| 422 | `AI_BUDGET_EXCEEDED` | Steps/tool-calls/tokens budget exhausted; safe `STOPPED` state with gathered data (FR-004) |
| 422 | `LLM_OUTPUT_INVALID` | Provider returned output that failed validation (schema, vocabulary, shape caps) — never surfaced to the user as data |
| 422 | `TOOL_FAILED` | A tool errored/timed out during the run (failing tool attempt recorded; agent told to not fabricate the value) |
| 422 | `SQL_NOT_READONLY` | `run_readonly_sql` rejected non-SELECT/mutation (attempt recorded; agent told) (FR-005, Principle XI) |
| 422 | `AI_SUGGESTION_INVALID` | Mapping suggestion output outside the approved vocabulary/validation was marked `SKIPPED` (FR-012) |
| 403 | `ENTITLEMENT_REQUIRED` | AI feature usage hits the plan limit (conversation/run caps, Phase 1 entitlement middleware) |

## Details Payloads

- `AI_BUDGET_EXCEEDED` / `AI_PROVIDER_TIMEOUT`: include `runId`, `status: "STOPPED"`, `completedSteps`, `gathered` (message/tool IDs already persisted) so the UI resumes cleanly.
- `SQL_NOT_READONLY`: include `toolCallId` of the rejected attempt (evidence), never the attempted raw text.
- `CONFLICT` for analytics-readiness: include `datasetId`, `reason: "READY_WITH_WARNINGS" | "INSUFFICIENT_HISTORY"`.
- `LLM_OUTPUT_INVALID`: generic, no model transcript; run marked `FAILED` with sanitized error.

## Conventions

- No AI provider API key ever appears in any error, log, audit, or response (Principle XII; pino redaction extended; redaction unit test required).
- Errors on the frontend render via the shared signal components (honest message + retry where retriable; never fabricated data).
- Run/message always persisted before any error surfaces; partial state is resumable or clearly labeled (FR-004).