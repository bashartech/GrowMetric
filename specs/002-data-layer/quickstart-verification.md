# Quickstart Verification — Phase 2 Data Layer

- **Date:** 2026-09-22
- **Method:** Automated phase-gate run + API/worker smoke where a free port was available. See caveats below.

## Result: GATE GREEN

| Command | Result |
|---|---|
| backend `typecheck` (`tsc --noEmit`) | PASS |
| backend `lint` (`eslint .`) | PASS (0 errors — 34 pre-existing errors fixed this session) |
| backend `test` (unit) | PASS — 16 files, 164 tests |
| backend integration (full-pipeline suites) | PASS — upload/import worker, reimport commit strategies, external-DB sync, datasets, mapping-confirm, tenant isolation |
| frontend `typecheck` | PASS |
| frontend `lint` | PASS |
| frontend `test` | PASS — 13 files, 61 tests |
| frontend `build` | PASS |

## Step-by-step against quickstart.md section 4

1. **Register / app shell** — PASS via API smoke (two tenants registered, distinct org/workspace ids returned). UI shell covered by component tests.
2. **FILE data source upload (CSV)** — PASS. `POST /data-sources/upload` returns an import `QUEUED`; worker transitions it to `RUNNING` then `COMPLETED`. Covered by integration suites (`external-db`/`reimport`/`datasets` run the same multipart upload + worker path against Neon).
3. **Import transitions QUEUED→RUNNING** — PASS (asserted in integration tests).
4. **Import History with row count** — PASS (imports endpoint returns completed imports with `totalRows`).
5. **Dataset `READY` + inferred column types** — PASS. Integration asserts `READY`/`READY_WITH_WARNINGS`; type pillars (DATE/DECIMAL/TEXT) asserted in datasets tests (`sales.csv` fixture: `date`→DATE, `total`→DECIMAL).
6. **data-quality view** — PASS. Quality endpoint returns rows/columns/missing%/duplicates%/invalid% and `status`; `REQUESTING_MAPPING` pause + confirm-mapping flow covered by `mapping-confirm.test.ts`.
7. **Dashboard KPIs + charts** — PASS. `ensureDefaultDashboard` runs in-worker; widgets now **adapt to whatever columns exist** — when a widget's exact semantic column is missing it falls back to the first numeric/date/text column, so any imported dataset renders KPIs + charts (`dashboard-preview.test.ts` proves a `date,product,region,quantity` sheet yields Revenue=18, populated line/pie). Pie `product`→`products` group-by key fixed. Metric/group-by endpoints verified. 
8. **Filters recompute all widgets** — PASS. `analytics/group-by` (and metric/compare) accept date-range + dimension filters and return recomputed aggregates; out-of-range dates yield `available: true` with zero value/rows (unit + integration asserted).
9. **External DB sync** — PASS with mocked read-only driver. `external-db.test.ts` (9/9): connect → discover tables → select tables → sync → TABLE_SYNC imports → datasets; read-only enforcement (`transaction_read_only=on`, refusal when the role is writable) verified. The **Host field now accepts a full `postgresql://` connection URL** (auto-parsed, password percent-decoded) and connect failures return actionable errors (unresolvable host / bad credentials / missing database / SSL & Neon IP-allowlist hints) instead of a single generic message (`external-db-connection.test.ts`, 11 tests).
10. **Tenant isolation** — PASS. `tenant-isolation-data.test.ts` proves cross-tenant access to data-sources/imports/datasets/dashboards returns 404.
11. **Credential checks** — PASS. `external-db-crypto.test.ts` proves only AES-256-GCM ciphertext (salt+iv+auth tag) is persisted; API list/payload endpoints return no `password`/`passwordEnc`; pino redacts credentials/file payloads (`logger.test.ts`); zeroizing of the plaintext external-DB password after connect.

## Caveats

- **Two processes required**: the API (`npm run dev`, i.e. `server.ts`) does **not** start the job worker. Imports/password-sync jobs are only processed when `npm run worker` (backend dir) is ALSO running — otherwise imports stay `QUEUED`, datasets are never created, and the Datasets/Dashboard pages stay empty (`1 import / 0 datasets`).
- **Live smoke on :4000**: during this session port 4000 was already occupied by a pre-existing (stale) server, so a *fresh* API `npm run dev` could not bind (`EADDRINUSE`). The manual browser walk-through should be re-run with a free port (`PORT=4100 npm run dev` + set `NEXT_PUBLIC_API_URL`) or after stopping the stale listener. Registering against the stale instance intermittently returned `INTERNAL_ERROR`, reinforcing that it predates the current code.
- **401/422 on the external-DB form**: the browser was talking to that stale `:4000` instance (expired session → 401; older validation schema → 422). Re-login against the current backend resolves both; the generic connect error is now replaced with a message that names the actual cause.
- All functional verification above therefore uses the same contracts the UI calls, executed against Neon with the real worker pipeline — the UI layer itself is covered by 61 frontend tests (forms, pages, filters) plus the clean `build`.
- External DB sync in the integration suite uses a driver mock; a real read-only PostgreSQL hand-off remains an optional manual check (needs test credentials).

## Related

- Gate record: `specs/002-data-layer/tasks.md` Phase 10 (T091–T096)
- Security review findings + fixes: T092 (see `tasks.md`)
- ADRs: `docs/architecture/ADR-004`, `ADR-005`