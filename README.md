# GrowMetric

**Decision Intelligence for growing businesses.**

GrowMetric turns your business data into confident decisions. It ingests your
sales, orders, customer, expense, inventory, and product data into one
analytics-ready workspace, then gives every decision-maker — analyst, manager,
founder — tools to *see* what changed, *understand* why, and *act* with
evidence instead of gut feel.

![logo](frontend/public/images/logo.png)

---

## Table of Contents

- [What GrowMetric is](#what-growmetric-is)
- [How it helps a company grow](#how-it-helps-a-company-grow)
- [Features](#features)
- [How a company uses GrowMetric (step by step)](#how-a-company-uses-growmetric)
  - [1. Connect data](#1-connect-data)
  - [2. Set up your workspace](#2-set-up-your-workspace)
  - [3. Get answers](#3-get-answers)
  - [4. Monitor continuously](#4-monitor-continuously)
  - [5. Report and act](#5-report-and-act)
- [Configuration & keys](#configuration--keys)
- [Deployment](#deployment)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)

---

## What GrowMetric is

GrowMetric is a multi-tenant, cloud-ready business intelligence platform that
sits on top of **your** data. It never locks you in:

- It reads from what you already have — CSV/Excel uploads **and** live,
  read-only connections to your PostgreSQL database (including Neon and other
  hosted Postgres).
- It understands the *meaning* of your columns (revenue, orders, customers,
  profit, expenses, inventory, quantity) through automatic and AI-assisted
  mapping, so it can reason about *business metrics*, not raw column names.
- It explains every output with evidence — the calculation, the SQL, the
  numbers and the periods compared — so a number you act on is auditable.

## How it helps a company grow

GrowMetric is built around the growth loop **Connect → Measure → Investigate →
Act → Monitor**:

| Capability | Business benefit |
|---|---|
| **One source of truth** | Everyone reads the same mapped, quality-checked datasets instead of competing spreadsheets. |
| **Faster time-to-insight** | What used to be a week of analyst time (pull data, clean it, pivot, present) becomes minutes. |
| **Evidence-backed answers** | Recommendations and investigations include the supporting numbers, so decisions survive scrutiny and accountability is clear. |
| **Early warning** | Automated anomaly scans and alert rules surface revenue dips, inventory shifts, and data-quality problems *before* they become quarterly surprises. |
| **Scenario thinking** | The Simulator lets you test "what if" behaviors and scenarios on real data before committing budget or headcount. |
| **Operational reporting** | Scheduled reports deliver the story straight to inboxes, so leadership stays informed without nagging the analyst. |
| **Trust & governance** | Role-based access, audit logs, and data-quality health make the platform safe for real financial and customer data. |
| **Lower cost of BI** | One platform replaces multiple BI/dashboard/automation subscriptions for a fraction of the tooling sprawl. |

Growth, concretely:

- **Find lost revenue fast.** When revenue dips, an Investigation pinpoints
  *which customers or regions* drove the change (MAIN + SUPPORTING findings)
  and flags *correlations* (explicitly non-causal) — so you fix the real driver.
- **Cut avoidable losses.** Anomaly alerts catch unusual expense runs,
  inventory stockouts, and metric deviations early.
- **Win more, keep more.** Customer-segment and product analysis through the
  dashboard and AI Analyst identifies what’s selling, who’s churning, and where
  to spend next.
- **Scale your team.** Mapped datasets + scheduled reports let a small team do
  what a BI department used to do, so the founder or manager can stay close to
  the numbers.

## Features

**Data Hub**
- Upload CSV/Excel files and re-import new versions of the same file.
- Connect to external **PostgreSQL** databases (read-only, TLS-required, Neon
  connection strings auto-parsed).
- Automatic column mapping with `semanticKey` confidence scores and an
  AI-assisted mapping suggestion flow (`mapping-rules` + mapping service).
- Data-quality health reports per dataset, and a full import history.

**Analyze**
- **Dashboard** — premium, design-led dashboards with dense metric tiles and
  ECharts visualizations.
- **AI Analyst** — an agentic chat assistant with tools that runs against your
  data (streaming), backed by a durable job queue (works even if the browser
  closes; stale runs are detected and taken over).
- **Investigations** — a deterministic pipeline that compares a target period
  (last 3 / 6 / 12 months) against the preceding baseline and produces
  evidence-backed findings: MAIN, SUPPORTING, and CORRELATION (clearly labeled
  as not causal).
- **Simulator** — behavioral studies and "what-if" scenarios to pressure-test
  decisions.
- **Recommendations** — actionable, evidence-linked suggestions.

**Monitor**
- **Alert Rules + Alerts** — rule-based alerts plus scheduled anomaly detection
  over your metrics with a self-adjusting baseline (not a single noisy period).
- **Notifications** — an in-app inbox for events.

**Reports**
- Scheduled reports generated from your data and delivered by **email**
  (SMTP/Brevo), with SNIPPET → report assembly, retries, and email links built
  from `APP_URL`.

**Administration**
- Multi-tenant organizations and workspaces with role-based access.
- **Audit logs** for governance.
- JWT access + refresh-token session handling (same-site cookies by default, so
  it works unchanged on a single domain or a split Vercel + Hugging Face
  deployment).

## How a company uses GrowMetric

### 1. Connect data

- **No keys, no code:** sign in, open **Data Sources**, and either upload a
  CSV/Excel file or paste a PostgreSQL connection string. For external
  engines, the app parses the URL, verifies host/credentials/database over a
  guaranteed read-only, TLS connection, and rejects anything that isn’t
  read-only PostgreSQL.
- Optional live database: create a read-only user in your Postgres and the
  platform streams only `SELECT` access via SSL.

### 2. Set up your workspace

- Give each team/tenant its own **organization + workspace** so data is
  isolated per environment.
- Review each import in **Datasets**: column mapping assigns business meaning
  (e.g. `total` → *revenue*, `date` → *order date*). Accept or override the
  suggested mapping. Check the **Data Quality** health panel before building
  anything on a dataset.
- Your dataset is now **analytics-ready** (each investigation requires an
  analytics-ready dataset).

### 3. Get answers

- Try the **AI Analyst**: ask in plain language — “why did revenue drop in
  September?” — and watch it work against your datasets with tools, streaming
  results.
- Use **Investigations**: pick a dataset, a mapped metric (revenue, orders,
  customers, profit, expenses, inventory, quantity), and a period
  **(Last 3 / 6 / 12 months)**. GrowMetric compares it against the equivalent
  preceding baseline and returns:
  - **MAIN** — the headline change (e.g. “Revenue fell 31.1% in Jul-Sep vs
    May-Jul”).
  - **SUPPORTING** — which customers/regions drove it, ranked.
  - **CORRELATION** — shifts in concentration, explicitly *not* causation.
- Use **Simulator** to test scenarios before committing spend.
- Read **Recommendations** for next actions with links back to the evidence.

### 4. Monitor continuously

- Create **Alert Rules** (“notify when daily revenue drops > X% vs baseline”).
- Let the built-in **anomaly detection** scan your mapped metrics on a schedule
  with a rolling multi-period baseline and alert-dedup window (no alert spam).
- Watch the **Notifications** inbox and the **Dashboard** for the latest state.

### 5. Report and act

- Schedule **Reports** to land in leadership email on a cadence (SMTP/Brevo),
  each with the report `APP_URL` link.
- Review **Audit Logs** to keep the process accountable.
- Take action — adjust pricing, inventory, or campaigns — knowing the number is
  evidence-backed and reproducible.

## Configuration & keys

All runtime configuration is via environment variables (see
`backend/.env.example`). The important ones a company must set:

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Neon / Postgres connection string (`sslmode=require`) | yes |
| `JWT_ACCESS_SECRET` | Signs access tokens (≥ 16 chars; use 32+ random bytes) | yes |
| `CORS_ORIGIN` | Frontend origin allowed to call the API | yes |
| `OPENROUTER_API_KEY` | AI provider key (free models available) | for AI features |
| `AI_MODEL` | e.g. `nvidia/nemotron-3-ultra-550b-a55b:free` | for AI features |
| `AI_ENABLED` | `true`/`false`; keeps AI surfaces honest when off | recommended `true` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` | S3-compatible (Cloudflare R2) object storage for uploads | recommended |
| `UPLOAD_DIR` | Local upload fallback (ephemeral in containers) | default `./uploads` |
| `COOKIE_SECURE` | `true` over HTTPS | production |
| `APP_URL` | Frontend public URL (email links) | optional |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Email delivery for scheduled reports | for reports |
| `DATA_SOURCE_ENCRYPTION_KEY` | AES-256-GCM encryption for external-DB credentials (32+ bytes) | recommended |
| `REDIS_URL` | Optional signal layer (Upstash); jobs table is the system of record — leave empty for single-instance | optional |

## Deployment

The platform is designed as three deployable pieces.

### Frontend → Vercel

- Root directory `frontend`, framework Next.js, build `npm run build`.
- Environment variable (build-time): `BACKEND_ORIGIN=https://<your-space>.hf.space`.
- The browser only calls its own origin; `next.config.ts` **server-side
  rewrites** `/api/v1/*` to the backend, so auth cookies stay first-party and
  no CORS configuration is needed.

### Backend → Hugging Face (Docker Space)

- Create a Space with **SDK = Docker**. Commit the `backend/` folder contents
  (the `Dockerfile` + `.dockerignore` live there).
- The `Dockerfile` is **multi-stage** and ends by starting **both** the HTTP API
  and the **job worker** inside the one container:

  ```dockerfile
  CMD ["sh", "-c", "node dist/src/workers/runner.js & node dist/src/server.js & wait -n"]
  ```

  - The API serves on `PORT` (set `PORT=7860`; expose `7860`).
  - The worker polls `Job`/`ImportJob` every 2 s and shares the same `DATABASE_URL`,
    so imports, investigations, anomaly scans, and scheduled reports all execute
    with **zero extra infrastructure** — no Redis required (optional for scale).
  - Set the Space **secrets**: `DATABASE_URL`, `JWT_ACCESS_SECRET`,
    `DATA_SOURCE_ENCRYPTION_KEY`, `CORS_ORIGIN`, `COOKIE_SECURE=true`,
    `OPENROUTER_API_KEY`, `AI_MODEL`, `APP_URL`, and the `R2_*` block.
- Provision the database once: `npx prisma migrate deploy` then
  `npx tsx prisma/seed.ts` (creates the plans entitlements check).

> Tip: free Spaces sleep on inactivity (cold start on the first request); a
> paid Space with sleep disabled keeps it warm for production use.

### Local development

Requires Node.js 20+ (ESM). See `backend/.env.example` for the key list above.

```bash
# Backend (two processes — the API does not start the worker):
cd backend
npm i && npx prisma generate
npm run dev        # API on :4000
npm run worker     # job worker (polls every 2s)

# Frontend:
cd frontend
npm i
npm run dev        # http://localhost:3000 (proxies /api/v1 to :4000)
```

## Tech stack

- **Frontend:** Next.js (React, TypeScript), Tailwind CSS, shadcn/ui, TanStack
  Query, ECharts.
- **Backend:** Node.js 20 (ESM), Express, TypeScript, Prisma — HTTPS-friendly
  layered architecture (routes → controllers → services → data).
- **Data:** Neon PostgreSQL (serverless Postgres); read-only external Postgres
  engines; Cloudflare R2/S3 for object storage; Upstash Redis optional.
- **AI:** Agentic analyst on an OpenAI-compatible provider (OpenRouter default);
  deterministic investigation/analytics pipelines; pino logging.

## Project structure

```text
business_management/
├── frontend/            # Next.js app (Vercel) + Dockerfile
├── backend/             # Express API + job worker (Docker Space) + Dockerfile
│   └── prisma/          # schema + seed (plans)
├── tests/               # shared test fixtures / e2e helpers
├── specs/               # feature plans (006-premium-dashboard, …)
└── AGENTS.md            # development guidelines
```