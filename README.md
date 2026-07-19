# Staff Scheduler

Workforce scheduling and shift-management system. Backend in Node.js +
TypeScript + Express + MySQL, frontend in React + TypeScript, optional
constraint-programming optimizer in Python (Google OR-Tools CP-SAT).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

## Features

### 1. Schedules and shifts

- **Schedules** — create, duplicate, and publish schedules per department
  and date range; lifecycle states (`draft` → `published` → `archived`).
- **Shift templates** — reusable shift definitions (time window, min/max
  staffing, required skills) that can be applied when building a schedule.
- **Shifts** — per-day instances created from templates or manually, each
  declaring start/end time, min/max headcount, and required skill set.
- **Assignments** — assign employees to shifts with full pre-assignment
  validation: double-booking, skill match, availability, compliance rules.
  Employees confirm, decline, or mark their own assignments complete.
- **Bulk assignment** — create multiple assignments in a single request
  with per-row validation and error reporting.
- **On-call rotations** — on-call periods per department with capacity
  limits and per-user assignment.

### 2. Automatic scheduling (optimizer)

Two interchangeable engines behind the same REST endpoint
(`POST /api/schedules/:id/generate`):

| Engine | Language | Dependency |
|---|---|---|
| Greedy TypeScript solver | TypeScript | none (default) |
| Google OR-Tools CP-SAT solver | Python 3.8+ | `pip install ortools` |

Both engines honour:

- **Hard constraints** — shift coverage requirements, no double-booking,
  skill requirements, declared availability, weekly hour caps.
- **Soft constraints** — employee preferences, workload fairness, minimum
  rest time between shifts, consecutive-day caps.

Switch engines at runtime with `OPTIMIZATION_ENGINE=or-tools` in
`backend/.env`. Constraint weights are configurable at call site.

### 3. Employee requests and approvals

- **Time off** — employees submit requests (vacation, sick, personal,
  other); managers approve or reject with optional notes; requesters may
  cancel while still pending. The optimizer and manual assignment
  validator both respect approved time off.
- **Shift swaps** — employee-to-employee swap requests; manager approves
  or declines; requester may cancel while pending. Approval runs
  compliance checks on both sides and atomically rewrites the
  `user_id` on both assignments. Both parties receive an in-app
  notification on approval or decline.
- **Policy exceptions** — one-off exception requests against scheduling
  policies, routed through the configurable approval matrix.

### 4. Workforce management

- **Employees** — full CRUD with skills, hourly rates, position,
  employee ID, phone; activate/deactivate without deleting the record.
- **Departments** — create and manage departments; assign a manager;
  track multi-department membership.
- **Organizational units** — arbitrary org tree (forest) with
  memberships, primary-unit designation, and org-unit-scoped
  permissions; supports manager chains for approval routing.
- **Employee loans** — temporary cross-unit transfer with start/end
  dates, reason, and an approval workflow.
- **User directory** — profiles with unlimited custom fields; vCard
  export (single user or bulk ZIP) and vCard import; contact-book
  integration with any vCard-compatible app.
- **Skill gap analysis** — per-department comparison of required vs
  available skills, surfaced as a coverage report.
- **Bulk import** — CSV import for employees and shifts with per-row
  validation and structured error reporting.

### 5. Security and access control

- **Authentication** — JWT in httpOnly cookies (never exposed to
  JavaScript); bcrypt password hashing (configurable rounds); login
  rate limiting; server-side token revocation on logout.
- **Two-factor authentication (2FA)** — TOTP (RFC 6238) with QR-code
  provisioning and single-use recovery codes; enforced at login when
  enabled on the account.
- **RBAC** — fully configurable roles and permission codes; permissions
  are resolved from the database on every request (no stale token
  state); org-unit scoping restricts data visibility to the user's
  assigned units.
- **Delegations** — temporary, expiring transfer of a user's roles to
  another user (e.g. vacation cover); automatically expires without
  manual cleanup.
- **Audit trail** — append-only audit log of privileged actions
  (who, what, when) with filterable querying for compliance and
  investigation.
