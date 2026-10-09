---
id: 2
title: data layer implementation plan
stage: plan
date: 2026-09-18
surface: agent
model: opencode/big-pickle
feature: 002-data-layer
branch: 002-data-layer
user: bashartech
command: /sp.plan
labels: [plan, phase2, data-layer, constitution-gate]
links:
  spec: specs/002-data-layer/spec.md
  plan: specs/002-data-layer/plan.md
  research: specs/002-data-layer/research.md
  data-model: specs/002-data-layer/data-model.md
  ticket: null
  adr: null
  pr: null
files:
  - specs/002-data-layer/plan.md
  - specs/002-data-layer/research.md
  - specs/002-data-layer/data-model.md
  - specs/002-data-layer/contracts/errors.md
  - specs/002-data-layer/contracts/data-sources.md
  - specs/002-data-layer/contracts/imports.md
  - specs/002-data-layer/contracts/datasets.md
  - specs/002-data-layer/contracts/data-quality.md
  - specs/002-data-layer/contracts/analytics.md
  - specs/002-data-layer/contracts/dashboards.md
tests: []
---

## Prompt

"create plan and task then i will review"

## Response snapshot

Implemented the full `/sp.plan` stage for feature `002-data-layer`. Created `research.md` with 8 technical decisions (R1–R8): storage R2 w/ local fallback; streaming CSV+XLSX (exceljs) 200k row cap; 200-row sampling type inference ≥95% confidence; deterministic mapping rules (AI deferred to Phase 3); relational-split typed value tables; PostgreSQL-only external DB read-only with AES-256-GCM credentials; jobs table system of record + optional Redis BRPOP; dashboard config-only widgets with live computation. Created `plan.md` with Constitution Check gate (26 principles PASS), full project structure (new paths: `backend/workers/`, `backend/modules/data-sources|datasets|imports|analytics|dashboards|data-quality/`, `frontend/app/(app)/data-hub/`, `frontend/components/charts/`, `frontend/components/data/`, `frontend/app/(app)/dashboard/`), Phase 0/1 summaries, and complexity tracking (ADR-004/ADR-005 pending). Created `data-model.md` with 18 Prisma entities (DataSource, DataSourceCredential, DataSourceTable, ImportJob, ImportFile, Dataset, DatasetVersion, DatasetColumn, DatasetRow, DatasetTextValue, DatasetNumericValue, DatasetDatetimeValue, DatasetBooleanValue, DatasetRelationship, DataQualityReport, BusinessMetric, Dashboard, DashboardWidget) and 3 enums. Created 7 contract files: `errors.md` (error shapes, codes, HTTP mapping), `data-sources.md` (file + external-db POST, PATCH, SELECT), `imports.md` (list, detail, cancel, retry), `datasets.md` (list, detail, versions, rows, column-preserved reads), `data-quality.md` (reports, recompute, per-column warnings), `analytics.md` (metrics, compare-periods, group-by), `dashboards.md` (CRUD, widgets, preview with honest empty states).

## Outcome

- ✅ Impact: Complete implementation plan and all API contracts ready for user review → /sp.tasks (Phase 10: ADRs pending user consent).
- 🧪 Tests: Test architecture defined per FR-031: unit tests for lib/infer, lib/quality, lib/mapping-rules, lib/files, lib/analytics-sql (QUERY TEXT only), lib/storage, lib/parser; integration tests for data-sources, datasets, data-quality, imports, analytics, dashboard-preview, mapping-confirm, reimport, external-db, tenant-isolation; component tests for upload-form, dataset-view, dashboard-render, mapping-dialog, history-view, reimport-form, external-db-form. Tests write-first-and-must-fail per user story.
- 📁 Files: specs/002-data-layer/plan.md, specs/002-data-layer/research.md, specs/002-data-layer/data-model.md, specs/002-data-layer/contracts/*.md (7 files)
- 🔁 Next prompts: user verification → /sp.tasks → implement.
- 🧠 Reflection: Dashboard is P2 (not P1) because it depends on ready datasets + version history for change indicators. Relational-split value tables over JSONB chosen for queryability and type-safety over Phase 1 patterns. External DB and versioned updates deferred to P3 to prioritize the file-upload MVP (US1+US2) for fast user feedback.