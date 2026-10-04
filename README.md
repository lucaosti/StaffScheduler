# Staff Scheduler

Workforce scheduling and shift-management system: a Node.js + TypeScript +
Express + MySQL API, a React + TypeScript SPA, a Capacitor mobile wrapper, and
a constraint-programming optimizer in Python (Google OR-Tools CP-SAT) with a
TypeScript greedy fallback.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)
![React](https://img.shields.io/badge/react-18-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Testing and continuous integration](#testing-and-continuous-integration)
- [Documentation](#documentation)
- [Technology stack](#technology-stack)
- [Contributing, security, license](#contributing-security-license)

## Features

Every item below is implemented. Known gaps are tracked as
[issues](https://github.com/lucaosti/StaffScheduler/issues), not listed here.

### Scheduling

- **Schedules** per department and date range with a `draft` → `published` →
  `archived` lifecycle; duplicate a schedule onto a new period; a schedule can
  continue from a chosen predecessor.
- **Shifts** with time window, minimum and maximum staffing and required
  skills, including overnight shifts. **Shift templates** are maintained as
  reusable definitions.
- **Assignments** validated before they are written: double-booking, skills,
  availability, working-time limits and compliance rules. Bulk creation with
  per-row results. Employees confirm or decline their own.
- **On-call periods** per department with capacity limits.
- **Timeline** view of shifts, on-call and absences across org units.

### Automatic scheduling

`POST /api/v1/schedules/:id/generate` runs one of two engines held to a single
constraint definition by a parity test suite:

| Engine | Role | Requires |
|---|---|---|
| OR-Tools CP-SAT (Python) | default; optimal | Python with the pinned `ortools` |
| Greedy (TypeScript) | draft engine and signalled fallback | nothing |

When the solver is unavailable the run degrades to greedy and says so
(`engine: "greedy"`, `degraded: true`, a reason), and the UI marks the result
as a draft. With Redis configured, generation runs as a background job.
Replanning a published schedule produces a proposal that is reviewed before it
is applied. Constraints, objective levels and the fallback rules are in
[`DOCUMENTATION.md` §6](./DOCUMENTATION.md#6-scheduling-engine).

### Requests and approvals

- **Time off** — request, approve or reject, cancel while pending; approved
  absences are respected by both the optimizer and manual assignment.
- **Shift swaps** — the colleague whose shift is involved accepts first, then
  a manager approves; an open-shift board lets a shift be offered and claimed.
- **Policy exceptions**, **employee loans** between org units, and **change
  requests**, all routed through configurable multi-step **approval
  workflows** with approver scopes resolved from the org structure
  (`policy_owner`, `unit_manager`, `unit_manager_chain`, `company_role`,
  `company_user`, `responsibility_rule`, `unit_structure`), delegation of
  decisions, and escalation of overdue steps when the escalation endpoint is
  invoked.

### Workforce

- **Employees** with skills, hourly rate, position and contact data;
  deactivation instead of deletion; configurable per-organization field
  policies.
- **Employment contracts** — effective-dated working-time limits shared by
  name; **pairing rules** between employees.
- **Departments** and an arbitrary **org-unit tree** with memberships, manager
  chains, an org chart and an authority view.
- **Directory** with custom fields and vCard export (single card or a
  multi-card `.vcf`) and import with preview.
- **Skills catalogue** and **skill-gap analysis** per department.
- **CSV import** of employees and shifts with per-row validation.
- **Preferences** — preferred and avoided shifts and notes, set by the
  employee; working-time limits are set by a manager.

### Attendance

Clock in and out with optional geofencing, a kiosk mode, manager approval of
corrections, and export.

### Security and access control

- **Sessions** — short-lived access token and rotating refresh token in
  httpOnly cookies, with reuse detection and server-side revocation.
- **Two-factor authentication** — TOTP with recovery codes, passkeys
  (WebAuthn), and one-time codes by email.
- **Single sign-on** through OIDC providers.
- **RBAC** — configurable roles and permission codes resolved from the
  database on every request, scoped to org units; temporary, expiring
  **delegations**; a role history timeline.
- **Audit log** of privileged actions, filterable and exportable.
- **Module switches** for attendance, payroll, notifications, audit, reporting
  and integrations: a disabled module's routes answer 404.
- **Rate limiting** per caller and per organization, counted once for the
  whole deployment.

### Notifications and integrations

- **In-app notifications** and a live **Server-Sent Events** stream.
- **Email** through a transactional outbox, **Web Push**, and native push for
  the mobile app (FCM, APNs) — each active only when configured.
- **Calendar feeds** — personal, per-department and aggregate iCal
  subscriptions with named, individually revocable tokens.
- **Outbound webhooks** with signed deliveries and retries.
- **Payroll export** with a Gusto provider.

### Reporting

Dashboard KPIs, hours, cost and fairness reports with charts, cost plans
against actuals, a compliance-violation trend, and CSV/XLSX exports.

### Platform

- **Internationalization** — English, Italian, Spanish and Arabic (RTL), with
  per-organization translation overrides.
- **Mobile app** — a Capacitor wrapper of the SPA for iOS and Android.
- **API documentation** — OpenAPI 3.1 served as Swagger UI at
  `http://localhost:3001/api/docs`.
- **Operations** — Prometheus metrics, OpenTelemetry tracing, optional
  Grafana/Loki stack, scheduled backups with a tested restore, horizontal
  scaling behind nginx, optional read replica.

## How it works

1. **Model the organization** — an administrator creates departments and org
   units, defines roles and permissions, and registers employees with their
   skills, contracts and memberships.
2. **Define the work** — shifts are created per schedule and department, each
   declaring its time window, staffing and required skills.
3. **Build the schedule** — assignments are created manually or generated by
   the optimizer, which honours time off, preferences, contracts and policies.
   The schedule is then published.
4. **Run the day-to-day** — employees confirm assignments, request time off
   and swaps, and clock in; managers decide requests through the approval
   workflows and watch coverage from the dashboard and reports.
5. **Govern and audit** — privileged actions land in the audit log, modules
   can be switched off at runtime, and delegations cover absences without
   permanent role changes.

## Quick start

### Prerequisites

- Node.js >= 22.12 and npm >= 10
- MySQL 8 (or Docker for the demo stack)
- Python 3.11 with a virtual environment, for the CP-SAT optimizer
- Redis 7 (optional)

### Install

The repository is an npm-workspaces monorepo with a single root lockfile. One
install covers every workspace and compiles the shared contract package. Never
run `npm install` inside a workspace.

```bash
npm install
```

### Optimizer

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/optimization-scripts/requirements.txt
```

The backend spawns `python3` from `PATH`, so start it from a shell with the
environment active. Without it, generation uses the greedy engine and flags
the result as degraded.

### Backend

```bash
cd backend
cp .env.example .env       # set DB_*, JWT_SECRET
npm run db:init            # apply schema migrations; no users, no data
npm run dev                # http://localhost:3001
```

### Frontend

```bash
cd frontend
npm start                  # http://localhost:3000, proxies /api/* to the backend
```

### Startup modes

After `npm run db:init`, choose one:

| Mode | Command | Purpose |
|---|---|---|
| Demo | `npm run db:seed:demo` | Realistic fake dataset covering every feature. Idempotent. |
| Production | `npm run db:seed:production` | Minimal real configuration from your own config file. No fake data. |

### Demo mode

```bash
./scripts/demo.sh up       # docker stack + schema + demo seed
```

```bash
./scripts/demo.sh reset    # truncate and re-seed; the stack stays up
```

```bash
./scripts/demo.sh status   # is the stack up, is demo mode set
```

```bash
./scripts/demo.sh down     # stop the stack and drop its volumes
```

Login: `admin@demo.staffscheduler.local` / `demo1234`, plus seeded managers
and employees in the same domain. Demo credentials only.

In demo mode the SPA shows a sticky banner, driven by
`GET /api/v1/system/info` returning `mode: "demo"`. No demo account is ever
created outside the demo seed.

### Production mode (first deployment)

```bash
cp backend/scripts/fixtures/production/config.template.json \
   backend/scripts/fixtures/production/config.json
```

Replace every `TODO_` placeholder in `config.json` (administrator credentials,
departments, skills, shift templates, system settings), then:

```bash
cd backend
npm run db:init
npm run db:seed:production
```

The seed is idempotent, creates the administrator only if the address does not
exist, and inserts no employees, schedules or shifts. `config.json` is
git-ignored.

## Commands

### Backend (`cd backend`)

```bash
npm run dev                   # development server with hot reload
npm run build                 # compile TypeScript to dist/
npm start                     # run the compiled server

npm run db:init               # apply pending migrations (alias of db:migrate)
npm run db:migrate:status     # applied and pending migrations
npm run db:migrate:new -- <name>
npm run db:migrate:rollback   # roll back the most recent migration
npm run db:seed:demo
npm run db:seed:production

npm test                      # Jest suite (mocked database)
npm run test:coverage         # same, with the coverage gate
npm run test:integration      # integration suite against a real MySQL
npm run lint
npm run typecheck             # including tests and scripts
npm run deadcode              # knip
npm run deadcode:cycles       # madge
npm run deadcode:tests        # exports referenced only by tests
npm run openapi:generate      # regenerate openapi/openapi.json from the schemas

npm run sim:run               # workforce simulation (needs a seeded MySQL)
npm run sim:campaign          # multi-run campaign (needs MySQL root credentials)
```

### Frontend (`cd frontend`)

```bash
npm start                     # Vite dev server
npm run build                 # production bundle
npm test                      # Jest, single pass
npm run test:coverage
npm run test:e2e              # Playwright, against a running stack
npm run lint
npm run deadcode
npm run api:generate          # regenerate the typed client from the OpenAPI spec
```

### Mobile (`cd mobile`)

```bash
npm run build                 # build the SPA, copy it, sync native projects
npm run open:ios
npm run open:android
```

### Repository root

```bash
npm run audit:deps            # dependency audit gate
npm run test:scripts          # tests of the audit gate
```

### Docker

```bash
./start.sh                    # all services, production mode
./start-dev.sh                # development mode with volume mounts
./stop.sh
./build.sh
```

```bash
docker compose --profile dev up -d      # the stack plus phpMyAdmin
docker compose --profile ops up -d      # plus Prometheus, Grafana, Loki, Promtail, backups
docker compose --profile backup up -d   # plus scheduled backups only
```

## Configuration

The annotated list of every variable is
[`backend/.env.example`](./backend/.env.example). The minimum to boot:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=staff_scheduler
DB_USER=scheduler_user
DB_PASSWORD=...
JWT_SECRET=...
```

Defaults worth knowing:

| Variable | Default | Meaning |
|---|---|---|
| `JWT_EXPIRES_IN` | `15m` | access-token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | session length; the refresh token rotates on every use |
| `OPTIMIZATION_ENGINE` | `or-tools` | `or-tools` or `greedy` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` | `60000` / `200` | per-caller request budget |
| `RATE_LIMIT_ORG_MAX_REQUESTS` | `2000` | per-organization budget |
| `REDIS_ENABLED` | `true` | shared caches, SSE fan-out and the job queue; in-process fallback when Redis is unreachable |
| `CORS_ORIGIN` | `http://localhost:3000` | allowed SPA origin |

Email, push, SSO, payroll, tracing, metrics authentication and the read
replica are off until their variables are set; each is described where it is
documented in [`DOCUMENTATION.md`](./DOCUMENTATION.md).

The SPA reads its API base from `REACT_APP_API_URL` at **build time** (default
`/api/v1`, served through the dev proxy or nginx). Set it in the build
environment only when the API lives on a different origin.

## Project layout

```text
StaffScheduler/
├── packages/shared/        Zod schemas and domain types: the API contract
├── backend/
│   ├── src/                Express app, routes, services, optimization, observability
│   ├── db/migrations/      schema source of truth (dbmate SQL migrations)
│   ├── optimization-scripts/   Python CP-SAT solver
│   ├── openapi/            generated API contract
│   └── scripts/            migrations wrapper, seeds, OpenAPI generator, simulation
├── frontend/
│   ├── src/                pages, components, hooks, services, i18n, generated client
│   └── e2e/                Playwright specs
├── mobile/                 Capacitor wrapper (iOS, Android)
├── ops/                    Prometheus, Grafana, Loki, Promtail, nginx, backup, deploy
├── scripts/                demo-stack orchestration, dependency-audit gate
└── docker-compose*.yml     stack, scaling overlay, optional profiles
```

The internal structure of each part is in
[`DOCUMENTATION.md` §1](./DOCUMENTATION.md#1-architecture-overview).

## Testing and continuous integration

Tests are layered: unit tests against mocks, an optimizer parity suite, an
integration suite against a real MySQL, Playwright end-to-end tests, and a
backup-restore check. Every pull request must pass the three CI jobs in
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — backend, frontend,
and end-to-end — including coverage thresholds and a run of both suites
outside UTC.

The layers, the exact local gate and the rules for writing tests are in the
[contributing guide](./.github/CONTRIBUTING.md#testing).

## Documentation

| Document | Contents |
|---|---|
| [`DOCUMENTATION.md`](./DOCUMENTATION.md) | architecture, API reference, security and RBAC, scheduling engine, modules, operations, design decisions |
| [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md) | setup, workflow, coding standards, testing strategy, the gate every change must pass |
| [`backend/openapi/openapi.json`](./backend/openapi/openapi.json) | the API contract, served live as Swagger UI at `/api/docs` |
| [`backend/.env.example`](./backend/.env.example) | configuration variables |

Planned work is tracked only in
[GitHub Issues](https://github.com/lucaosti/StaffScheduler/issues).

## Technology stack

- **Monorepo**: npm workspaces — `backend`, `frontend`, `mobile`,
  `packages/shared`.
- **Backend**: Node.js 22, Express 5, TypeScript 5, MySQL 8 (`mysql2`) with
  dbmate migrations, Redis (`ioredis`), BullMQ, JWT, bcrypt, Zod, Winston,
  nodemailer, Jest, Supertest.
- **Frontend**: React 18, React Router 6, TanStack Query, React Hook Form with
  the Zod resolver, react-i18next, Bootstrap 5, Vite, Jest, React Testing
  Library, Playwright.
- **Mobile**: Capacitor 8.
- **Optimizer**: Python, Google OR-Tools CP-SAT; TypeScript greedy engine.
- **Operations**: Docker Compose, GitHub Actions, Prometheus, OpenTelemetry,
  Grafana, Loki.

## Contributing, security, license

- Contributions: read the [contributing guide](./.github/CONTRIBUTING.md).
  Every change starts from an issue.
- Security: report vulnerabilities privately, as described in
  [`DOCUMENTATION.md` §15](./DOCUMENTATION.md#15-security-policy). Do not open
  a public issue.
- License: MIT — see [`LICENSE`](./LICENSE).
- Author: Luca Ostinelli — [@lucaosti](https://github.com/lucaosti).
