# Staff Scheduler

Workforce scheduling and shift-management system. Backend in Node.js +
TypeScript + Express + MySQL, frontend in React + TypeScript, optional
constraint-programming optimizer in Python (Google OR-Tools CP-SAT).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

## Feature parity

Mapping the project's surface against the baseline expected of modern
workforce-scheduling tools. Each row is implemented end-to-end (backend
route + frontend page or service client) unless flagged as out-of-scope.

| Capability | Status | Backend | Frontend |
|---|---|---|---|
| Automated schedule generation (CP-SAT optimizer) | Implemented | `/api/schedules/:id/generate`, `services/AutoScheduleService`, `optimization/ScheduleOptimizerORTools` | `pages/Schedule` |
| Manual shift CRUD + drag-and-drop | Implemented | `/api/shifts`, `/api/assignments` | `pages/Shifts`, `pages/Schedule`, `components/DraggableList` |
| Recurring shift templates | Implemented | `/api/shifts/templates` (under `routes/shifts.ts`) | `pages/Shifts` |
| Availability + employee preferences | Implemented | `/api/preferences` | `pages/Settings` |
| Time-off (PTO) requests + approvals | Implemented | `/api/time-off` | `pages/Schedule`, `pages/Settings` |
| Shift swaps with approval workflow | Implemented | `/api/shift-swap` | `pages/Schedule` |
| Compliance / labor rules + audit-ready logs | Implemented | `services/ComplianceEngine`, `services/PolicyValidator`, `/api/audit-logs` | `pages/Policies` |
| Org hierarchy + employee loans across units | Implemented | `/api/org` | `pages/Org/OrgManagement` |
| Configurable approval matrix + policy exceptions | Implemented | `/api/policies`, `services/ApprovalMatrixService` | `pages/Policies` |
| On-call scheduling | Implemented | `/api/on-call` | `pages/Schedule` |
| Skills + skill-gap analysis | Implemented | `/api/skill-gap` (and `services/SkillService`) | `pages/Employees`, `pages/Org/OrgManagement` |
| Real-time notifications (in-app + SSE stream) | Implemented | `/api/notifications`, `/api/events/stream` | `components/Layout/Header`, notification toasts |
| Calendar export + per-user signed feed (iCal) | Implemented | `/api/calendar` | `pages/Settings` |
| Reporting / insights (hours, cost, fairness, coverage) | Implemented | `/api/reports`, `/api/dashboard` | `pages/Reports`, `pages/Dashboard` |
| Role-based access (admin / manager / employee) | Implemented | `middleware/auth` (`requireRole`, `requireAdmin`, `requireManager`) | route guards in `App.tsx` |
| Two-factor authentication (TOTP) | Implemented | `/api/auth/2fa` | `pages/Settings` |
| Bulk import (CSV employees / shifts, vCard) | Implemented | `/api/import`, `/api/directory` | `pages/Employees` |
| OpenAPI 3.1 contract + Swagger UI | Implemented | `/api/openapi.json`, `/api/docs` | n/a |
| Internationalization (English + Italian dictionary) | Implemented | n/a | `i18n/I18nContext`, `i18n/messages` |
| Light / dark / system theme | Implemented | n/a | `contexts/ThemeContext` |
| Demo mode banner + reset script | Implemented | `/api/system/info` | `components/DemoBanner` |
| Native mobile apps | Out of scope | responsive web only | responsive web only |
| Direct payroll integrations (ADP, Gusto, Xero, ...) | Out of scope | CSV export of timesheets only | n/a |
| GPS clock-in / kiosk attendance | Out of scope | n/a | n/a |
| SMS / push notifications | Out of scope | email via SMTP + in-app + SSE only | n/a |
| Multi-tenant SaaS billing | Out of scope | single-tenant deployment | n/a |
| LLM-driven natural-language scheduling | Out of scope | CP-SAT optimizer only | n/a |

The "Out of scope" rows are intentional; this is an open-source
self-hosted core, not a SaaS product. Pull requests adding any of them
are welcome (see [`CONTRIBUTING.md`](./CONTRIBUTING.md)).

