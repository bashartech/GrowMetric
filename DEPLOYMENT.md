# Deployment

The frontend and the backend are deployed as **separate origins** in every
environment, which breaks authentication unless the requests are made
same-origin. This project solves that with a rewrite proxy so that local
development and production run the exact same code path.

## How it works

```
browser ──► https://app.vercel.com/api/v1/ai/reports
               │
               └─ Next.js rewrite (frontend/next.config.ts) ──► https://space.hf.space/api/v1/ai/reports
```

`NEXT_PUBLIC_API_URL` is unset, so `frontend/lib/api-client.ts` resolves the API
base to the relative path `/api/v1`. Every request is therefore same-origin and
the `SameSite=lax` auth cookies are sent. The rewrite forwards it to
`BACKEND_ORIGIN`.

If you ever set `NEXT_PUBLIC_API_URL` to an absolute cross-origin URL, the
browser stops sending the cookies and every authenticated call returns 401. That
would additionally require `SameSite=None; Secure` on the backend cookies, which
is why the proxy is the supported path.

## Local development

Frontend (`.env.local`):

```
BACKEND_ORIGIN=http://localhost:4000
```

Two backend processes are required in `backend/` — the API does not start the
worker:

```
cd backend
npm run dev      # API on :4000
npm run worker   # job worker, polls Job/ImportJob every 2s
```

Without the worker, imports stay `QUEUED` and datasets and dashboards never
populate. Only one backend may listen on the port; a stale server on `:4000`
causes 401/422 and other old-behaviour errors.

## Frontend on Vercel

Project settings → Environment Variables:

| Variable | Value |
| --- | --- |
| `BACKEND_ORIGIN` | `https://<your-space>.hf.space` |
| `NEXT_PUBLIC_API_URL` | leave unset |

## Backend on Hugging Face Spaces

A Space runs a **single container**, and the API does not start the worker. Use
**two Spaces**:

**Space A — API.** `startup_command`:

```
npm run start
```

Run against a real build, so publish the Docker/SDK image and run migrations
once (see below) rather than `npm run dev`.

**Space B — worker.** `startup_command`:

```
npm run worker
```

The worker polls the same `Job`/`ImportJob` tables, so both Spaces must share
one database and identical `DATABASE_URL` and JWT secrets.

Required variables on both Spaces:

| Variable | Notes |
| --- | --- |
| `PORT` | `8000` on Hugging Face |
| `NODE_ENV` | `production` |
| `COOKIE_SECURE` | `true` (HTTPS is required) |
| `CORS_ORIGIN` | the Vercel origin, e.g. `https://app.vercel.app` |
| `DATABASE_URL` | the shared Postgres/Neon connection string |
| `JWT_ACCESS_SECRET` | ≥16 chars, identical on both Spaces |
| `ACCESS_TOKEN_TTL_MINUTES` | default `15` |
| `REFRESH_TOKEN_DAYS` | default `30` |
| `UPLOAD_DIR` | `./uploads` — a Space filesystem is ephemeral |
| `R2_*` | strongly recommended, see below |

`COOKIE_SECURE=true` is required in production; with `false` the browser will
never return the cookie over HTTPS.

### Object storage

Report PDFs and imported files are written through `backend/src/lib/storage.ts`.
When all four of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and
`R2_BUCKET_NAME` are set, objects go to Cloudflare R2; otherwise they fall back
to the local filesystem. A Space's local filesystem is **ephemeral**, so files
written there disappear on restart. Configure R2 on both Spaces.

## Migrations

Run Prisma migrations once against the production database, from a machine that
can reach it — not on every Space boot:

```
cd backend
npx prisma migrate deploy
```

## Custom domain

Adding a domain later needs no code change. Point the domain at Vercel and keep
`BACKEND_ORIGIN` pointed at the Space; the rewrite continues to work. If you
later also serve the API from a subdomain of the same root domain, that also
works, but the rewrite remains the simplest configuration.
