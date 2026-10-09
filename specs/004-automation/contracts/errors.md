# Contract: Errors (Phase 4 — Automation)

**Base**: extends Phase 1/2/3 error conventions (`/api/v1` error envelope). Phase 4 adds automation-specific codes. All error responses are sanitized (never include credentials, SQL, raw tool output, or secrets — FR-008, Principle XII).

## Envelope

```json
{
  "success": false,
  "error": {
    "code": "ALERT_RULE_NOT_ENABLED",
    "message": "The requested alert rule is disabled.",
    "details": { "ruleId": "..." }
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid input (rule params, recipients, schedule cron) |
| 404 | `NOT_FOUND` | Unknown or cross-tenant anomaly/recommendation/alert/rule/report/schedule/email-delivery |
| 409 | `CONFLICT` | Duplicate recommendation, alert already fired within dedup window, racing status update |
| 422 | `DATASET_NOT_READY` | Anomaly evaluator skipped a non-analytics-ready dataset; alert rule skipped for that metric |
| 422 | `INSUFFICIENT_HISTORY` | Anomaly worker skipped a metric with no baseline history |
| 422 | `REPORT_GENERATION_FAILED` | Report generation failed; report `status: FAILED` with sanitized error |
| 422 | `EMAIL_DELIVERY_FAILED` | Email delivery failed after max retries; `EmailDelivery.status: FAILED` |
| 403 | `ENTITLEMENT_REQUIRED` | Automation feature usage hits the plan limit (Phase 5 enforcement) |

## Details Payloads

- `CONFLICT` (dedup): include `ruleId`/`alertId`, `status: "ALREADY_FIRED"`, `dedupWindowMs`.
- `DATASET_NOT_READY`: include `datasetId`, `reason: "DRAFT" | "READY_WITH_WARNINGS"`.
- `INSUFFICIENT_HISTORY`: include `datasetId`, `metricKind`.
- `REPORT_GENERATION_FAILED`: include `reportId`, `status: "FAILED"`, `error` (sanitized).
- `EMAIL_DELIVERY_FAILED`: include `emailDeliveryId`, `status`, `error`.

## Conventions

- No automation credentials, API keys, or secrets ever appear in any error, log, audit, or response (Principle XII; pino redaction).
- Anomaly/alert/report errors on the frontend render via the shared signal components (honest message).
- Background jobs never surface errors to the user synchronously; failures are recorded in the record (`FAILED` status) and retried.
- Cross-tenant access denied on every automation resource; the attempt is recorded (FR-008).
