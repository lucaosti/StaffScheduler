# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Staff Scheduler is an enterprise workforce management system.

- **Backend**: Node.js/Express/TypeScript REST API — runs on port **3001**
- **Frontend**: React 18/TypeScript SPA (Create React App) — runs on port **3000**
- **Database**: MySQL 8.0 (37 tables, schema in `backend/database/init.sql`)
- **Optimizer**: Python 3.8+ with Google OR-Tools CP-SAT, invoked via `child_process` from `backend/src/optimization/ScheduleOptimizerORTools.ts`

## Commands

### Backend (`cd backend`)

```bash
npm run dev          # Start dev server with hot reload (nodemon + ts-node)
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled production build
npm run db:init             # Initialize DB schema (no data)
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
npm test             # Interactive test runner
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
│   └── logger.ts              # Winston singleton — use this, never console.log/error
├── middleware/
│   ├── auth.ts                # JWT verification → req.user; authenticate, requirePermission, requireModule
│   ├── validation.ts          # Zod-based validateBody / validateParams helpers
│   └── requestContext.ts      # AsyncLocalStorage request IDs; X-Request-Id response header; getRequestId()
├── schemas/                   # Zod schemas shared across routes (imported by validateBody/validateParams)
├── routes/                    # One file per resource; factory pattern createXxxRouter(pool)
├── services/                  # Stateless business logic classes, constructed with Pool
│   ├── RbacService.ts         # Permission resolution, org-unit scoping, role grants
│   ├── DelegationService.ts   # Temporary authority transfer between users
│   ├── ApprovalEngineService.ts  # Multi-step configurable approval workflows, escalation
│   ├── ModuleService.ts       # Runtime module enable/disable with in-process cache
│   ├── AssignmentValidator.ts # Validation logic extracted from AssignmentService
│   ├── AssignmentOrchestrator.ts  # Orchestration logic extracted from AssignmentService
│   ├── ScheduleOptimizationOrchestrator.ts  # Optimization orchestration from ScheduleService
│   └── (other per-domain services)
└── optimization/
    ├── ScheduleOptimizerORTools.ts  # Spawns backend/optimization-scripts/schedule_optimizer.py
    └── ScheduleOptimizer.ts         # Pure-TypeScript fallback optimizer
```

**Route → Service pattern**: Routes validate input (via Zod middleware), instantiate a service, call one method, and return JSON. Services own all SQL and business rules; they throw named errors on failure.

**Auth middleware** (`src/middleware/auth.ts`):

- `authenticate` — Verifies JWT, loads the user from DB, resolves effective permissions via `RbacService.getEffectivePermissions()` (union of role grants + active delegations), computes `allowedOrgUnitIds` for org-unit scoping, and attaches the enriched `User` to `req.user`. Must be applied first on all protected routes.
- `requirePermission(code)` — Authorization guard; returns 403 if the authenticated user does not hold the given permission code. Apply after `authenticate`. Example: `requirePermission('schedule.manage')`.
- `requireModule(code)` — Feature-flag guard; returns 404 (not 401) for disabled modules. Apply before `authenticate` so the route is invisible to all callers when the module is off.
- `userHasPermission(user, code)` — Helper for finer-grained in-handler authorization checks without adding a middleware layer.

**Password reset**: implemented in `UserService`; the relevant route is wired through `createAuthRouter`.

**Error detection in routes**: Services throw `Error('X not found')` for 404 cases and `Error('X already confirmed')` for conflict cases. Routes check `error.message.toLowerCase().includes('not found')` in catch blocks to return 404 vs 500.

### Frontend

```
frontend/src/
├── index.tsx / App.tsx        # Entry point and React Router v6 routing
├── contexts/AuthContext.tsx   # Global JWT state (login / logout / token refresh)
├── services/
│   ├── apiUtils.ts            # Shared ApiError, handleResponse<T>, getAuthHeaders
│   └── (authService, employeeService, shiftService, scheduleService, ...)
├── pages/                     # Route-level components
├── components/                # Reusable UI components
└── types/index.ts             # Canonical TypeScript interfaces — single source of truth
```

All service files import `handleResponse` and `getAuthHeaders` from `./apiUtils`. Do not re-define them locally. Import `ApiError` from `./apiUtils` only if a specific service needs to catch or throw typed API errors.

The frontend proxies all `/api/*` requests to `http://localhost:3001` (via `"proxy"` in `frontend/package.json`).

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
- **Database**: No ORM. Raw SQL with `mysql2/promise`. All schema changes go in `backend/database/init.sql`. The password column is `password_hash` (never `password`).
- **Auth**: Protected routes apply `authenticate` middleware first, then `requirePermission('permission.key')` for the required permission code. Do not use `requireAdmin`, `requireManager`, or `requireRole` — these do not exist. Permission gating is always code-based.
- **Validation**: Use `validateBody(schema)` / `validateParams(schema)` from `src/middleware/validation.ts` with Zod schemas defined in `src/schemas/`. Do not use `express-validator`.
- **No fake async**: Do not simulate API calls with `setTimeout`. If a feature is not yet implemented, leave the handler empty with a comment — never show a false success alert.
- **Documentation files**: Only `README.md` and `DOCUMENTATION.md` as markdown files in the project root (plus `CLAUDE.md` and `.github/`). Do not create additional root-level `.md` files.
- **Sync docs on every code change**: When adding or modifying an endpoint, update `backend/openapi/openapi.json` and the relevant sections of `DOCUMENTATION.md` in the same PR.

## Authoring Rules

- **Single author**: All commits must be authored by `Luca Ostinelli <ostinelliluca2@gmail.com>`. No co-authors, no automated bot signatures.
- **No AI references**: Do not include any reference to Claude, Anthropic, AI tooling, or "Generated with…" footers in commit messages, source code, or documentation. The only exception is this `CLAUDE.md` file itself.
- **Verification before commit**: `git log --pretty='%an %ae %s' | grep -iE 'claude|anthropic|co-authored'` must return empty.
- **Branch naming**: one branch per feature/fix. Prefixes: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`.

## Environment Setup

Backend requires `backend/.env` (copy from `.env.example`):

```
DB_HOST=localhost  DB_PORT=3306  DB_USER=...  DB_PASSWORD=...  DB_NAME=staff_scheduler
JWT_SECRET=...  JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000
```

Note: `JWT_EXPIRES_IN` (default `24h`) controls the token lifetime — it is read into
`config.jwt.expiresIn` and applied at sign time in `src/routes/auth.ts`.

Frontend optionally uses `REACT_APP_API_URL=http://localhost:3001` (the dev proxy handles it by default).

## Optimization Engine

The Python OR-Tools optimizer is optional. To enable:

```bash
cd backend
pip3 install -r optimization-scripts/requirements.txt
python3 optimization-scripts/schedule_optimizer.py --help
```

Set `OPTIMIZATION_ENGINE=or-tools` in `backend/.env` to use it. Defaults to the TypeScript fallback.
