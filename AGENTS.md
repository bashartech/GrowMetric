# business_management Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-09-18

## Active Technologies

- TypeScript 5.x; Node.js 20 LTS (ESM) (001-foundation)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test; npm run lint

## Code Style

TypeScript 5.x; Node.js 20 LTS (ESM): Follow standard conventions

## Recent Changes

- 001-foundation: Added TypeScript 5.x; Node.js 20 LTS (ESM)

<!-- MANUAL ADDITIONS START -->
## Running locally

Two processes are required in the `backend/` dir (the API does NOT start the worker):

- API: `npm run dev` (server.ts on `PORT`, default 4000)
- Job worker: `npm run worker` (polls `Job`/`ImportJob` every 2s)

Without the worker, imports stay `QUEUED` and datasets/dashboards never populate
("1 import / 0 datasets"). Only one backend should listen on the port — a stale
server on `:4000` causes 401/422 and old-behavior errors.

## Running the backend test suite

Stop the API and the job worker before running integration tests. The worker
shares the same `Job` table and will claim jobs the test created, so
`queue-automation` and `email-delivery` fail (job stuck `PENDING`, provider spy
never called) even though the code under test is correct.

```powershell
# in backend/
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'business_management\\backend' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
npx vitest run
```

Notes:

- Use `--maxWorkers=2`. At full parallelism the suite produces false failures
  (`expected 401 to be 200`, `expected 200 to be 403`) from Neon connection
  contention; every one of those files passes in isolation.
- `npx prisma generate` needs every backend process stopped, otherwise Windows
  fails with `EPERM ... rename query_engine-windows.dll.node`. The dev API and
  the worker both hold the DLL.
- Integration tests are slow (single files run 40s-3min). A full-suite run
  exceeds 50 minutes, so run it in directory chunks.

## External database connections

- Host accepts either a plain hostname (`ep-xxxx.region.aws.neon.tech`) or a full
  `postgresql://user:pass@host:5432/db` connection string (auto-parsed; password
  percent-decoded). Port/database/username/password resolve from the URL when pasted.
- Connections are always read-only (`default_transaction_read_only=on`), refused
  otherwise. ONLY PostgreSQL is supported as an external engine.
- Connect failures now surface the specific cause (host resolution, credentials,
  missing database, SSL / Neon IP allowlist); Neon cold starts may take a few seconds.
<!-- MANUAL ADDITIONS END -->