## Canonical references

- API contract: [`backend/openapi/openapi.json`](./backend/openapi/openapi.json),
  served at `http://localhost:3001/api/docs` (Swagger UI).
- Architecture overview: [`TECHNICAL.md`](./TECHNICAL.md).
- API reference (curated, human-readable): [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md).
- Architecture conventions, coding standards, response envelope shape:
  [`CLAUDE.md`](./CLAUDE.md).
- Contribution guidelines: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

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

### First admin user

`npm run db:init` creates only the schema. There are no default
accounts. Either provision the first admin via the API (`/api/users`)
from a privileged session, or use the demo profile below to bootstrap a
working environment for evaluation.

## Demo data (optional)

The project ships an isolated, opt-in demo profile. Nothing in the
production path depends on it.

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

How to know you are in demo mode: a sticky orange banner ("Demo
environment. Data may be reset at any time.") is rendered at the top of
the SPA. It is gated on `GET /api/system/info → { mode: "demo" }`,
which the seed sets in `system_settings(category='runtime', key='mode')`.

How to leave demo mode: never run `db:seed:demo`, or run
`./scripts/demo.sh down` and re-`npm run db:init`. Without the demo
seed the banner does not render and `demo1234` is not a valid password
against any account.

No demo or mock accounts are created automatically.

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
```

### Frontend

```bash
npm start                  # CRA dev server
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
HOST=localhost

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=staff_scheduler

JWT_SECRET=change-me
JWT_EXPIRATION=7d
BCRYPT_ROUNDS=12

CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

Frontend env vars:

```env
REACT_APP_API_URL=http://localhost:3001/api
```

## Testing

The test suite is split per layer (services, routes, integration,
optimizer for the backend; component and service smokes for the
frontend). CI runs the same commands developers run locally:

```bash
cd backend  && npm run lint && npm run build && npm test
cd frontend && npm run lint && CI=true npm test -- --watchAll=false && CI=true npm run build
```

Optional headless e2e smoke tests (Playwright) live in
[`frontend/e2e`](./frontend/e2e/README.md). They run against a locally
running demo stack:

```bash
cd frontend
npx playwright install --with-deps chromium   # one-time
npm run test:e2e
```

## Technology stack

- Backend: Node.js, Express 4, TypeScript 5, MySQL 8 (`mysql2/promise`),
  JWT (`jsonwebtoken`), bcrypt, Winston, `express-validator`, Jest,
  Supertest.
- Frontend: React 18, TypeScript, React Router v6, React Context, Bootstrap 5.
- Optimizer: Python 3.8+, Google OR-Tools (CP-SAT).
- Tooling: Docker Compose, GitHub Actions, Swagger UI, OpenAPI 3.1.

## Project policies

- **Contributing**: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for code
  style, branching, review process, testing requirements, and the local
  CI-parity commands.
- **Code of Conduct**: contributors are expected to follow the
  [Code of Conduct in `CONTRIBUTING.md`](./CONTRIBUTING.md#code-of-conduct).
- **Security**: vulnerabilities must be reported privately — see the
  [Security Policy in `CONTRIBUTING.md`](./CONTRIBUTING.md#security-policy).
  Do not open public issues for security problems.
- **Issue / PR templates**: structured templates live in
  [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE) and
  [`.github/pull_request_template.md`](./.github/pull_request_template.md).

## Continuous integration

Every pull request is gated by [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).
The following jobs **must** pass before a PR can merge into `main`:

| Job | What it does |
| --- | --- |
| `Backend (lint, typecheck, test, build)` | ESLint, `tsc --noEmit`, Jest unit/integration tests with coverage gates. |
| `Frontend (lint, test, build)` | ESLint, Jest + React Testing Library tests with coverage, production CRA build. |
| `Frontend e2e (Playwright) [required]` | Boots MySQL service, seeds demo data, starts the backend, runs Playwright against the CRA dev server. Uploads the HTML report (and traces on failure) as artifacts. |

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