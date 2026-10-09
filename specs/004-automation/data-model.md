# Data Model: Phase 4 — Automation

**Feature**: `004-automation`
**Date**: 2026-09-26
**Source**: [`spec.md`](./spec.md) Key Entities, [`plan.md`](./plan.md) Phase 1, [`research.md`](./research.md) R1–R6, root `research.md` §7 (analytics pipeline), §14 (roadmap)
**Database**: PostgreSQL (Neon) via Prisma ORM. All IDs are UUIDs. All timestamps are `timestamptz` (Prisma `DateTime`).

## Entity Overview

```text
Workspace   (1) ----< AnomalyDetection
Workspace   (1) ----< Recommendation
Workspace   (1) ----< AlertRule
Workspace   (1) ----< Alert
Workspace   (1) ----< Report
Workspace   (1) ----< ReportSchedule
Workspace   (1) ----< EmailDelivery

Dataset     ----< AnomalyDetection   (optional; metric-level anomaly)
AlertRule   ----< Alert              (rule that fired)
Report      ----< ReportSchedule     (schedule for the report)
Job         ----< EmailDelivery      (the SEND_EMAIL job)
```

All Phase 4 entities are scoped under `organizationId` (and `workspaceId` for workspace-level resources). Every query MUST include the organization/workspace predicate resolved from the authenticated user (FR-008, Principle III).

## 1. AnomalyDetection

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `datasetId` | UUID? | FK → Dataset, nullable, indexed | the dataset the metric belongs to |
| `metricId` | String? | nullable | canonical metric key (e.g. `REVENUE`) |
| `kind` | String | required | descriptive label (e.g. `SPIKE`, `DROP`) |
| `period` | String | required | e.g. `2026-08` |
| `baseline` | Json | required | `{ period, value }` baseline snapshot |
| `observed` | Json | required | `{ period, value }` current snapshot |
| `deviationPct` | Decimal | required | `|observed − baseline| / |baseline| × 100` |
| `status` | `AnomalyStatus` | default `OPEN` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Relations**: `dataset`.
- **Index**: `@@index([organizationId, workspaceId, createdAt])` for scan/list.

## 2. Recommendation

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `title` | String | required, max 200 | short summary |
| `severity` | `RecommendationSeverity` | required | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `category` | String | required | e.g. `REVENUE_DROP`, `COST_SPIKE`, `ORDER_ANOMALY` |
| `description` | String | nullable | longer explanation |
| `evidence` | Json | required | summary JSON (dataset, metric, period, values) |
| `source` | `RecommendationSource` | required | `ANOMALY`, `INVESTIGATION`, `RULE`, `SIMULATION`, `SYSTEM` |
| `datasetId` | UUID? | FK → Dataset, nullable | the dataset this pertains to |
| `suggestedAction` | String | nullable | deterministic text derived from the signal |
| `status` | `RecommendationStatus` | default `OPEN` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `DISMISSED` |
| `isRead` | Boolean | default `false` | notification-read tracking |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Index**: `@@index([organizationId, workspaceId, status, createdAt])` for surface listing.
- **Invariant**: `source` is one of the five allowed values; `suggestedAction` never contains invented figures.

## 3. AlertRule

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `name` | String | required, max 200 | user-visible rule name |
| `metricKind` | String | required | canonical metric key (e.g. `REVENUE`) |
| `condition` | `AlertCondition` | required | `GREATER_THAN`, `LESS_THAN`, `EQUAL_TO`, `CHANGES_BY` |
| `threshold` | Decimal | required | numeric threshold |
| `frequency` | `AlertRuleFrequency` | required | `DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM` |
| `cron` | String? | nullable | cron expression when `frequency: CUSTOM` |
| `recipients` | Json | required | array of email addresses |
| `enabled` | Boolean | default `true` | |
| `lastTriggeredAt` | DateTime? | nullable | |
| `createdById` | UUID | → User, required | owner |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Relations**: `createdBy` → User.
- **Index**: `@@index([organizationId, workspaceId, enabled])`.

