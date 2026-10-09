---
id: 3
title: data layer task breakdown
stage: tasks
date: 2026-09-18
surface: agent
model: opencode/big-pickle
feature: 002-data-layer
branch: 002-data-layer
user: bashartech
command: /sp.tasks
labels: [tasks, phase2, data-layer, 96-tasks]
links:
  spec: specs/002-data-layer/spec.md
  plan: specs/002-data-layer/plan.md
  tasks: specs/002-data-layer/tasks.md
  ticket: null
  adr: null
  pr: null
files:
  - specs/002-data-layer/tasks.md
tests: []
---

## Prompt

"create plan and task then i will review"

## Response snapshot

Created `specs/002-data-layer/tasks.md`: 96 tasks organized across 10 phases, grouped by 7 user stories with tests written first per FR-031. Phase 1 (Setup): 6 tasks adding dependencies (exceljs, csv-parse, multer, file-type, pg, @aws-sdk/client-s3, ioredis, recharts), env plumbing, upload fallback dir, test fixtures/mock. Phase 2 (Foundational): 16 tasks — schema migration with 18 models + enums, seed BusinessMetrics, 9 core libs (storage, files, parser, infer, mapping-rules, quality, external-db, analytics-sql, upload middleware), worker loop+registry, 8 unit test files, entitlement hooks. Phase 3 (US1 MVP): 12 tasks — upload lifecycle (service, worker handler, controller, routes, mount), frontend data sources page + import status polling, 3 integration + 1 component tests. Phase 4 (US2): 11 tasks — datasets module (repo, service, routes), quality service + routes, frontend datasets page + quality page, 4 tests. Phase 5 (US3): 8 tasks — worker mapping-pause path, confirm-mapping endpoint, DTO enrichment, mapping-confirm dialog, 3 tests. Phase 6 (US4): 8 tasks — import metadata + versions, queries + frontend history/versions views, 3 tests. Phase 7 (US5): 11 tasks — metrics service + routes, dashboards service + routes + widget seeding, frontend recharts components + dashboard page, 4 tests. Phase 8 (US6): 11 tasks — external-db connector + credential encrypt + table discovery + sync handler, frontend external-db form, 4 tests. Phase 9 (US7): 7 tasks — commit-strategy handling, re-import endpoint, re-import form, 3 tests. Phase 10 (Polish): 6 tasks — ADR-004/005, security review, structured logging, quickstart verification, full phase gate, fix loop.

## Outcome

- ✅ Impact: Complete task breakdown ready for user review → begin implementation. 96 tasks with exact file paths, test-first requirements, parallel opportunities, and dependencies documented.
- 🧪 Tests: 38 test tasks total across all phases. Integration: data-sources-upload, datasets, data-quality, tenant-isolation-data, mapping-confirm, imports-history, versions, analytics, dashboard-preview, external-db, reimport (11). Unit: infer, mapping-rules, quality, files, analytics-sql, storage, parser, external-db-crypto (8). Component: upload-form, dataset-view, dashboard-render, mapping-dialog, history-view, reimport-form, external-db-form (7). Security/logging: logger (1). Quickstart verification: manual (1).
- 📁 Files: specs/002-data-layer/tasks.md
- 🔁 Next prompts: user review → implementation (T001 → T096).
- 🧠 Reflection: 96 tasks vs 89 in Phase 1 — slight increase driven by the 18 new data models, two additional user stories (external DB + versioned updates), and stricter test-first requirements on the data layer. The MVP (US1+US2) lands at T045 (~50% through the task list), ensuring fast user-visible progress before the P2/P3 stories.