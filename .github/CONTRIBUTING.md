# Contributing to Staff Scheduler

This guide is the reference for anyone changing this repository: how to set it
up, how work is organised, what must pass before a pull request can merge, and
how the test suite is layered. Architecture, API and operations are documented
in [`DOCUMENTATION.md`](../DOCUMENTATION.md); this file covers the process and
links there instead of repeating it.

## Contents

1. [Ground rules](#ground-rules)
2. [Prerequisites](#prerequisites)
3. [Setup](#setup)
4. [Repository map](#repository-map)
5. [Workflow](#workflow)
6. [Coding standards](#coding-standards)
7. [Testing](#testing)
8. [The local gate](#the-local-gate)
9. [Continuous integration](#continuous-integration)
10. [Changing the API contract](#changing-the-api-contract)
11. [Changing the database schema](#changing-the-database-schema)
12. [Documentation](#documentation)
13. [Reporting bugs and proposing features](#reporting-bugs-and-proposing-features)
14. [Security policy](#security-policy)
15. [Project status](#project-status)

## Ground rules

- **Every change starts from a GitHub issue.** If no issue describes the work,
  open one first. One issue, one branch, one pull request.
- **Everything is in English**: code, comments, commit messages, documentation,
  issues and pull requests.
- **A change is complete only when implementation, tests and documentation are
  updated together**, in the same pull request.
- **Documentation describes what exists.** Planned work lives in issues, never
  in a Markdown file.
- **No backward-compatibility shims.** When something is replaced, the old path
  is removed in the same change.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22.12 or newer | everything (CI and both images run Node 22) |
| npm | 10 or newer | workspace install |
| MySQL | 8.0 | running the backend, integration tests, e2e |
| Python | 3.11 (CI) with a virtual environment | the CP-SAT optimizer and its tests |
| Redis | 7 | optional; the backend falls back to in-process state without it |
| Docker | with Compose v2 | optional; the demo stack and the `ops` / `backup` profiles |

## Setup

The repository is an npm-workspaces monorepo with a single root lockfile.
Install once, from the root; never run `npm install` inside a workspace.

```bash
git clone https://github.com/lucaosti/StaffScheduler.git
cd StaffScheduler
npm install
```

The install also compiles `packages/shared`, the Zod contract both applications
import.

### Optimizer environment

The scheduling engine's reference implementation is a Python CP-SAT model. The
backend spawns `python3` from `PATH`, so install the pinned solver in a virtual
environment and activate it in every shell that runs the backend or its tests.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/optimization-scripts/requirements.txt
```

Without it the application still runs (it degrades to the greedy engine and
says so), but **the backend coverage gate cannot pass**: see
[Coverage](#coverage).

### Database and servers

```bash
cp backend/.env.example backend/.env    # set DB_*, JWT_SECRET
cd backend
npm run db:init                         # apply migrations (no data)
npm run db:seed:demo                    # optional demo dataset
npm run dev                             # API on http://localhost:3001
```

```bash
cd frontend
npm start                               # SPA on http://localhost:3000
```

The dev server proxies `/api/*` to the backend. Startup modes, the demo stack
and production seeding are described in the [README](../README.md#quick-start).

## Repository map

| Path | Contents |
|---|---|
| `packages/shared/` | Zod schemas and domain types — the API contract, imported by both applications |
| `backend/` | Express 5 + TypeScript REST API, migrations, optimizer bridge, scripts |
| `backend/optimization-scripts/` | Python CP-SAT solver |
| `frontend/` | React 18 + TypeScript SPA (Vite), Playwright specs in `e2e/` |
| `mobile/` | Capacitor wrapper around the built frontend (iOS, Android) |
| `ops/` | Prometheus, Grafana, Loki, Promtail, nginx, backup and deploy scripts |
| `scripts/` | Demo-stack orchestration and the dependency-audit gate |
| `.github/` | Workflows, issue and pull-request templates, this guide |

The architecture of each part is in
[`DOCUMENTATION.md` §1](../DOCUMENTATION.md#1-architecture-overview).

## Workflow

### 1. Issue

Check for an existing issue; otherwise open one from the templates. Keep issues
small and atomic. Something discovered while working becomes a new issue, not
extra scope on the current one. Record progress, decisions and blockers as
comments on the issue, so the state of the work is readable from GitHub alone.

### 2. Branch

Branch from `main`, one branch per issue, named after the issue:

```text
<type>/<issue-number>-<short-kebab-description>
```

| Prefix | Use for |
|---|---|
| `feat/` | new capability |
| `fix/` | bug fix |
| `refactor/` | internal change, no behaviour change |
| `docs/` | documentation only |
| `chore/` | tooling, dependencies, CI |

Example: `fix/726-schedule-duplicate-dates`.

### 3. Commits

```text
<type>: <short imperative summary>

<body — what changed and why; wrap at 72 characters>
```

Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `ci`, `chore`.
Commit messages carry no tool-generated attribution or co-author trailers.

A pre-commit hook (husky + lint-staged) runs ESLint with `--fix` on staged
TypeScript files.

### 4. Pull request

- Fill in the template. Reference the issue with `Closes #<n>` so it closes on
  merge.
- Keep it reviewable: aim for under ~400 lines of production code; split larger
  work into sequential issues.
- Run [the local gate](#the-local-gate) first. All required CI jobs must be
  green.

### 5. Merge

Pull requests are merged on GitHub with a **merge commit** (no squash, no
rebase), and the branch is deleted. `main` is never merged into locally.

## Coding standards

The rules below are enforced by review; several are also enforced by lint.

- **TypeScript**: no `@ts-ignore`. No casts that erase a contract type
  (`as never`, `as any`) on request bodies — type them from the service
  signature so the compiler checks the payload against the API.
- **Types**: no local duplicates. Request and response shapes come from
  `@staff-scheduler/shared` (each is a `z.infer`) or the generated
  `frontend/src/api/schema.ts`.
- **Backend layering**: routes validate input with `validateBody` /
  `validateParams` / `validateQuery` and call one service method; services own
  SQL and business rules and throw typed errors from `src/errors`; the central
  error handler renders the response envelope. Never dispatch on
  `error.message`.
- **Authorization**: `authenticate`, then `requirePermission('<code>')`.
  Permission checks are always by code; there are no role checks.
- **Logging**: Winston `logger` only; no `console.*` in backend code.
- **Database**: raw SQL through `mysql2/promise`, no ORM.
- **Dates**: a `DATE` column is a calendar day. Read it with
  `DateUtils.toDateString`, never `toISOString()`; do day arithmetic on
  `YYYY-MM-DD` strings anchored to UTC (`dateToMs`, `DAY_MS`). In the frontend
  use `todayIso` / `toLocalDateString`.
- **Frontend state**: server state lives in TanStack Query hooks under
  `src/hooks/`, not in component state. Forms use React Hook Form with
  `zodResolver` over the shared schema. Async regions are wrapped in
  `QueryState`.
- **User-visible strings** go through `t()` and exist in every locale under
  `frontend/src/i18n/locales/`.
- **No fake behaviour**: no `setTimeout` standing in for a request, no success
  message that is not backed by one.
- **Comments explain why**, especially where a reasonable alternative was
  rejected. Match the comment density and naming of the surrounding code.

Step-by-step recipes for adding an endpoint, a page or a migration are in
[`DOCUMENTATION.md` §12](../DOCUMENTATION.md#12-development-guidelines).

## Testing

### Layers

| Layer | Runs against | Command | CI job |
|---|---|---|---|
| Backend unit — services | a mocked `Pool` | `cd backend && npm test` | Backend |
| Backend unit — routes | Supertest, mocked services and auth middleware | `cd backend && npm test` | Backend |
| Optimizer parity | both engines against one validator; the CP-SAT half needs OR-Tools | `cd backend && npm test` | Backend (`REQUIRE_ORTOOLS=1`) |
| OpenAPI contract | generated spec versus routes and schemas | `cd backend && npm run openapi:generate` | Backend (drift check) |
| Backend integration | a real MySQL, throwaway database | `cd backend && npm run test:integration` | e2e |
| Migrations | apply, roll back, re-apply on a clean database | `npm run db:migrate` / `db:migrate:rollback` | e2e |
| Frontend unit | jsdom, React Testing Library, mocked services or MSW | `cd frontend && npm test` | Frontend |
| End to end | Playwright, real backend, seeded MySQL and Redis | `cd frontend && npm run test:e2e` | e2e |
| Backup and restore | real dump, drop, restore | `backup-restore` workflow | weekly and on change |
| Dependency audit gate | its own unit tests | `npm run test:scripts` (root) | Backend |
| Simulation harness | a seeded MySQL; not part of CI | `cd backend && npm run sim:run` | — |

Details of the integration suite, the dead-code tools and the simulation
harness are in
[`DOCUMENTATION.md` §16](../DOCUMENTATION.md#16-testing-and-verification).

### What a test must do

A test is a statement about what the software should do, not a record of what
the code currently does. In practice:

- **Assert the outcome, not that code ran.** A test whose only assertion is a
  returned id, or a mock's call count, protects nothing. Assert the values that
  were written, returned or rendered.
- **Fixtures have the shape the real dependency produces.** `mysql2` returns a
  `DATE` column as a `Date` at local midnight: build it with
  `driverDate('2026-05-01')` from `src/__tests__/helpers/driverDate`, never
  `new Date('2026-05-01')`. A fixture in a shape the driver never produces can
  hide a defect and assert it at the same time.
- **Check the contract when the service is mocked.** A page test that mocks its
  service must assert that the submitted body satisfies the shared schema the
  route validates with:

  ```ts
  import { createUserBody } from '@staff-scheduler/shared';

  const body = createUserAccount.mock.calls[0][0];
  expect(createUserBody.safeParse(body).success).toBe(true);
  ```

- **Cover the failure paths**: invalid input, missing permission, a user
  outside the org-unit scope, the dependency failing.
- **Be deterministic.** No dependence on execution order, wall-clock time or
  the machine's timezone. Move the clock (`jest.useFakeTimers`, a `Date.now`
  spy) instead of sleeping.

### Conventions

- Backend tests live in `backend/src/__tests__/`; shared helpers in
  `__tests__/helpers/` (`mountRouter`, `permissions`, `driverDate`,
  `openapiEnvelope`).
- A test file with top-level `const`s and no `import`/`export` is a global
  script under ts-jest and collides with other suites: add `export {};`.
- Frontend tests sit next to the file they test. Anything that renders a
  component using a query hook imports `render` from
  `src/test-utils/renderWithClient`.
- Run one file with `npx jest <path>`; one test with
  `npx jest --testNamePattern="<name>"`.

### Timezones

The suites must pass in any timezone. CI runs in UTC, where a date handled on
the wrong calendar is indistinguishable from a correct one, so both jobs run
the suite again under `America/Los_Angeles` and `Pacific/Auckland`. Reproduce
locally with:

```bash
TZ=America/Los_Angeles npx jest
TZ=Pacific/Auckland npx jest
```

### Coverage

Thresholds are enforced by Jest and defined in `backend/jest.config.json` and
`frontend/jest.config.json`; those files are the source of truth.

| Workspace | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Backend | 99.3 | 91 | 99.7 | 99.7 |
| Frontend | 77 | 69 | 70 | 80 |

The backend gate is only reachable with OR-Tools installed: without it the
CP-SAT half of the parity suite skips itself and coverage drops below the
threshold although every test passes. Use the
[optimizer environment](#optimizer-environment) and run with
`REQUIRE_ORTOOLS=1` to make a missing solver an error rather than a skip.

New code comes with tests for every path it adds. A threshold is raised when
coverage rises and is never lowered to make a change pass; an exclusion from
coverage needs a stated reason.

## The local gate

Run this before opening a pull request. It is what CI runs.

```bash
# Backend (with the optimizer environment active)
cd backend
npm run lint
npm run typecheck
npm run deadcode
npm run deadcode:cycles
npm run build
npm run openapi:generate          # must leave openapi/openapi.json unchanged
REQUIRE_ORTOOLS=1 npm run test:coverage
```

```bash
# Frontend
cd frontend
npm run lint
npx tsc --noEmit
npm run deadcode
npm run api:generate              # must leave src/api/schema.ts unchanged
npm run test:coverage
npm run build
```

```bash
# Repository root
npm run audit:deps
npm run test:scripts
```

Two steps cannot be reproduced without a database and are the usual cause of a
red pull request:

- **The demo seed.** `backend/scripts/seed-demo.ts` inserts into real tables.
  Any change to a table name or a required column must update it; only the e2e
  job runs it.
- **Generated artefacts.** After changing a Zod schema or a `validate*`
  middleware, run `openapi:generate` (backend) and then `api:generate`
  (frontend), and commit both results.

## Continuous integration

[`ci.yml`](./workflows/ci.yml) runs on every pull request and on `main`.

| Job | Checks |
|---|---|
| Backend | ruff on the solver, dependency audit, ESLint, knip, madge, type-check, build, OpenAPI drift, Jest with the coverage gate and `REQUIRE_ORTOOLS=1`, timezone matrix |
| Frontend | dependency audit, ESLint, knip, `tsc --noEmit`, generated-client drift, Jest with coverage, timezone matrix, production build |
| Frontend e2e (Playwright) [required] | MySQL and Redis services, migrations applied then rolled back and re-applied, backend integration suite, demo seed, Playwright against the running stack |

[`backup-restore.yml`](./workflows/backup-restore.yml) proves weekly that a
backup restores. [`mobile-android-build.yml`](./workflows/mobile-android-build.yml)
builds the Android wrapper.

## Changing the API contract

The contract has one source: the Zod schemas in `packages/shared`.

1. Change or add the schema in `packages/shared/src/schemas.ts` (domain
   entities in `domain.ts`).
2. Use it in the route through `validateBody` / `validateParams` /
   `validateQuery`.
3. `cd backend && npm run openapi:generate`. Request bodies, query parameters
   and domain components in `openapi.json` are generated; only prose
   (summaries, descriptions, responses) is edited by hand. Every mounted
   operation needs a spec entry.
4. `cd frontend && npm run api:generate`.
5. Update [`DOCUMENTATION.md` §4](../DOCUMENTATION.md#4-api-reference) in the
   same pull request.

All routes are served under `/api/v1`.

## Changing the database schema

- Create a migration with `npm run db:migrate:new -- <name>` in `backend/`.
  Every migration has both `-- migrate:up` and `-- migrate:down`.
- Never edit a migration that has been merged.
- Give every trigger a `BEGIN ... END` body, even for one statement; otherwise
  the dump cannot be restored.
- Update `backend/scripts/seed-demo.ts` when a table or a required column
  changes.

## Documentation

Each fact has one owner. Update the owner and link to it from elsewhere.

| File | Owns |
|---|---|
| [`README.md`](../README.md) | what the project does, quick start, command reference |
| [`DOCUMENTATION.md`](../DOCUMENTATION.md) | architecture, API reference, security model, scheduling engine, operations, design decisions |
| `.github/CONTRIBUTING.md` | process, the gate, testing strategy |
| `backend/openapi/openapi.json` | the API contract (generated) |
| `backend/.env.example` | the annotated list of configuration variables |

Only `README.md` and `DOCUMENTATION.md` live in the repository root as
Markdown. Code blocks always name their language.

## Reporting bugs and proposing features

Use the [issue templates](https://github.com/lucaosti/StaffScheduler/issues/new/choose).
A useful bug report states where the defect is, what was observed, what was
expected and why the difference matters, and gives a reproduction — ideally a
failing test. For a feature, describe the use case before the solution.

## Security policy

Do not open a public issue for a vulnerability. Report it privately as
described in
[`DOCUMENTATION.md` §15](../DOCUMENTATION.md#15-security-policy).

## Project status

`README.md` and `DOCUMENTATION.md` describe what is implemented. Everything
known to be missing, wrong or untested is an open
[issue](https://github.com/lucaosti/StaffScheduler/issues), grouped by
[milestone](https://github.com/lucaosti/StaffScheduler/milestones). Before
relying on a capability for something it has not been used for, search the
issues for it; before starting work, check that nobody else has.