## 4. Alert

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `ruleId` | UUID? | FK → AlertRule, nullable | the rule that fired |
| `title` | String | required, max 300 | |
| `severity` | `AlertSeverity` | required | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `message` | String | required | human-readable alert message |
| `evidence` | Json | required | `{ metricKind, currentValue, threshold, condition, period, datasetId }` |
| `status` | `AlertStatus` | default `OPEN` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| `isRead` | Boolean | default `false` | notification-read tracking |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Relations**: `ruleId` → `AlertRule`.
- **Index**: `@@index([organizationId, workspaceId, status, createdAt])`.

## 5. Report

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `kind` | `ReportKind` | required | `WEEKLY`, `MONTHLY`, `CUSTOM` |
| `title` | String | required, max 300 | |
| `content` | Json | nullable | rendered report content (`{ metrics: [...] }`) |
| `pdfUrl` | String? | nullable | generated PDF file URL/path (nullable until exported) |
| `status` | `ReportStatus` | default `DRAFT` | `DRAFT`, `GENERATED`, `FAILED` |
| `error` | String? | nullable | sanitized error when `status: FAILED` |
| `generatedById` | UUID? | → User, nullable | who triggered generation |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Index**: `@@index([organizationId, workspaceId, status, createdAt])`.

## 6. ReportSchedule

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `organizationId` | UUID | FK → Organization, required, indexed | tenant scope |
| `workspaceId` | UUID | FK → Workspace, required, indexed | |
| `reportId` | UUID | FK → Report, required, indexed | the report to generate |
| `frequency` | `ReportScheduleFrequency` | required | `DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM` |
| `cron` | String? | nullable | cron expression when `frequency: CUSTOM` |
| `timezone` | String | default `"UTC"` | |
| `recipients` | Json | required | array of email addresses |
| `enabled` | Boolean | default `true` | |
| `nextRunAt` | DateTime | required | next scheduled fire |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Relations**: `reportId` → `Report`.
- **Index**: `@@index([organizationId, workspaceId, enabled, nextRunAt])`.

## 7. EmailDelivery

| Field | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | UUID | PK | |
| `jobId` | UUID? | FK → Job, nullable | the `SEND_EMAIL` job row |
| `status` | `EmailDeliveryStatus` | default `QUEUED` | `QUEUED`, `SENT`, `FAILED`, `BOUNCED` |
| `from` | String | required | sender address |
| `to` | Json | required | array of recipient addresses |
| `subject` | String | required | |
| `template` | String | required | template name |
| `error` | String? | nullable | sanitized error when `status: FAILED`/`BOUNCED` |
| `sentAt` | DateTime? | nullable | |
| `createdAt` / `updatedAt` | DateTime | indexed | |

- **Relations**: `jobId` → `Job`.
- **Index**: `@@index([status, createdAt])` for worker claim.

## Enums

```text
enum AnomalyStatus     { OPEN, ACKNOWLEDGED, RESOLVED }
enum RecommendationSeverity { LOW, MEDIUM, HIGH, CRITICAL }
enum RecommendationSource   { ANOMALY, INVESTIGATION, RULE, SIMULATION, SYSTEM }
enum RecommendationStatus   { OPEN, ACKNOWLEDGED, RESOLVED, DISMISSED }
enum AlertCondition         { GREATER_THAN, LESS_THAN, EQUAL_TO, CHANGES_BY }
enum AlertRuleFrequency     { DAILY, WEEKLY, MONTHLY, CUSTOM }
enum AlertSeverity          { LOW, MEDIUM, HIGH, CRITICAL }
enum AlertStatus            { OPEN, ACKNOWLEDGED, RESOLVED }
enum ReportKind             { WEEKLY, MONTHLY, CUSTOM }
enum ReportStatus           { DRAFT, GENERATED, FAILED }
enum ReportScheduleFrequency { DAILY, WEEKLY, MONTHLY, CUSTOM }
enum EmailDeliveryStatus    { QUEUED, SENT, FAILED, BOUNCED }
```

## Relations Summary

- `Workspace` has many `AnomalyDetection`, `Recommendation`, `AlertRule`, `Alert`, `Report`, `ReportSchedule`, `EmailDelivery`.
- `Dataset` has many `AnomalyDetection` (optional).
- `AlertRule` has many `Alert`.
- `Report` has one `ReportSchedule`.
- `Job` has one `EmailDelivery`.
- All are under the single-account tenancy model (ADR-002): `User → Organization → Workspace`.