- **Module system** — runtime feature flags: disabled modules return
  404 on their entire route subtree and disappear from the SPA menu.

### 6. Approval workflows

- **Configurable chains** — multi-step approval sequences defined per
  change type (time-off, shift swap, policy exception, employee loan).
- **Approver scopes** — `direct_manager`, `department_head`,
  `hr_manager`, `company_user`, `role_based`, `unit_manager_chain`.
- **Auto-approve** — steps can be set to auto-approve when the actor
  is the policy owner, cutting out unnecessary approval hops.
- **Escalation** — steps that remain un-actioned past a configurable
  deadline are automatically escalated.
- **Approval matrix** — per-change-type matrix mapping change types to
  approver scope; updatable at runtime without code changes.

### 7. Notifications and real-time updates

- **In-app notifications** — notification center with unread badge;
  events include assignment created, shift swap approved/declined,
  time-off approved/rejected, loan approved/rejected, and more.
- **Real-time events (SSE)** — Server-Sent Events stream
  (`GET /api/events/stream`) pushes live updates to the SPA without
  polling; no WebSocket dependency.

### 8. Calendar integration

Employees can subscribe to their personal shift schedule directly in
any calendar app that supports iCal (Google Calendar, Apple Calendar,
Outlook, Thunderbird, etc.).

**How it works:**

1. The employee generates a personal calendar token in
   **Settings → Calendar** (`POST /api/calendar/token`).
2. The token-protected iCal feed URL is displayed and can be copied
   with one click:
   ```
   GET /api/calendar/feed.ics?token=<token>
   ```
3. Paste the URL as a new subscribed/internet calendar in the calendar
   app of choice. The server responds with `ETag` and
   `Cache-Control: private, max-age=300`; clients that support
   `If-None-Match` skip re-downloading the feed when nothing has
   changed.
4. The feed updates automatically as assignments change — no manual
   refresh or re-subscription needed.

**Minimum refresh interval by client:**

| Client | Minimum achievable refresh |
|---|---|
| Google Calendar | ~12–24 h (enforced server-side by Google, not configurable by the user) |
| Apple Calendar (macOS/iOS) | 5 min (set "Auto-refresh: Every 5 minutes" in subscription settings) |
| Outlook desktop | 15–30 min (configurable in Calendar Properties → Update Limit) |
| Thunderbird | 1 min (configurable in calendar properties) |

> The iCal protocol is poll-based. For instant in-app updates, the
> SPA uses the SSE stream instead (see §7 above).

**Department feed** (managers and administrators only):
```
GET /api/calendar/department/:id.ics?token=<token>
```
Aggregates all shifts for a department into a single iCal feed. The
token's owner must hold `settings.manage` or be the manager of the
target department.

**Token rotation:** tokens are non-expiring but can be rotated at any
time (**Settings → Calendar → Rotate token**). Rotating invalidates
the old URL — any existing calendar subscriptions must be updated with
the new URL.

### 9. Reports and analytics

- **Dashboard** — live KPIs: active headcount, open schedules, today's
  shifts, pending approvals, monthly hours, monthly cost, coverage
  rate. Panels for recent audit activity and upcoming shifts.
- **Hours report** — hours worked per employee for a selected schedule
  or date range.
- **Cost report** — cost by department, computed from shift hours ×
  hourly rate.
- **Fairness report** — per-schedule workload distribution metrics used
  to evaluate optimizer fairness.

### 10. Employee preferences

Per-user scheduling constraints consumed by the optimizer:

- `maxHoursPerWeek` / `minHoursPerWeek`
- `maxConsecutiveDays`
- `preferredShifts` — preferred shift templates
- `avoidShifts` — shift templates to avoid
- `notes` — free-text notes to the scheduler

Preferences are stored in `user_preferences` and surfaced under
**Settings → Work Preferences**.

### 11. System and administration

- **System settings** — runtime configuration (currency, default time
  period) editable by administrators at `GET/PUT /api/settings`.
- **API documentation** — full OpenAPI 3.1 contract served as Swagger
  UI at `http://localhost:3001/api/docs` and as a static file at
  `backend/openapi/openapi.json`.
