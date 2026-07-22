# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Staff Scheduler is an enterprise workforce management system.

- **Backend**: Node.js/Express/TypeScript REST API — runs on port **3001**
- **Frontend**: React 18/TypeScript SPA (Vite) — runs on port **3000**
- **Database**: MySQL 8.0 (44 tables, schema in `backend/db/migrations/` — dbmate SQL migrations)
- **Optimizer**: Python 3.8+ with Google OR-Tools CP-SAT, invoked via `child_process` from `backend/src/optimization/ScheduleOptimizerORTools.ts`

## Commands

The repository is an **npm workspaces monorepo**: run `npm install` once at the
repo root (single root `package-lock.json`; also compiles
`packages/shared`, the shared Zod-schema/type package both apps import).
Never run `npm install` inside `backend/` or `frontend/`.

### Backend (`cd backend`)

```bash
npm run dev          # Start dev server with hot reload (nodemon + ts-node)
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled production build
npm run db:init             # Apply all pending schema migrations (alias of db:migrate)
npm run db:migrate          # Apply all pending schema migrations (dbmate up)
npm run db:migrate:status   # Show applied/pending migrations
npm run db:migrate:new -- <name>  # Create a new empty migration file
npm run db:migrate:rollback # Roll back the most recent migration
npm run db:seed:demo        # Populate with realistic demo data (idempotent)
npm run db:seed:production  # Seed from scripts/fixtures/production/config.json (first deployment)
npm test             # Run all tests (Jest + ts-jest)
npm run test:watch   # Tests in watch mode
npm run test:coverage
npm run lint
npm run lint:fix
```

Run a single test file:
```bash
npx jest src/__tests__/meta-jest-verification.test.ts
```

Run tests by name pattern:
```bash
npx jest --testNamePattern="should create assignment"
```

### Frontend (`cd frontend`)

```bash
npm start            # Dev server; proxies /api/* to http://localhost:3001
npm run build        # Production bundle
npm test             # Run all tests (Jest, single pass — not a watch mode)
npm run test:coverage
npm run lint
```

### Docker (from project root)

```bash
./start.sh           # Start all services in production mode
./start-dev.sh       # Dev mode with volume mounts
./stop.sh
./build.sh
```

## Architecture

### Backend

The MySQL connection pool is created once in `src/index.ts` and **injected into every router factory** (`createAssignmentsRouter(pool)`, etc.). Each service receives the pool via its constructor. No global service singletons — except the `database` singleton in `src/config/database.ts`, used directly by health checks and the auth middleware.

```
backend/src/
├── index.ts                   # Express app bootstrap, pool creation, route mounting
├── config/
│   ├── index.ts               # All env var reads; fail-safe defaults
│   ├── database.ts            # Singleton Database class (pool, query helpers, transactions)
│   ├── redis.ts               # Redis client (on by default; in-process fallback)
│   └── logger.ts              # Winston singleton — use this, never console.log/error
├── errors/                    # AppError hierarchy — services throw these, never format HTTP
├── middleware/
│   ├── auth.ts                # JWT verification → req.user; authenticate, requirePermission, requireModule
│   ├── validation.ts          # Zod-based validateBody / validateParams helpers
│   ├── asyncHandler.ts        # Wraps route handlers; errors go to the central errorHandler
│   └── requestContext.ts      # AsyncLocalStorage request IDs; X-Request-Id response header; getRequestId()
├── observability/
│   ├── metrics.ts             # Prometheus registry, HTTP histogram, DB-pool + queue gauges
│   ├── tracing.ts             # OpenTelemetry SDK (env-gated) + request-id span correlation
│   └── otel-bootstrap.ts      # Imported FIRST by index.ts so instrumentation can patch libs
├── schemas/                   # Re-exports the canonical Zod schemas from @staff-scheduler/shared
├── routes/                    # One file per resource; factory pattern createXxxRouter(pool)
├── services/                  # Stateless business logic classes, constructed with Pool
│   ├── RbacService.ts         # Permission resolution, org-unit scoping, role grants
│   ├── DelegationService.ts   # Temporary authority transfer between users
│   ├── ApprovalEngineService.ts  # Multi-step configurable approval workflows, escalation
│   ├── ApprovalStateMachine.ts   # THE authority on legal approval transitions — see below
│   ├── OptimizationQueue.ts   # BullMQ schedule-optimization jobs (202 + status/cancel)
│   ├── MailerService.ts       # nodemailer transport, gated by isEmailConfigured()
│   ├── OutboxWorker.ts        # Delivers email_outbox rows (at-least-once, retries)
│   ├── ModuleService.ts       # Runtime module enable/disable with in-process cache
│   ├── AssignmentValidator.ts # Validation logic extracted from AssignmentService
│   ├── AssignmentOrchestrator.ts  # Orchestration logic extracted from AssignmentService
│   ├── ScheduleOptimizationOrchestrator.ts  # Optimization orchestration from ScheduleService
│   └── (other per-domain services)
└── optimization/
    ├── ScheduleOptimizerORTools.ts  # Spawns backend/optimization-scripts/schedule_optimizer.py
    └── constraintValidator.ts       # Canonical hard-constraint set both engines are held to
```

