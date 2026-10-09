# Quickstart: Phase 1 — Foundation

**Feature**: `001-foundation`
**Goal**: Run both apps locally and verify the Phase 1 gate: registration → org + default workspace → onboarding; persistent session; protected routes; tenant isolation; settings; entitlements; audit.

## Prerequisites

- Node.js 20 LTS + npm
- A PostgreSQL database (Neon recommended)
- Windows PowerShell 5.1 (this project's shell)

## 1. Environment

Create `backend/.env` from `backend/.env.example`:

```dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require&pgbouncer=true&connection_limit=1"
JWT_ACCESS_SECRET="replace-with-32+byte-random-string"
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=false
CORS_ORIGIN="http://localhost:3000"
```

Create `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:4000/api/v1"
```

> `.env` / `.env.local` are gitignored. Never commit secrets.

## 2. Backend

```powershell
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```

Backend on `http://localhost:4000`. Health: `GET /api/v1/health`.

## 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend on `http://localhost:3000`.

## 4. Manual Verification (Phase Gate)

1. Open `http://localhost:3000/register`; register with a new email + org name.
2. Confirm redirect to `/onboarding` with the "Let's connect your business data" empty state.
3. Reload — still signed in. Visit `/overview` — renders shell, no fake data.
4. Open `/settings`; rename org + workspace; save; reload — persists in sidebar.
5. Sign out — protected routes redirect to `/login`.
6. Register a **second** account; confirm it cannot see the first account's org/workspace.
7. Inspect the database: each account has exactly one org, one default workspace, one Free subscription.
8. Check `audit_logs`: entries for register/login/logout/org.update/workspace.update with no secrets.

## 5. Automated Gate

```powershell
# backend
cd backend
npm run typecheck
npm run lint
npm run test

# frontend
cd frontend
npm run typecheck
npm run lint
npm run test
npm run build
```

All must pass before Phase 2 (Data Layer) begins.

## 6. Troubleshooting

- **Prisma connection errors**: confirm `DATABASE_URL` uses the pooled Neon endpoint and `sslmode=require`.
- **Cookies not set**: check `CORS_ORIGIN` matches the frontend origin and the API client sends `credentials: 'include'`.
- **401 loops**: clear cookies; ensure `JWT_ACCESS_SECRET` is stable between restarts.
- **Next.js 16**: read `frontend/node_modules/next/dist/docs/` before writing App Router code (breaking changes vs older versions).
