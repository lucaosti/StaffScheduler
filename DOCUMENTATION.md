# Staff Scheduler — Technical Documentation

This document is the single reference for architecture, domain model, database schema, API, security/RBAC, scheduling engine, module system, development guidelines, and architectural decisions. For the quick-start and command reference, see [`README.md`](./README.md).

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Domain model](#2-domain-model)
3. [Database schema](#3-database-schema)
4. [API reference](#4-api-reference)
5. [Security and RBAC](#5-security-and-rbac)
6. [Scheduling engine](#6-scheduling-engine)
7. [Module system](#7-module-system)
8. [Delegation framework](#8-delegation-framework)
9. [Approval workflows](#9-approval-workflows)
10. [Audit trail](#10-audit-trail)
11. [Extension points](#11-extension-points)
12. [Development guidelines](#12-development-guidelines)
13. [Architectural decisions](#13-architectural-decisions)
14. [Contribution and review process](#14-contribution-and-review-process)
15. [Security policy](#15-security-policy)
16. [End-to-end tests](#16-end-to-end-tests)
17. [Future roadmap](#17-future-roadmap)

---

## 1. Architecture overview

Three-tier separation of concerns:

```
┌─────────────────────┐    HTTPS    ┌─────────────────────┐    SQL    ┌──────────────────┐
│  Frontend (React)   │ ──────────► │  Backend (Express)  │ ───────► │  MySQL 8         │
│  TypeScript SPA     │ ◄────────── │  TypeScript REST    │ ◄─────── │  pooled access   │
└─────────────────────┘    JSON     └─────────────────────┘          └──────────────────┘
```

The frontend is a React SPA. The backend is a stateless Express REST API. State lives entirely in MySQL — no in-memory session, no Redis. JWTs are stored client-side; the backend validates them on every request.

### Backend structure

```
backend/src/
├── config/           # env vars, database pool factory, Winston logger
├── middleware/        # authenticate, requirePermission, requireModule, validation helpers, requestContext
├── schemas/          # Zod schemas shared across routes
├── routes/           # 30+ router factories; each is createXRouter(pool)
├── services/         # one class per domain; receives pool in constructor
├── optimization/     # Python OR-Tools bridge
└── types/index.ts    # canonical TypeScript interfaces (single source of truth)
```

**Route → Service pattern**: routes validate input (via Zod middleware), call one service method, return JSON. Services own all SQL and business rules; they throw named errors on failure. No global singletons (the `database` singleton in `config/database.ts` is an exception used only by the auth middleware and health checks).

### Split service architecture

Two god-classes were broken up to keep service files under 500 lines:

- `AssignmentService` → `AssignmentValidator` (validation and constraint checks) + `AssignmentOrchestrator` (creation, update, cancellation orchestration). `AssignmentService` remains as a thin facade used by legacy callers.
- `ScheduleService` → `ScheduleOptimizationOrchestrator` (optimization request lifecycle, Python bridge, fallback). `ScheduleService` retains CRUD; the orchestrator handles the heavy optimization path.

### Request correlation IDs

`src/middleware/requestContext.ts` uses Node's `AsyncLocalStorage` to propagate a per-request UUID through the entire call stack without threading it through function arguments.

- Every incoming request receives a `randomUUID()` request ID.
- The ID is written to the `X-Request-Id` response header.
- `getRequestId()` can be called anywhere in the call stack (services, utilities) to retrieve the current request's ID for structured logging.

Apply the middleware early in `src/index.ts` before any route handlers.

### Frontend structure

```
frontend/src/
├── contexts/AuthContext.tsx    # JWT state (login / logout / token refresh)
├── services/
│   ├── apiUtils.ts             # ApiError, handleResponse<T>, getAuthHeaders
│   └── (per-domain clients)
├── pages/                      # route-level components
└── components/                 # reusable UI
```

All service files import `handleResponse` and `getAuthHeaders` from `./apiUtils`. The frontend proxies all `/api/*` requests to `http://localhost:3001` in development.

---

## 2. Domain model

### Core entities

| Entity | Description |
|---|---|
| `users` | Any person with a system account; schedulable staff + managers + admins |
| `departments` | Scheduling unit; owns schedules and shifts; optionally linked to an org unit |
| `org_units` | Hierarchical organizational tree (self-referencing via `parent_id`) |
| `schedules` | Period-based plan for a department (draft → published → archived) |
| `shifts` | Single time-slot within a schedule; has min/max staffing |
| `shift_assignments` | User assigned to a shift (pending / confirmed / cancelled) |
| `roles` | Configurable bundles of permissions (data, not code) |
| `permissions` | Fixed capability codes that application code checks |
| `user_roles` | Scoped, time-bound role grants to users |
| `delegations` | Temporary permission grants from one user to another |
| `approval_workflows` | Ordered multi-step approval chains per change type |
| `approval_steps` | Individual step in a workflow with approver scope and escalation timeout |
| `modules` | Runtime feature flags; `requireModule(code)` returns 404 for disabled modules |
| `audit_logs` | Immutable record of every sensitive mutation |
| `policies` | Configurable business rules (with exception requests) |

---

## 3. Database schema

Source of truth: [`backend/database/init.sql`](./backend/database/init.sql)

Bootstrap (schema only, no data): `cd backend && npm run db:init`

Demo data (idempotent): `npm run db:seed:demo`

### Key schema decisions

- **No ORM** — raw `mysql2/promise` with parameterized queries.
- **`users.role` removed** — the legacy `ENUM('admin','manager','employee')` was replaced in PR #102 by the configurable RBAC tables (`permissions`, `roles`, `role_permissions`, `user_roles`).
- **`departments.org_unit_id`** — optional FK added in PR #103 to enable org-tree scoping of schedules and shifts.
- **`audit_logs.before_snapshot` / `after_snapshot`** — JSON columns for field-level change capture.
- **Deferred FKs** — FKs that reference tables defined later in the file are added via `ALTER TABLE` at the end of `init.sql`.

---

## 4. API reference

### Response envelope

Every endpoint returns:

```json
{ "success": true,  "data": <T>, "message": "..." }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable" } }
```

The `code` field is always present in error responses. `message` is safe for display in production.

### Authoritative contract

The single source of truth is [`backend/openapi/openapi.json`](./backend/openapi/openapi.json), served live at `http://localhost:3001/api/docs` (Swagger UI). When this file conflicts with the spec, the spec wins.

### Base URL

`http://localhost:3001/api` (development)

### Authentication

```
POST /api/auth/login       { email, password } → { token, user: { id, email, firstName, lastName, roles, permissions } }
GET  /api/auth/verify      (Bearer token) → { user }
POST /api/auth/refresh     (Bearer token) → { token, user }
POST /api/auth/logout
```

JWT payload: `{ userId, email }` — no role. Permissions are resolved from the DB on every request.

### Core endpoints (summary)

| Prefix | Description | Permission guard |
|---|---|---|
| `/api/users` | User CRUD, role assignment | `user.manage` / `user.read` |
| `/api/employees` | Staff roster (scoped by org unit) | authenticated |
| `/api/departments` | Department CRUD | `department.manage` |
| `/api/schedules` | Schedule lifecycle (create → publish → archive) | `schedule.manage` |
| `/api/shifts` | Shift CRUD, templates | `shift.manage` |
| `/api/assignments` | Shift assignment CRUD | `assignment.manage` |
| `/api/roles` | Role CRUD + permission assignment | `role.manage` |
| `/api/permissions` | Permission catalog (read-only) | `role.manage` |
| `/api/delegations` | Temp authority delegation | authenticated |
| `/api/approval-workflows` | Multi-step workflow configuration | `approval.manage` |
| `/api/modules` | Module enable / disable | `settings.manage` |
| `/api/time-off` | Time-off requests | authenticated / `timeoff.approve` |
| `/api/shift-swap` | Shift swap requests | authenticated / `shiftswap.approve` |
| `/api/on-call` | On-call roster | `oncall.manage` |
| `/api/org` | Org units, memberships, loans | `org_unit.manage` |
| `/api/policies` | Business policies and exceptions | `policy.manage` |
| `/api/reports` | Reports and analytics (module: `reporting`) | `report.read` |
| `/api/audit-logs` | Audit trail viewer (module: `audit`) | `audit.read` |
| `/api/notifications` | In-app notifications (module: `notifications`) | authenticated |
| `/api/import` | Bulk CSV import | `employee.manage` |
| `/api/calendar` | Calendar view | authenticated |
| `/api/events` | Server-sent events stream | authenticated |
| `/api/directory` | User directory + vCard export/import | `user.read` |
| `/api/dashboard` | Dashboard statistics | authenticated |
| `/api/settings` | System settings | `settings.manage` |
| `/api/health` | Health check (unauthenticated) | — |

### Error codes (common)

| Code | HTTP | Meaning |
|---|---|---|
| `MISSING_TOKEN` | 401 | No `Authorization` header |
| `INVALID_TOKEN` | 401 | JWT invalid or expired |
| `FORBIDDEN` | 403 | Permission not held |
| `NOT_FOUND` | 404 | Resource missing or module disabled |
| `CONFLICT` | 409 | Duplicate resource |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `TOO_MANY_REQUESTS` | 429 | Login rate limit exceeded |

---

## 5. Security and RBAC

### Model

The authorization model is **permission-based**. Application code checks permission **codes** (e.g. `schedule.manage`); roles are editable data bundles, not hard-wired concepts. There are no hardcoded role names in the application code.

```
permissions  — fixed catalog of capability codes (28 codes, cannot be added at runtime)
roles        — configurable named bundles (Administrator, Manager, Employee + any custom)
role_permissions — M:N, which permissions a role grants
user_roles   — user ↔ role grant, optionally scoped to an org-unit subtree, optionally time-bound
```

`RbacService` owns all queries against these tables and is the only place where permission resolution logic lives.

### Using requirePermission in routes

```typescript
import { authenticate, requirePermission } from '../middleware/auth';

router.post('/', authenticate, requirePermission('schedule.manage'), handler);
```

The `requirePermission(code)` call must always come after `authenticate`. It returns 403 if the user's effective permissions (resolved at authentication time) do not include the code.

For finer-grained checks inside a handler (when the required permission depends on request data), use the exported helper:

```typescript
import { userHasPermission } from '../middleware/auth';

if (!userHasPermission(req.user, 'schedule.publish')) { ... }
```

### Permission resolution

`authenticate` middleware, on every request:
1. Verifies JWT → `userId`
2. Loads user from DB
3. Calls `RbacService.getEffectivePermissions(userId)` — union of all non-expired role grants + active delegations
4. Calls `RbacService.getUserRoles(userId)` — role assignments with scope
5. Calls `RbacService.computeAllowedOrgUnitIds(roles)` — `null` (full access) or subtree IDs
6. Attaches `user.permissions`, `user.roles`, `user.allowedOrgUnitIds` to `req.user`

### Org-unit scoping

A role granted with `user_roles.scope_org_unit_id = X` limits the user to data within org unit X and its descendants. Affected list endpoints: `GET /employees`, `GET /schedules`, `GET /shifts`. `GET /schedules/:id` returns 403 for out-of-scope resources.

`RbacService.getDescendantOrgUnitIds(rootId)` uses a single `WITH RECURSIVE` CTE. No N+1 queries.

### Permission codes

| Code | Capability |
|---|---|
| `employee.read` / `employee.manage` | View / manage staff |
| `schedule.read` / `schedule.manage` | View / manage schedules |
| `schedule.publish` | Publish a schedule |
| `schedule.optimize` | Run the optimizer |
| `assignment.manage` | Manage shift assignments |
| `shift.manage` | Manage shift templates and shifts |
| `department.read` / `department.manage` | View / manage departments |
| `org_unit.read` / `org_unit.manage` | View / manage org tree |
| `oncall.manage` | Manage on-call |
| `policy.read` / `policy.manage` / `policy.approve` | Policies |
| `approval.manage` | Configure approval matrix/workflows |
| `loan.request` / `loan.approve` | Employee loans |
| `timeoff.approve` | Approve time-off |
| `shiftswap.approve` | Approve shift swaps |
| `preferences.manage` | Manage preferences |
| `report.read` | Reports |
| `audit.read` | Audit logs |
| `user.read` / `user.manage` | User accounts |
| `settings.manage` | System settings + module toggles |
| `role.manage` | Role and permission management |

### Anti-escalation

Users cannot assign roles that contain permissions they do not themselves hold (unless they hold `role.manage`). Self-role-change is blocked.

---

## 6. Scheduling engine

The optimizer is optional. Set `OPTIMIZATION_ENGINE=or-tools` in `backend/.env` to enable.

```bash
cd backend
pip3 install -r optimization-scripts/requirements.txt
python3 optimization-scripts/schedule_optimizer.py --help
```

### CP-SAT formulation

- **Variables** — one boolean per `(employee, shift)` candidate assignment.
- **Hard constraints** — coverage windows, no double-booking, declared availability, weekly hour caps, skill requirements.
- **Soft constraints** — preferences, workload fairness, minimum rest, consecutive-day caps. Each has a configurable weight.
- **Objective** — weighted sum to minimize.

The Node bridge is `backend/src/optimization/ScheduleOptimizerORTools.ts`. It serializes input as JSON, spawns `schedule_optimizer.py` as a child process, and parses the JSON response. A pure-TypeScript fallback (`ScheduleOptimizer.ts`) is used when OR-Tools is not available.

---

## 7. Module system

Runtime feature flags persisted in the `modules` table. All 9 default modules are enabled on a fresh install.

| Module code | What it guards |
|---|---|
| `scheduling` | Shift scheduling, optimizer, calendar |
| `approvals` | Approval workflows |
| `notifications` | In-app notifications, SSE stream |
| `reporting` | Reports and analytics |
| `analytics` | Advanced workforce analytics |
| `forecasting` | Demand forecasting |
| `integrations` | Third-party integrations |
| `audit` | Audit log viewer |
| `compliance` | Policies and exception tracking |

`requireModule(code)` middleware returns **404** (not 401) for disabled modules so consumers cannot infer the route's existence. It runs before `authenticate`.

Admin API: `GET /api/modules`, `PUT /api/modules/:code` (requires `settings.manage`).

---

## 8. Delegation framework

User A can grant User B a time-bounded subset of their own permissions.

```
POST   /api/delegations           { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId? }
GET    /api/delegations           list own delegations (as delegator or delegatee)
DELETE /api/delegations/:id       revoke (delegator only)
```

Rules:
- `permissionCodes` must be a subset of the delegator's current permissions.
- Self-delegation is rejected.
- Expired delegations are excluded automatically from `getEffectivePermissions`.
- Every grant/revoke writes an `audit_logs` entry.

---

## 9. Approval workflows

Multi-step approval chains per change type. Each `approval_workflows` row holds an ordered list of `approval_steps`.

```
GET    /api/approval-workflows            list all (approval.manage)
POST   /api/approval-workflows            create
GET    /api/approval-workflows/:type      get by change type
PUT    /api/approval-workflows/:id        update
DELETE /api/approval-workflows/:id        delete
POST   /api/approval-workflows/escalate  trigger escalation check (cron-callable)
```

`ApprovalEngineService.resolveApprover(changeType, ctx)` walks steps in order and returns the first non-auto-approved step. `processEscalations(nowIso?)` identifies steps whose `escalate_after_hours` deadline has passed.

Default change types: `Loan.Request`, `Loan.Cancel`, `Policy.Create`, `Policy.Update`, `Policy.Exception`, `Schedule.Publish`, `Schedule.Override`, `OrgUnit.Update`, `Membership.Update`, `TimeOff.Request`, `ShiftSwap.Request`.

---

## 10. Audit trail

Every sensitive mutation writes an `audit_logs` row via `AuditLogService.write(input)`.

Audited actions: `user.create`, `user.update`, `user.delete`, `role.grant`, `role.revoke`, `schedule.publish`, `schedule.archive`, `policy.create`, `policy.update`, `policy.delete`, `org_unit.create`, `org_unit.update`, `org_unit.delete`, `delegation.grant`, `delegation.revoke`.

`before_snapshot` and `after_snapshot` (JSON) are captured for role grants and policy changes.

`GET /api/audit-logs` supports filtering by `userId`, `action`, `entityType`, `entityId`, `fromDate`, `toDate`, `limit`, `offset`. No `DELETE` endpoint exists.

---

## 11. Extension points

### Adding a new route

1. Create `backend/src/routes/myFeature.ts` with `export const createMyFeatureRouter = (pool: Pool): Router => { ... }`.
2. Register in `backend/src/app.ts`: `app.use('/api/my-feature', createMyFeatureRouter(pool))`.
3. Add `requireModule('my-module')` and `requirePermission('my.perm')` guards as needed.

### Adding a new permission

1. Add an `INSERT IGNORE INTO permissions` row in `backend/database/init.sql`.
2. Assign it to the appropriate role(s) via `role_permissions` seed rows.
3. Reference the code string in your route / middleware.

### Adding a new module

1. Add an `INSERT IGNORE INTO modules` row in `init.sql`.
2. Apply `requireModule('my-module')` to the relevant router.

---

## 12. Development guidelines

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

Docker alternative:

```bash
./start-dev.sh           # spins up MySQL + backend + frontend in dev mode
./stop.sh                # tear down
```

### Branch naming

| Prefix | Use for |
|--------|---------|
| `feat/` | new feature |
| `fix/` | bug fix |
| `refactor/` | internal cleanup without behavior change |
| `docs/` | documentation only |
| `chore/` | dependency bumps, tooling |

### Language and code style

- Code, comments, commit messages, and all documentation: **English**.
- Chat / issue discussion: match the conversation language.
- No `@ts-ignore`. No `console.log/error` in backend code — use Winston (`logger`).
- No local type duplicates — import from `backend/src/types/index.ts` or `frontend/src/types/index.ts`.
- No fake async (`setTimeout` simulating an API call).
- No backward-compatibility hacks for removed code.
- Comments only when the **why** is non-obvious.
- No service file should exceed 500 lines; extract sub-classes if needed.

### Testing

Each domain has tests at the layer where it lives:

- **Service unit tests** — mocked pool, pure business logic.
- **Route smoke tests** — Supertest + mocked services + mocked auth middleware.
- **Integration tests** — real DB against `test_staff_scheduler`.

CI commands (must all pass):

```bash
# Backend
cd backend && npm run lint && npm run build && npm test

# Frontend
cd frontend && npm run lint && CI=true npm test -- --watchAll=false && npm run build
```

Coverage gates are enforced in CI.

Run a single suite:
```bash
npx jest src/__tests__/schedule.service.test.ts
```

### Adding a test

Route tests mock `../middleware/auth` with `authenticate`, `requirePermission`, and `requireModule` all set to pass-through. Service tests inject a `jest.fn()` pool. Do not mock the database at the driver level — mock `pool.execute`/`pool.getConnection` on the Pool object.

### Adding a new API endpoint

1. Add the Zod schema to `backend/src/schemas/index.ts`.
2. Add the business logic to an existing service or create a new one in `backend/src/services/`.
3. Add the route handler to the appropriate file in `backend/src/routes/`, or create a new one and mount it in `backend/src/index.ts`.
4. Update `backend/openapi/openapi.json` with the new path.
5. Write tests in `backend/src/__tests__/`.
6. Update the relevant section of `DOCUMENTATION.md` in the same PR.

### Adding a new frontend page

1. Create the page component in `frontend/src/pages/`.
2. Add the API client wrapper in `frontend/src/services/` (use `handleResponse` + `getAuthHeaders` from `apiUtils`).
3. Add the route in `frontend/src/App.tsx`.
4. Add types to `frontend/src/types/index.ts` (do not duplicate from backend — keep them in sync manually).

### Database schema changes

All schema changes go in `backend/database/init.sql`. This file is the single source of truth for the schema — it is run from scratch on CI.

Guidelines:
- Use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` patterns where possible.
- Add foreign key constraints and indexes for every join column.
- If a migration changes existing data, add a note at the top of the PR describing the manual migration step needed for existing deployments.

### Issue reporting

Open a [GitHub issue](https://github.com/lucaosti/StaffScheduler/issues) with:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Backend/frontend version or commit hash
- Relevant logs (redact credentials)

Feature requests are welcome — describe the use case, not just the solution.

---

## 13. Architectural decisions

| Decision | Rationale |
|---|---|
| Permission-based RBAC (no hardcoded roles) | Roles are customer data. Hard-wiring `admin`/`manager`/`employee` prevents multi-tier hierarchies. `user_roles` grants are scoped and time-bound, supporting org-unit subtree access and temporary elevation. |
| JWT carries `userId` only | Permissions change frequently; a stale role in the token would require revocation infrastructure. Resolving from DB on every request is cheaper than maintaining a token revocation store. |
| Hard cutover (no backward-compat shim) | The 3-role ENUM was the root of every hardcoded check. A migration shim would perpetuate the pattern. The seeded bootstrap roles (Administrator/Manager/Employee) reproduce prior behaviour without any shim. |
| `requireModule` returns 404 | A 401 leaks that the route exists. 404 is the correct response when an entire feature is absent; no information is disclosed. |
| In-process module cache | Module state changes infrequently. A per-request DB lookup for a static flag is wasteful. Cache invalidation on `setEnabled` is a single line. |
| `AuditLogService.write` swallows errors | An audit write failure must never block a business operation. The audit log is observability, not a transaction requirement. |
| `WITH RECURSIVE` CTE for org-unit subtrees | Fetches the entire subtree in one query. No N+1. Depth is bounded by the org tree (typically < 10 levels). |
| `approval_matrix` preserved alongside `approval_workflows` | Removing it would break existing service tests and the `policies` route that still calls `ApprovalMatrixService`. A future PR can migrate these callers and drop the legacy table. |

---

## 14. Contribution and review process

### Branching

- `main` — protected; merges only via PR.
- Feature branches: `feat/<kebab-issue-title>` (e.g. `feat/configurable-rbac`).
- Each PR closes exactly one issue; link via `Closes #N` in the PR body.

### PR checklist

- [ ] `npm run lint` clean
- [ ] `npm run build` clean (no TypeScript errors)
- [ ] `npm test` all passing
- [ ] New behaviour covered by tests
- [ ] No `console.log/error` in backend code
- [ ] No `@ts-ignore`
- [ ] No AI attribution in commit messages or code

### Commit message format

```
<type>(<scope>): <short imperative summary>

<body — optional, wrap at 72 chars>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`.

### Code review

- Self-review the diff before requesting a review.
- PRs should stay under ~400 lines of production code change; split larger work into sequential issues.
- Reviewer focus: correctness, security, test coverage, naming.

### Security vulnerabilities

Do **not** open a public GitHub issue. Email the maintainer privately at `lucaostinelli@protonmail.com` with: description, reproduction steps, affected commit SHA, impact assessment. Expect acknowledgement within 5 business days and a status update within 15 business days.

---

## 15. Security policy

**Supported versions**: the project is pre-1.0. Fixes ship on `main`; track the latest commit.

**Scope (in)**: HTTP API, frontend SPA, OR-Tools optimizer bridge.

**Scope (out)**: vulnerabilities requiring existing admin credentials; third-party services (MySQL, Docker, browser).

---

## 16. End-to-end tests

Playwright smoke tests in `frontend/e2e/`. They exercise the real UI against a running demo stack.

```bash
# Prerequisites: backend + seeded MySQL running
cd frontend
npx playwright install --with-deps chromium   # one-time
npm run test:e2e
```

Environment variables: `E2E_BASE_URL` (default `http://localhost:3000`), `REACT_APP_API_URL` (default `http://localhost:3001`).

Demo credentials: `admin@demo.staffscheduler.local / demo1234`.

CI job: `Frontend e2e (Playwright)` in `.github/workflows/ci.yml`. Boots a `mysql:8.0` service, seeds demo data, starts the backend and frontend, runs Playwright, uploads HTML report and traces on failure.

| Spec | Flow |
|---|---|
| `auth.spec.ts` | Admin and manager sign in and reach the dashboard |
| `schedule.spec.ts` | Admin creates a schedule via the UI |
| `theme.spec.ts` | Theme toggle cycles between light and dark |

---

## 17. Future roadmap

The following capabilities are planned but not yet implemented. Pull requests for any of these are welcome — open an issue first to coordinate.

| Capability | Notes |
|---|---|
| Mobile app | Native or PWA for employees to view shifts and request swaps on mobile |
| Real-time shift swap marketplace | Employees can post and claim swaps without manager intervention |
| Geofencing | Clock-in/out gated by physical location |
| Predictive demand forecasting | Historical data model to auto-suggest minimum staffing targets |
| Compliance reporting | Jurisdiction-specific labor rule checks (rest periods, overtime, etc.) |
| Payroll integration | Export to payroll providers (Gusto, ADP, Workday) |
| Multi-language / RTL support | i18n for the frontend SPA |
| SSO / SAML / OAuth2 | Enterprise identity provider federation |
| Bulk API | Batch endpoints for high-volume integrations |
| Kiosk / QR clocking | Tablet kiosk mode and QR-code-based clock-in |