**Approval transitions**: every status change on `pending_approvals` derives its target
through `ApprovalStateMachine.nextState()` — never a status literal. The machine declares
the only legal transitions (pending → approved/rejected/escalated; those three terminal)
and throws `ConflictError` otherwise, so an illegal transition is impossible by
construction. Keep the raw-SQL `WHERE status = 'pending'` guard as the concurrency backstop.

**Notification emails** use a transactional outbox: `NotificationService.notify()` writes
the in-app row and (only when `isEmailConfigured()`) the `email_outbox` row in one
transaction; `OutboxWorker` delivers them with retries. Never send email inline from a
request handler.

**Route → Service pattern**: Routes validate input (via Zod middleware), instantiate a service, call one method, and return JSON. Services own all SQL and business rules; they throw named errors on failure.

**Auth middleware** (`src/middleware/auth.ts`):

- `authenticate` — Verifies JWT, loads the user from DB, resolves effective permissions via `RbacService.getEffectivePermissions()` (union of role grants + active delegations), computes `allowedOrgUnitIds` for org-unit scoping, and attaches the enriched `User` to `req.user`. Must be applied first on all protected routes.
- `requirePermission(code)` — Authorization guard; returns 403 if the authenticated user does not hold the given permission code. Apply after `authenticate`. Example: `requirePermission('schedule.manage')`.
- `requireModule(code)` — Feature-flag guard; returns 404 (not 401) for disabled modules. Apply before `authenticate` so the route is invisible to all callers when the module is off.
- `userHasPermission(user, code)` — Helper for finer-grained in-handler authorization checks without adding a middleware layer.

**Password reset**: implemented in `UserService`; the relevant route is wired through `createAuthRouter`.

**Error handling**: Services throw typed errors from `src/errors` (`NotFoundError` 404, `ConflictError` 409, `ForbiddenError` 403, `ValidationError` 400, `UnauthorizedError` 401); plain `Error` is reserved for internal faults (500). Route handlers are wrapped in `asyncHandler` (from `src/middleware/asyncHandler`) and do not catch errors — the central `errorHandler` middleware in `src/middleware/errorHandler.ts` renders the envelope. Never dispatch on `error.message` substrings (an ESLint rule enforces this in `src/routes`). Custom error codes (e.g. `TOTP_REQUIRED`, `INVALID_STATUS`, `DELEGATION_INVALID`) are preserved by catching the typed error in the route and re-rendering with the custom code.

### Frontend

```
frontend/src/
├── index.tsx / App.tsx        # Entry point and React Router v6 routing
├── contexts/AuthContext.tsx   # Global JWT state (login / logout / token refresh)
├── api/                       # Generated OpenAPI types (schema.ts) + typed fetch client
├── lib/queryClient.ts         # Shared TanStack Query client (one cache for the app)
├── hooks/                     # Server-state hooks: queries + mutations, one file per domain
├── services/
│   ├── apiUtils.ts            # Shared ApiError, handleResponse<T>, getAuthHeaders
│   └── (authService, employeeService, shiftService, scheduleService, ...)
├── pages/                     # Route-level components
├── components/                # Reusable UI (incl. QueryState, ErrorAlert)
├── test-utils/                # renderWithClient — render helper with an isolated QueryClient
└── types/index.ts             # Canonical TypeScript interfaces — single source of truth
```

**Server state belongs in TanStack Query hooks, not in components.** A page reads data
through a hook in `hooks/` and mutates through that hook's mutations, which invalidate the
affected query key. Do not add `useState` loading/error flags, mount-fetch effects, or
manual "reload after save" calls to a page — that is exactly what the hooks replace.
Gate optional fetches with `enabled` rather than conditional effects.

