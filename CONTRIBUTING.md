# Contributing to Staff Scheduler

Staff Scheduler is a fully open source workforce management system. Anyone is welcome to contribute — bug fixes, new features, documentation improvements, or anything else.

---

## Table of contents

1. [Getting started](#getting-started)
2. [Project structure](#project-structure)
3. [Development workflow](#development-workflow)
4. [Running tests](#running-tests)
5. [Code conventions](#code-conventions)
6. [Submitting a pull request](#submitting-a-pull-request)
7. [Adding a new API endpoint](#adding-a-new-api-endpoint)
8. [Adding a new frontend page](#adding-a-new-frontend-page)
9. [Database schema changes](#database-schema-changes)
10. [Issue reporting](#issue-reporting)

---

## Getting started

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18 |
| npm | 8 |
| MySQL | 8.0 |
| Python (optional, for optimizer) | 3.8 |

### Local setup

```bash
git clone https://github.com/lucaosti/StaffScheduler.git
cd StaffScheduler

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET

cd backend
npm install
npm run db:init          # creates schema (no data)
npm run db:seed:demo     # optional: load realistic demo data
npm run dev              # starts on http://localhost:3001

# Frontend (new terminal)
cd frontend
npm install
npm start                # starts on http://localhost:3000, proxies /api/* to 3001
```

### Docker (alternative)

```bash
./start-dev.sh           # spins up MySQL + backend + frontend in dev mode
./stop.sh                # tear down
```

---

## Project structure

```
StaffScheduler/
├── backend/
│   ├── database/
│   │   └── init.sql               # Full schema — single source of truth
│   ├── openapi/
│   │   └── openapi.json           # OpenAPI 3.1 spec (hand-maintained)
│   ├── optimization-scripts/
│   │   └── schedule_optimizer.py  # OR-Tools CP-SAT optimizer (optional)
│   └── src/
│       ├── config/                # env reads, database singleton, Winston logger
│       ├── middleware/            # auth guards, Zod validation, request-id
│       ├── routes/                # one file per resource, factory pattern
│       ├── schemas/               # Zod schemas shared between routes
│       ├── services/              # stateless business logic, SQL lives here
│       └── types/
│           └── index.ts           # canonical TypeScript interfaces (single source)
└── frontend/
    └── src/
        ├── contexts/              # React context (auth, etc.)
        ├── pages/                 # route-level components
        ├── components/            # reusable UI components
        ├── services/              # API client wrappers
        └── types/
            └── index.ts           # frontend type definitions
```

---

## Development workflow

1. **Fork** the repo and clone your fork.
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. Make your changes (see conventions below).
4. Run tests and checks locally (see [Running tests](#running-tests)).
5. Push and open a PR targeting `main`.
6. CI must pass before the PR can be merged.

Branch naming:

| Prefix | Use for |
|--------|---------|
| `feat/` | new feature |
| `fix/` | bug fix |
| `refactor/` | internal cleanup without behavior change |
| `docs/` | documentation only |
| `chore/` | dependency bumps, tooling |

---

## Running tests

### Backend

```bash
cd backend

npm run build            # TypeScript compile — must pass
npm run lint             # ESLint
npm run deadcode         # knip — detects unused exports
npm test                 # Jest (all suites)
npm run test:coverage    # Jest with coverage report
```

Run a single suite:
```bash
npx jest src/__tests__/schedule.service.test.ts
```

Run tests matching a name pattern:
```bash
npx jest --testNamePattern="should create schedule"
```

### Frontend

```bash
cd frontend

npm run lint
npx tsc --noEmit         # strict type check
npm test -- --watchAll=false --ci
```

### CI pipeline

Every pull request to `main` triggers the GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **Backend** — lint → dead-code check (knip) → TypeScript build → unit tests with coverage
2. **Frontend** — lint → TypeScript check → unit tests with coverage → production build
3. **E2E (Playwright)** — full stack (MySQL + backend + frontend) → Playwright tests

The PR cannot be merged if any check fails.

---

## Code conventions

### Language

- All code, comments, commit messages, and UI strings must be in **English**.
- Do not add JSDoc blocks or multi-line comment blocks. One short inline comment is the maximum, only when the *why* is non-obvious.

### Backend

- **No ORM.** Raw SQL via `mysql2/promise`. Every query goes through the service layer.
- **Types.** Do not duplicate types. Import from `src/types/index.ts`. No `@ts-ignore`.
- **Logging.** Use `logger` from `src/config/logger`. Never `console.log` or `console.error`.
- **Error handling.** Services throw `Error('X not found')` for 404 cases; routes map these to HTTP status codes. Do not throw HTTP concepts from services.
- **Route pattern.** Routes validate input (via Zod middleware), instantiate a service, call one method, return JSON. SQL and business logic live in the service.
- **Response format.** Every endpoint returns `{ success: true, data: T }` or `{ success: false, error: { code: string, message: string } }`. The `code` field is required in error responses.
- **Auth.** Protected routes apply `authenticate` first, then `requirePermission('permission.key')`. Do not gate auth on response shape — always check permission before processing input.
- **Service file size.** No service file should exceed 500 lines. Extract sub-classes if needed.
- **Tests.** New features need at least a unit test in `src/__tests__/`. Use `supertest` for route tests, plain Jest for service tests. Do not mock the database — use the pattern established in existing tests (mock `pool.execute`/`pool.getConnection` on the Pool object).

### Frontend

- Import `handleResponse` and `getAuthHeaders` from `./apiUtils` — never re-define them.
- Import `ApiError` from `./apiUtils` only when catching typed errors.
- No fake async (`setTimeout` to simulate calls). If something is not yet implemented, leave the handler empty with a comment.

### OpenAPI spec

When you add or change an endpoint, update `backend/openapi/openapi.json` to match. The spec is served interactively at `GET /api/docs`. Third-party frontend authors depend on this being accurate.

---

## Submitting a pull request

- Keep PRs focused — one feature or fix per PR.
- Write a clear PR description: what changed, why, and how to test it.
- All CI checks must be green before requesting a review.
- PRs are merged with a **merge commit** (not squash, not rebase), preserving history.
- After merge, delete your feature branch.

Commit message format:

```
type(scope): short description (#issue)

Optional longer explanation if the why is not obvious.
```

Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`.

---

## Adding a new API endpoint

1. Add the Zod schema to `backend/src/schemas/index.ts`.
2. Add the business logic to an existing service or create a new one in `backend/src/services/`.
3. Add the route handler to the appropriate file in `backend/src/routes/`, or create a new one and mount it in `backend/src/app.ts`.
4. Update `backend/openapi/openapi.json` with the new path.
5. Write tests in `backend/src/__tests__/`.

---

## Adding a new frontend page

1. Create the page component in `frontend/src/pages/`.
2. Add the API client wrapper in `frontend/src/services/` (use `handleResponse` + `getAuthHeaders` from `apiUtils`).
3. Add the route in `frontend/src/App.tsx`.
4. Add types to `frontend/src/types/index.ts` (do not duplicate from backend — keep them in sync manually).

---

## Database schema changes

All schema changes go in `backend/database/init.sql`. This file is the single source of truth for the schema — it is run from scratch on CI.

Guidelines:
- Use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` patterns where possible.
- Add foreign key constraints and indexes for every join column.
- If a migration changes existing data, add a note at the top of the PR describing the manual migration step needed for existing deployments.

---

## Issue reporting

Open a [GitHub issue](https://github.com/lucaosti/StaffScheduler/issues) with:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Backend/frontend version or commit hash
- Relevant logs (redact credentials)

Feature requests are welcome — describe the use case, not just the solution.