- **Frontend SPA** — responsive React 18 SPA with Bootstrap 5,
  light/dark theme toggle, accessible tables and forms (ARIA labels,
  keyboard navigation), React error boundaries, and a demo-mode banner.

## How it works

1. **Model the organization** — an administrator creates departments
   and/or org units, defines roles and permissions (RBAC), and registers
   employees with their skills, hourly rates, and memberships.
2. **Define the work** — shifts are created per schedule and department
   (directly or from templates), each declaring time window, min/max
   staffing, and required skills.
3. **Build the schedule** — assignments are created manually (validated
   against double-booking, skills, and availability) or generated by the
   optimizer, which honours time off, preferences, policies, and hour
   caps. The schedule is then published.
4. **Run the day-to-day** — employees confirm or decline assignments,
   request time off and shift swaps, and see their calendar feed update;
   managers approve requests (optionally through multi-step approval
   workflows) and monitor coverage from the dashboard and reports.
5. **Govern and audit** — every privileged action lands in the audit
   log; modules can be switched off at runtime; delegations cover
   absences without permanent role changes.

## Roadmap

Planned work and explicitly out-of-scope items are tracked on the
GitHub Project board (the feature overview above covers what is
implemented today):

- **Roadmap board (Projects v2)**:
  [github.com/users/lucaosti/projects/2](https://github.com/users/lucaosti/projects/2)

Each capability is tracked as a GitHub Issue tagged with
`type:capability`, plus an `area:*` label (`area:backend`,
`area:frontend`, `area:database`, `area:optimizer`, `area:docs`) and a
`capability:*` label (`capability:core`, `capability:out-of-scope`).
Useful filters:

- All capabilities:
  [`label:type:capability`](https://github.com/lucaosti/StaffScheduler/issues?q=label%3Atype%3Acapability)
- Implemented core capabilities (closed as completed):
  [`label:capability:core is:closed reason:completed`](https://github.com/lucaosti/StaffScheduler/issues?q=label%3Acapability%3Acore+is%3Aclosed+reason%3Acompleted)
- Explicitly out-of-scope items:
  [`label:capability:out-of-scope`](https://github.com/lucaosti/StaffScheduler/issues?q=label%3Acapability%3Aout-of-scope)

The Project exposes three custom fields used by the views:

- `Lifecycle` — `Backlog`, `In progress`, `Blocked`, `Done`, `Out of scope`.
- `Area` — `Backend`, `Frontend`, `Database`, `Optimizer`, `Docs`.
- `Capability` — `Core`, `Nice-to-have`, `Out-of-scope`.

The "Out of scope" items are intentional design choices (this is an
open-source self-hosted core, not a SaaS product). Pull requests
addressing them are welcome — see [§12 Development guidelines](./DOCUMENTATION.md#12-development-guidelines).

## Documentation

- Full technical reference: [`DOCUMENTATION.md`](./DOCUMENTATION.md) — architecture, API, RBAC, scheduling engine, module system, development guidelines, architectural decisions.
- API contract (authoritative): [`backend/openapi/openapi.json`](./backend/openapi/openapi.json), served live at `http://localhost:3001/api/docs` (Swagger UI).
- Tooling instructions for Claude Code: [`CLAUDE.md`](./CLAUDE.md).

## Quick start

### Prerequisites

- Node.js >= 18
- MySQL >= 8 (or Docker for the demo profile below)
- npm >= 9

### Backend

```bash
cd backend
npm install
cp .env.example .env       # then edit DB_*, JWT_SECRET, etc.
npm run db:init            # creates the schema; no users, no demo data
npm run dev                # http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm start                  # http://localhost:3000
```

> **Note**: the frontend build tooling is Vite (`vite` + `@vitejs/plugin-react`). The former Create React App toolchain and its unpatchable transitive vulnerabilities were removed during the Vite migration; `npm audit --omit=dev` is clean.

### Startup modes

The project supports two mutually exclusive startup modes after `npm run db:init`:

| Mode | Command | Purpose |
|---|---|---|
| **Demo** | `npm run db:seed:demo` | Realistic fake dataset covering every feature. Safe to re-run (idempotent). |
| **Production** | `npm run db:seed:production` | Minimal real configuration from your own config file. No fake data inserted. |

### Demo mode

```bash
# One-shot orchestration: docker stack up + schema init + demo seed.
./scripts/demo.sh up

# Re-seed the demo dataset without restarting the stack
# (idempotent: TRUNCATE + reinsert, takes <10s).
./scripts/demo.sh reset

# Stop the stack and drop the volume (clean slate).
./scripts/demo.sh down

# Or directly on an existing DB:
cd backend && npm run db:seed:demo
```

Login: `admin@demo.staffscheduler.local / demo1234` (plus a few seeded
managers and employees in the same domain).

**Note**: Demo credentials only — do not use for production or sensitive data.

How to know you are in demo mode: a sticky orange banner ("Demo
environment. Data may be reset at any time.") is rendered at the top of
the SPA. It is gated on `GET /api/system/info → { mode: "demo" }`,
which the seed sets in `system_settings(category='runtime', key='mode')`.

How to leave demo mode: never run `db:seed:demo`, or run
`./scripts/demo.sh down` and re-`npm run db:init`. Without the demo
seed the banner does not render and `demo1234` is not a valid password
against any account.

No demo or mock accounts are created automatically.

### Production mode (first deployment)

```bash
# 1. Copy the template — config.json is gitignored, never committed.
cp backend/scripts/fixtures/production/config.template.json \
   backend/scripts/fixtures/production/config.json

# 2. Open config.json and replace every TODO_ placeholder:
#    - admin credentials (change the password after first login)
#    - departments, skills, shift templates, system settings

# 3. Apply the schema, then seed.
cd backend
npm run db:init
npm run db:seed:production
```

The seed is idempotent for all entities except the admin user (created
only when the e-mail does not yet exist). It sets
`system_settings(runtime.mode = production)` so the demo banner is never
shown. Only the minimum viable configuration is inserted — no employees,
no schedules, no shifts. Add those through the UI after logging in.

## Schedule optimization with OR-Tools

The optional optimizer uses Google OR-Tools CP-SAT. It expects Python
3.8+ to be installed locally.

```bash
cd backend
pip3 install -r optimization-scripts/requirements.txt
python3 optimization-scripts/schedule_optimizer.py --help
```

The CP-SAT model encodes:

- Hard constraints: shift coverage, no double-booking, skill
  requirements, declared availability, weekly hour caps.
- Soft constraints: employee preferences, workload fairness, minimum
  rest between shifts, consecutive-day caps.

Constraint weights are configurable at call site; defaults live in the
service. The Python entry point is
`backend/optimization-scripts/schedule_optimizer.py`; the Node bridge is
`backend/src/optimization/ScheduleOptimizerORTools.ts`.

## Project layout

```
StaffScheduler/
├── backend/                       # Express + TypeScript REST API
│   ├── src/
│   │   ├── config/                # database / logger
│   │   ├── middleware/            # auth, validation
│   │   ├── routes/                # 25 mounted routers
│   │   ├── services/              # business logic (per-feature service)
│   │   ├── optimization/          # OR-Tools bridge
│   │   └── types/
│   ├── database/init.sql          # schema source of truth
│   ├── scripts/
│   │   ├── init-database.ts       # schema bootstrap
│   │   └── seed-demo.ts           # idempotent demo seed
│   └── openapi/openapi.json       # API contract (canonical)
├── frontend/                      # React + TypeScript SPA
│   └── src/{components,contexts,pages,services,types}/
├── scripts/demo.sh                # demo stack orchestrator
└── docker-compose.yml             # mysql + phpmyadmin (dev profile)
```

## Available commands

### Backend

```bash
npm run dev                # development server with hot reload
npm run build              # compile TypeScript
npm start                  # run compiled server

npm run db:init            # initialize schema (no data)
npm run db:seed:demo       # seed demo data (idempotent)

npm test                   # full Jest suite
npm run test:coverage      # coverage report
npm run lint               # ESLint
npm run lint:fix
npm run deadcode           # dead-code check (knip)

npm run sim:run            # workforce simulation harness (needs a seeded MySQL)
npm run sim:campaign       # multi-run simulation campaign (needs MySQL root credentials)
```

### Frontend

```bash
npm start                  # Vite dev server
npm run build              # production bundle
CI=true npm test -- --watchAll=false
npm run lint
```

### Docker (dev profile)

```bash
docker compose --profile dev up -d   # mysql + phpmyadmin
docker compose --profile dev down
```

### Demo profile

```bash
./scripts/demo.sh up | reset | down
```

## Configuration

Backend env vars (see `backend/.env.example` for the full list):

```env
NODE_ENV=development
PORT=3001

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=staff_scheduler

JWT_SECRET=change-me
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12

CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

OPTIMIZATION_ENGINE=typescript   # Scheduler engine: typescript (default) or or-tools
DB_POOL_LIMIT=30                 # MySQL connection pool size (default: 30)
DB_QUEUE_LIMIT=100               # Max queued connection requests (default: 100)
AUTH_PERMISSION_CACHE_TTL_MS=0   # Per-user auth-context cache; 0 (default) = resolve on every request
```

Frontend env vars:

```env
# Defaults to the relative '/api' (proxied by Vite in dev and nginx in Docker).
# Set only when the API lives on a different origin than the SPA.
REACT_APP_API_URL=/api
```

## Testing

The test suite is split per layer (services, routes, integration,
optimizer for the backend; component and service smokes for the
frontend). CI runs the same commands developers run locally:

```bash
cd backend  && npm run lint && npm run build && npm test
cd frontend && npm run lint && CI=true npm test -- --watchAll=false && CI=true npm run build
```

Optional headless e2e smoke tests (Playwright) live in `frontend/e2e/`. They run against a locally
running demo stack:

```bash
cd frontend
npx playwright install --with-deps chromium   # one-time
npm run test:e2e
```

## Technology stack

- Backend: Node.js, Express 4, TypeScript 5, MySQL 8 (`mysql2/promise`),
  JWT (`jsonwebtoken`), bcrypt, Winston, Zod, Jest, Supertest.
- Frontend: React 18, TypeScript, React Router v6, React Context, Bootstrap 5.
- Optimizer: Python 3.8+, Google OR-Tools (CP-SAT).
- Tooling: Docker Compose, GitHub Actions, Swagger UI, OpenAPI 3.1.

## Project policies

- **Contributing, code style, branching, review process**: see [`DOCUMENTATION.md` — §14](./DOCUMENTATION.md#14-contribution-and-review-process).
- **Security**: vulnerabilities must be reported privately — see [`DOCUMENTATION.md` — §15](./DOCUMENTATION.md#15-security-policy). Do not open public issues for security problems.
- **Issue / PR templates**: structured templates in [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE) and [`.github/pull_request_template.md`](./.github/pull_request_template.md).

## Continuous integration

Every pull request is gated by [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).
The following jobs **must** pass before a PR can merge into `main`:

| Job | What it does |
| --- | --- |
| `Backend (lint, typecheck, test, build)` | ESLint, `tsc --noEmit`, Jest unit/integration tests with coverage gates. |
| `Frontend (lint, test, build)` | ESLint, Jest + React Testing Library tests with coverage, production Vite build. |
| `Frontend e2e (Playwright) [required]` | Boots MySQL service, seeds demo data, starts the backend, runs Playwright against the Vite dev server. Uploads the HTML report (and traces on failure) as artifacts. |

Run the same checks locally with:

```bash
# Backend
cd backend && npm run lint && npm run build && npm run test:coverage

# Frontend
cd frontend && npm run lint && CI=true npm test -- --watchAll=false --coverage && npm run build

# E2E (requires Docker for MySQL or an already-seeded local DB)
cd backend && npm run db:seed:demo && npm run dev &
cd frontend && npm run test:e2e
```

## License

MIT. See [`LICENSE`](./LICENSE).

## Author

Luca Ostinelli — [@lucaosti](https://github.com/lucaosti).