Wrap async regions in `QueryState` (and use `ErrorAlert`) so loading/error/empty states
look the same everywhere. **Any test that renders a component using a query hook must
import `render` from `src/test-utils/renderWithClient`** — plain RTL `render` throws
"No QueryClient set".

Forms use React Hook Form with `zodResolver` over the schema from
`@staff-scheduler/shared`, so client validation is the server's by construction (see
`CreateScheduleModal` for the pattern).

Service files use the generated typed client (`src/api/client`) where the endpoint exists
in the OpenAPI spec; otherwise they import `handleResponse` and `getAuthHeaders` from
`./apiUtils` — never re-defined locally. Import `ApiError` from `./apiUtils` only if a
service needs to catch or throw typed API errors.

The frontend dev server proxies all `/api/*` requests to `http://localhost:3001` (via `server.proxy` in `frontend/vite.config.ts`).

### API Response Contract

All backend endpoints follow this format:

```json
{ "success": true, "data": <T>, "message": "..." }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

The `code` field is required in all error responses.

## Key Conventions

- **Language**: All code, comments, UI strings, and documentation must be in **English**.
- **Logging**: Backend routes must use `logger.error(...)` (Winston). Never use `console.error`.
- **Type safety**: No `@ts-ignore`. No local type duplicates — import from `types/index.ts` (frontend) or `src/types/index.ts` (backend).
- **Database**: No ORM. Raw SQL with `mysql2/promise`. All schema changes are dbmate migrations in `backend/db/migrations/` (create one with `npm run db:migrate:new -- <name>`; every migration needs both `-- migrate:up` and `-- migrate:down` sections). Never edit an already-merged migration. The password column is `password_hash` (never `password`).
- **Auth**: Protected routes apply `authenticate` middleware first, then `requirePermission('permission.key')` for the required permission code. Do not use `requireAdmin`, `requireManager`, or `requireRole` — these do not exist. Permission gating is always code-based.
- **Validation**: Use `validateBody(schema)` / `validateParams(schema)` from `src/middleware/validation.ts` with Zod schemas from the shared package `@staff-scheduler/shared` (imported via `src/schemas`, which re-exports it — the package is canonical). Do not use `express-validator`. The OpenAPI request bodies and the frontend typed client are both generated from these schemas, so changing one updates the whole contract.
- **No fake async**: Do not simulate API calls with `setTimeout`. If a feature is not yet implemented, leave the handler empty with a comment — never show a false success alert.
- **Documentation files**: Only `README.md` and `DOCUMENTATION.md` as markdown files in the project root (plus `CLAUDE.md` and `.github/`). Do not create additional root-level `.md` files.
- **OpenAPI**: request bodies in `backend/openapi/openapi.json` are GENERATED from the shared Zod schemas — never edit them by hand; run `npm run openapi:generate` (backend) after changing a schema or a `validateBody` middleware (CI fails on drift). Curated prose (summaries, responses) is still edited in the file. Update `DOCUMENTATION.md` in the same PR when endpoints change.
- **Tests**: a test file that declares top-level `const`s but has no top-level `import`/`export` is a *global script* under ts-jest and its names collide with other suites (`TS2451: Cannot redeclare block-scoped variable`). Add `export {};` to such files. Frontend tests that render a component using a query hook must import `render` from `src/test-utils/renderWithClient`.
- **Database triggers**: always give a trigger a `BEGIN ... END` body, even for a single statement. `mysqldump` wraps trigger bodies in a `/*!50003 ... */` comment; with a bare single statement its terminating `;` lands inside that comment and the dump cannot be restored (the backup-restore CI job catches this).
- **Observability**: new metrics are registered on the shared registry in `src/observability/metrics.ts`. Never label a metric with a raw path, id or other unbounded value — use the matched route pattern, as the HTTP histogram does.

## Workflow (issue-first)

- **No significant change without a GitHub Issue.** Before implementing
  anything, check whether an adequate issue exists; if not, create one first.
  Every implementation, refactoring, bugfix or improvement starts from an
  issue, gets its own branch from main, and lands via a PR that references it
  (`Closes #n`). The development history must be reconstructable from
  issues and PRs alone.
- Issues are small, atomic, well described, and cross-linked when related.
  New ideas discovered mid-work become new issues, not scope creep.
- **GitHub Issues only** — do not use GitHub Projects, and remove any
  reference to them found in docs.
- Planned/aspirational work never lives in Markdown files: documentation
  describes the system as it exists; roadmap material belongs in issues.
- A change is complete only when implementation, tests, documentation and
  rationale comments (why this design, which alternatives were rejected and
  why) are all updated together in the same PR.

