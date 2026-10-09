# Quickstart Verification — Phase 1 (001-foundation)

**Date**: 2026-09-18
**Environment**: Windows PowerShell 5.1 · Node v24.13.0 · npm 11.6.2 · Neon Postgres · Next.js 16.3.5

## Running-server smoke test (quickstart §2–§4)

Started the backend with `npm run dev` (tsx watch, loads `backend/.env`) and exercised the Phase 1 flow over HTTP:

| Step | Request | Result |
| ---- | ------- | ------ |
| Health | `GET /api/v1/health` | `200 {status:"ok", version:"1.0.0"}` |
| Register | `POST /api/v1/auth/register` | `201`; created User (`OWNER`), Organization (`Smoke Org`), default Workspace, `dd_access`/`dd_refresh` cookies set |
| Session | `GET /api/v1/auth/me` | `200`; organization + workspace + Free subscription (`ACTIVE`, period ends 2026-10-18) |
| Entitlements | `GET /api/v1/entitlements` | `200`; Free plan, `aiInvestigations: 5`, boolean flags `false` |
| Audit | `GET /api/v1/audit-logs?pageSize=5` | `200`; one `auth.register` entry, actor resolved, no secrets |
| CORS | response headers | `access-control-allow-origin: http://localhost:3000`, `allow-credentials: true` |

The smoke-test account was deleted afterward (cascade removes org/workspace/session/audit rows).

Browser-only items (register → `/onboarding` UI, reload persistence, settings rename, sign-out redirect, theme toggle) are covered by the frontend component tests and the end-to-end HTTP behavior above; they require a human at the browser to visually confirm.

## Automated gate (quickstart §5)

### Backend (`backend/`)

| Command | Result |
| ------- | ------ |
| `npm run typecheck` | Pass (tsc --noEmit, clean) |
| `npm run lint` | Pass (eslint, 0 problems) |
| `npm run test` | Pass — **13 files, 52 tests** |

### Frontend (`frontend/`)

| Command | Result |
| ------- | ------ |
| `npm run typecheck` | Pass (tsc --noEmit, clean) |
| `npm run lint` | Pass (eslint, 0 problems) |
| `npm run test` | Pass — **6 files, 18 tests** |
| `npm run build` | Pass — Next.js 16.3.5, 23 routes generated |

## Gate failures found and fixed

1. **Prisma interactive transaction timeout** — registration exceeded the default 5s against the remote Neon endpoint. Fixed by setting `{ timeout: 30_000, maxWait: 15_000 }` on the register transaction.
2. **Rate limiter applied in tests** — the exported auth limiter now skips under `NODE_ENV=test`; a dedicated instance is exercised directly by the rate-limit test.
3. **Entitlement router shadowed 404s** — mounting `entitlementRouter` at `/api/v1` with router-level `requireAuth` caused unknown `/api/v1/*` paths to return `401` instead of `404`. Fixed by attaching `requireAuth`/`tenantGuard` per route.
4. **`react-hooks/set-state-in-effect`** — the theme toggle's mounted flag now uses `useSyncExternalStore` instead of `setState` in an effect.

All fixes are covered by the passing suites above.

## Verdict

Phase 1 gate is **GREEN**. Ready for Phase 2 (Data Layer).