## Authoring Rules

- **Single author**: All commits must be authored by `Luca Ostinelli <ostinelliluca2@gmail.com>`. No co-authors, no automated bot signatures.
- **No AI references**: Do not include any reference to Claude, Anthropic, AI tooling, or "Generated with…" footers in commit messages, source code, or documentation. The only exception is this `CLAUDE.md` file itself.
- **Verification before commit**: `git log --pretty='%an %ae %s' | grep -iE 'claude|anthropic|co-authored'` must return empty.
- **Branch naming**: one branch per feature/fix. Prefixes: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`.

## Environment Setup

Backend requires `backend/.env` (copy from `.env.example`):

```
DB_HOST=localhost  DB_PORT=3306  DB_USER=...  DB_PASSWORD=...  DB_NAME=staff_scheduler
JWT_SECRET=...  JWT_EXPIRES_IN=15m  JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000
```

**Sessions**: short-lived access token (`JWT_EXPIRES_IN`, default `15m`) in the
`token` cookie, plus a rotating refresh token (`JWT_REFRESH_EXPIRES_IN`, default
`30d`) in the `refresh_token` cookie (scoped to `/api/auth/refresh`).
`RefreshTokenService` stores only the token hash, rotates on every `/refresh`,
and revokes the whole family on reuse of a spent token. `POST /api/auth/refresh`
is NOT behind `authenticate` — it works precisely when the access token has
expired. The frontend refreshes proactively (`AuthContext`) and on mount.

Frontend optionally uses `REACT_APP_API_URL=http://localhost:3001` (the dev proxy handles it by default).

**Optional subsystems**, all off/no-op unless configured — none is required to run locally:

| Env | Effect |
|---|---|
| `REDIS_URL` / `REDIS_ENABLED` | Shared caches, SSE fan-out and the BullMQ optimization queue. On by default with an in-process fallback; without Redis, `/generate` runs synchronously. |
| `METRICS_TOKEN` | Bearer token required to scrape `GET /metrics`. Unset leaves it open (dev only). |
| `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` | Starts OpenTelemetry tracing; spans carry `request.id`. |
| `EMAIL_HOST` + `EMAIL_USER` + `EMAIL_PASSWORD` | Enables real email delivery via the outbox. Without them no email intent is recorded at all. |

## Observability and operations

`GET /metrics` exposes Prometheus metrics; OpenTelemetry tracing is env-gated. The
optional stacks run as compose profiles: `docker compose --profile ops up` (Prometheus,
Grafana, Loki, Promtail — config in `ops/`) and `docker compose --profile backup up`
(scheduled `mysqldump` with retention; `ops/backup/`). Restores are proven by the
`backup-restore` CI job, not assumed.

The backend is stateless (shared state in Redis), so it scales horizontally:
`docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale backend=2`
puts N replicas behind an nginx load balancer, and `ops/deploy/rolling-deploy.sh`
performs a rolling deploy that **fails if any request is dropped**. Never give the
backend service a `container_name` — it would make the service un-scalable. Any nginx
proxying to `backend` must use the Docker resolver with a variable `proxy_pass`,
otherwise it pins to one replica. See DOCUMENTATION.md §10a for the runbooks.

## Optimization Engine

Two engines produce schedules: the Python OR-Tools CP-SAT solver (optimal) and a
TypeScript greedy engine (fast, best-effort). `OPTIMIZATION_ENGINE` selects which
runs — **default `or-tools`**:

- `or-tools`: attempt the optimum first. If Python/OR-Tools is unavailable the
  run degrades to greedy, but never silently — the result carries
  `engine: 'greedy'`, `degraded: true` and a reason, a warning is logged, and
  the UI flags the schedule as a draft.
- `greedy` (legacy alias `javascript`): use the greedy draft engine on purpose
  (`engine: 'greedy'`, `degraded: false`).

Install the Python solver:

```bash
cd backend
pip3 install -r optimization-scripts/requirements.txt
python3 optimization-scripts/schedule_optimizer.py --help
```

Both engines are held to one shared hard-constraint definition in
`backend/src/optimization/constraintValidator.ts`. The parity suite
(`backend/src/__tests__/optimizer.parity.test.ts`) runs both engines against it,
so any constraint drift between them is a red test. In CI the CP-SAT half is
mandatory (`REQUIRE_ORTOOLS=1`); locally it self-skips if OR-Tools is absent.
Any change to the scheduling constraints must update the validator first, then
both engines, keeping the parity suite green.
