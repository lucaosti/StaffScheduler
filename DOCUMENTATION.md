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
10a. [Observability and operations](#10a-observability-and-operations)
11. [Extension points](#11-extension-points)
12. [Development guidelines](#12-development-guidelines)
13. [Architectural decisions](#13-architectural-decisions)
14. [Contribution and review process](#14-contribution-and-review-process)
15. [Security policy](#15-security-policy)
16. [End-to-end tests](#16-end-to-end-tests)

---

## 1. Architecture overview

Three-tier separation of concerns:

```
┌─────────────────────┐    HTTPS    ┌─────────────────────┐    SQL    ┌──────────────────┐
│  Frontend (React)   │ ──────────► │  Backend (Express)  │ ───────► │  MySQL 8         │
│  TypeScript SPA     │ ◄────────── │  TypeScript REST    │ ◄─────── │  pooled access   │
└─────────────────────┘    JSON     └─────────────────────┘          └──────────────────┘
```

The frontend is a React SPA. The backend is an Express REST API. Durable state lives in MySQL; JWTs are stored client-side and validated on every request. Ephemeral shared state — the token-revocation blacklist, the auth-context cache and the module cache — uses **Redis when reachable** (on by default, `backend/src/config/redis.ts`), so several backend instances stay consistent and revocation survives a restart; without Redis those caches fall back transparently to process-local state, keeping single-instance and local runs zero-configuration. The API layer itself remains stateless, so it scales horizontally behind a load balancer once Redis holds the shared caches.

### Backend structure

```
backend/src/
├── config/           # env vars, database pool factory, Redis client, Winston logger
├── errors/           # AppError hierarchy (NotFound/Conflict/Forbidden/Validation/Unauthorized)
├── middleware/       # authenticate, requirePermission, requireModule, validation, asyncHandler,
│                     #   errorHandler, requestContext
├── observability/    # Prometheus metrics + OpenTelemetry tracing bootstrap
├── schemas/          # re-exports the canonical Zod schemas from @staff-scheduler/shared
├── routes/           # 30+ router factories; each is createXRouter(pool)
├── services/         # one class per domain; receives pool in constructor
├── optimization/     # Python OR-Tools bridge + the canonical constraint validator
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

The middleware is applied early in `src/app.ts`, before any route handlers — and,
when tracing is enabled, the same id is stamped onto the active OpenTelemetry span
as `request.id`, so logs, the response header and traces all correlate.

### Frontend structure

```
frontend/src/
├── contexts/AuthContext.tsx    # JWT state (login / logout / token refresh)
├── api/                        # generated OpenAPI types + typed fetch client
├── lib/queryClient.ts          # shared TanStack Query client (one cache)
├── hooks/                      # server-state hooks: queries + mutations per domain
├── services/
│   ├── apiUtils.ts             # ApiError, handleResponse<T>, getAuthHeaders
│   └── (per-domain clients)
├── pages/                      # route-level components
├── components/                 # reusable UI (incl. QueryState / ErrorAlert)
└── test-utils/                 # render helper providing an isolated QueryClient
```

**Server state lives in TanStack Query hooks, not in components.** Pages read data
through a hook in `hooks/` and mutate through that hook's mutations, which invalidate
the relevant query key — so a component never hand-rolls loading/error flags or manual
refetch-after-mutation. Service modules still expose the HTTP calls; they use the
generated typed client (`api/client`) where the endpoint is in the OpenAPI spec, and
otherwise `handleResponse` + `getAuthHeaders` from `./apiUtils`. The frontend proxies
all `/api/*` requests to `http://localhost:3001` in development.

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
| `responsibility_rules` | Multi-dimensional matrix: (subject group × permission code) → responsible org unit |
| `change_requests` | Subordinate-proposed changes; approved and applied by the authority holder |
| `modules` | Runtime feature flags; `requireModule(code)` returns 404 for disabled modules |
| `audit_logs` | Immutable record of every sensitive mutation |
| `policies` | Configurable business rules (with exception requests) |

---

## 3. Database schema

Source of truth: [`backend/db/migrations/`](./backend/db/migrations) — dbmate SQL migrations, applied in filename order and tracked in the `schema_migrations` table.

Apply pending migrations (schema only, no data): `cd backend && npm run db:migrate` (alias: `db:init`)

Create a new migration: `npm run db:migrate:new -- <snake_case_name>`; check state with `npm run db:migrate:status`; undo the latest with `npm run db:migrate:rollback`. Every migration must define both `-- migrate:up` and `-- migrate:down` sections (CI verifies the down path with a rollback + reapply pass). Under Docker Compose, a one-shot `migrate` service applies pending migrations before the backend starts.

#### Adopting migrations on a pre-existing database

Databases created before the migration system existed already contain the full baseline schema, so the baseline migration must be recorded as applied — **not** executed — exactly once, before the first `dbmate up`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(128) PRIMARY KEY);
INSERT IGNORE INTO schema_migrations (version) VALUES ('20260719000000');
```

After this one-time step, `npm run db:migrate` (or the compose `migrate` service) applies only newer migrations. Fresh databases need nothing special: the baseline simply runs as the first migration.

Demo data (idempotent): `npm run db:seed:demo`

### Key schema decisions

- **No ORM** — raw `mysql2/promise` with parameterized queries.
- **`users.role` removed** — the legacy `ENUM('admin','manager','employee')` was replaced in PR #102 by the configurable RBAC tables (`permissions`, `roles`, `role_permissions`, `user_roles`).
- **`departments.org_unit_id`** — optional FK added in PR #103 to enable org-tree scoping of schedules and shifts.
- **`audit_logs.before_snapshot` / `after_snapshot`** — JSON columns for field-level change capture.
- **Deferred FKs** — FKs that reference tables defined later in the baseline are added via `ALTER TABLE` at the end of the initial migration.

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
POST /api/auth/login       { email, password, totpCode? } → sets httpOnly cookie "token"; body: { user: { id, email, firstName, lastName, roles, permissions } }
GET  /api/auth/verify      (cookie) → { user }
POST /api/auth/refresh     (cookie) → rotates cookie; body: { user }
POST /api/auth/logout      blacklists the JTI and clears the cookie
```

JWT payload: `{ userId, email, jti }` — no role. Permissions are resolved from the DB on every request. The `jti` field enables server-side revocation on logout via an in-memory blacklist with TTL-based expiry. The cookie lifetime tracks `JWT_EXPIRES_IN` so cookie and token always expire together.

**Two-factor authentication**: when an account has TOTP enabled (`POST /api/auth/2fa/setup` + `/enable`), login additionally requires `totpCode` — a current TOTP code or an unused recovery code. A password-valid login without the code answers 401 `TOTP_REQUIRED`; a wrong code answers 401 `TOTP_INVALID`. Disabling 2FA (`POST /api/auth/2fa/disable`) likewise requires a valid code. Accepted TOTP codes are single-use: the matched time-step counter is stored in `users.totp_last_counter` with a compare-and-set update, so an intercepted code cannot be replayed within its validity window; recovery-code consumption uses the same compare-and-set pattern.

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
| `/api/skill-gap` | Skill gap analysis (`?departmentId=&start=&end=`, dates YYYY-MM-DD) | `report.read` |
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
| `MISSING_TOKEN` | 401 | No `token` cookie and no `Authorization` header |
| `INVALID_TOKEN` | 401 | JWT invalid or expired |
| `TOTP_REQUIRED` | 401 | Account has 2FA enabled; login needs `totpCode` |
| `TOTP_INVALID` | 401 | Wrong TOTP or recovery code |
| `FORBIDDEN` | 403 | Permission not held |
| `NOT_FOUND` | 404 | Resource missing or module disabled |
| `CONFLICT` | 409 | Duplicate resource |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `TOO_MANY_REQUESTS` | 429 | Login rate limit exceeded |

---

## 5. Security and RBAC

### Sessions and tokens

Authentication uses a short-lived access token plus a rotating refresh token,
both in httpOnly `SameSite=Strict` cookies (never exposed to JavaScript):

- **Access token** (`token` cookie): a JWT carrying only the user id and a JTI,
  default 15-minute lifetime (`JWT_EXPIRES_IN`). Verified on every request;
  permissions are resolved fresh from the database, so a short access token is
  not a staleness problem. Revoked on logout via the shared JTI blacklist.
- **Refresh token** (`refresh_token` cookie, scoped to `/api/auth/refresh`): an
  opaque 256-bit token whose **hash** is stored in `refresh_tokens`, default
  30-day lifetime (`JWT_REFRESH_EXPIRES_IN`). `POST /api/auth/refresh` rotates
  it — revoking the presented token and issuing a successor in the same family —
  and mints a new access token. It is deliberately **not** behind the auth
  middleware, so it works exactly when the access token has expired.
- **Reuse detection**: replaying an already-rotated refresh token revokes the
  entire token family (`RefreshTokenService`), bounding a stolen token to one
  rotation window. Logout revokes both the access JTI and the refresh token.

The SPA refreshes proactively before expiry and falls back to a refresh on page
load, so an active session is never interrupted. See `RefreshTokenService` and
`backend/db/migrations/*_add_refresh_tokens.sql` for the schema rationale.

### Model

The authorization model is **permission-based**. Application code checks permission **codes** (e.g. `schedule.manage`); roles are editable data bundles, not hard-wired concepts. There are no hardcoded role names in the application code.

```
permissions  — fixed catalog of capability codes (cannot be added at runtime)
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

By default this resolution runs on **every request**, so grants and revocations apply immediately. Deployments that accept a bounded staleness window can set `AUTH_PERMISSION_CACHE_TTL_MS` (default `0` = off) to cache the resolved auth context per user for that many milliseconds; role-grant endpoints call `invalidateAuthContext(userId)` so changes made through the API still apply immediately on the serving instance.

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
| `delegation.manage` | Create and revoke delegations of one's own permissions |
| `loan.request` / `loan.approve` | Employee loans |
| `timeoff.approve` | Approve time-off |
| `shiftswap.approve` | Approve shift swaps |
| `preferences.manage` | Manage preferences |
| `report.read` | Reports (also gates the dashboard's monthly labor cost) |
| `audit.read` | Audit logs (including the dashboard recent-activity feed) |
| `user.read` / `user.manage` | User accounts |
| `user.read_all` | List the complete, unscoped user directory (Administrator only by default; managers without it get a department-scoped list) |
| `settings.manage` | System settings + module toggles |
| `role.manage` | Role and permission management |
| `responsibility.read` / `responsibility.manage` | View / manage responsibility matrix |
| `change_request.create` | Submit a change request |
| `change_request.review` | Approve, reject, apply, and list change requests |

### Anti-escalation

Users cannot assign roles that contain permissions they do not themselves hold (unless they hold `role.manage`). Self-role-change is blocked.

---

## 6. Scheduling engine

Two engines produce schedules: a Python OR-Tools CP-SAT solver (optimal) and a
TypeScript greedy solver (fast, best-effort). The optimum is attempted by
default; when Python is unavailable the greedy solver runs automatically, but
that fallback is **always signalled, never silent** (see below).

### Engine selection

| `OPTIMIZATION_ENGINE` env value | Effect |
|---|---|
| `or-tools` (default) | Optimal CP-SAT Python solver; a **signalled** greedy fallback on any failure (`engine: "greedy"`, `degraded: true`, reason) |
| `greedy` (alias `javascript`) | Greedy draft solver on purpose (`engine: "greedy"`, `degraded: false`) |

Every generation result — the synchronous `200` body and the job `result` —
reports `engine` (`"or-tools"` or `"greedy"`) and `degraded`. `degraded: true`
means the optimum was requested but the run fell back to greedy, so the output
is a draft; the UI surfaces this prominently and a warning is logged. This makes
it unambiguous whenever a schedule is a draft rather than the optimum.

Install the Python solver:

```bash
cd backend
pip3 install -r optimization-scripts/requirements.txt
python3 optimization-scripts/schedule_optimizer.py --help
# 'or-tools' is already the default; set OPTIMIZATION_ENGINE=greedy to force draft mode
```

### Constraint parity between the engines

The hard scheduling constraints (staff cap, no double-booking, minimum rest,
declared unavailability, required skills, daily-hours cap, rolling weekly-hours
cap, and maximum consecutive days — all accounting for shifts held on other
schedules) are defined **once**, declaratively, in
`backend/src/optimization/constraintValidator.ts`. That validator is the single
source of truth for what a legal schedule is. The parity suite
(`backend/src/__tests__/optimizer.parity.test.ts`) runs **both** engines against
the same fixtures and asserts each output satisfies that one definition, so any
divergence between the two engines becomes a failing test instead of a silent
production difference. In CI the CP-SAT half is mandatory (`REQUIRE_ORTOOLS=1`);
locally it self-skips when OR-Tools is not installed. Coverage is deliberately
not treated as a hard violation (the greedy is best-effort and may leave a shift
short where CP-SAT would prove infeasibility); it is reported separately.

### Running optimization as a background job

Optimization can run for minutes, so it executes as a **background job** when
Redis is available (`backend/src/services/OptimizationQueue.ts`, BullMQ):

- `POST /api/schedules/:id/generate` enqueues the solve and returns
  `202 { jobId }` immediately instead of holding the request open.
- `GET /api/schedules/:id/optimization` reports the job `state`, `progress`
  and `result`.
- `DELETE /api/schedules/:id/optimization` cancels an in-flight job.
- Progress is also pushed over the SSE stream as `optimization.progress`,
  `optimization.completed` and `optimization.failed` events.

The job id is deterministic per schedule (`schedule:{id}`), so a second
generate while one is in flight returns the same job rather than starting a
competing solve, and the worker runs one solve at a time. Without Redis the
endpoint falls back to running the optimizer synchronously and returns `200`
with the result.

### Greedy TypeScript solver (`ScheduleOptimizer.generateGreedySchedule`)

Entry point: `backend/src/optimization/ScheduleOptimizerORTools.ts`  
Called by: `AutoScheduleService.generate` → `ScheduleOptimizationOrchestrator.generateOptimizedSchedule`

**Algorithm**: O(shifts × employees). Shifts are sorted earliest-first; for each shift the first employees that pass all constraints are selected up to `min_staff`.

**Constraints enforced (in evaluation order inside `evaluateCandidate`)**:

| # | Constraint | Source of truth |
|---|---|---|
| 1 | Staff cap | `shift.max_staff` — never exceeded |
| 2 | No double-booking | Absolute-time overlap (overnight-aware, across day boundaries) |
| 2b | Minimum rest between shifts | `min_hours_between_shifts` (default 8h), across day boundaries |
| 3 | Declared unavailability | `user_unavailability` rows, expanded to per-day dates |
| 4 | Skill requirements | `shift_skills` join; employee must hold every required skill |
| 5 | Daily hours cap | `max(8, emp.max_hours_per_week / 5)` hours per employee per day |
| 6 | Weekly hours cap | Rolling 7-day window ≤ `emp.max_hours_per_week` |
| 7 | Max consecutive days | Longest run of worked days ≤ `emp.max_consecutive_days` |

Constraints 2, 2b, 5, 6 and 7 also account for shifts the employee already holds
on **other** schedules (`existing_assignments`), so back-to-back schedule periods
cannot jointly bust a limit each satisfies alone. This exact set is the canonical
definition in `constraintValidator.ts`, and the Python CP-SAT engine enforces the
same set as hard constraints — the parity suite keeps the two aligned.

**How to add a new constraint**:

1. Add the rule to `constraintValidator.ts` first — it is the single source of truth.
2. Add any needed state tracking in `generateGreedySchedule` (e.g. a new `Map`) and the check to `evaluateCandidate(emp, ctx)` — the method is pure; no DB calls allowed there.
3. Add the matching hard constraint to `schedule_optimizer.py`.
4. Extend the fixtures/assertions in `backend/src/__tests__/optimizer.parity.test.ts` so both engines are verified against the new rule.

**Known limitations**:
- No backtracking: a locally greedy choice can block a later shift from being staffed. The CP-SAT path solves this globally, which is why `or-tools` is the default and greedy is a signalled draft/fallback.
- Employee ordering within the candidate list is deterministic (input order) but not optimized for fairness — workload balancing is a soft objective in CP-SAT only.

### Python CP-SAT solver (`schedule_optimizer.py`)

Entry point: `backend/optimization-scripts/schedule_optimizer.py`  
Bridge: `ScheduleOptimizer.optimize()` serializes the problem as JSON, spawns `python3` via `child_process.spawn`, and parses the JSON response from stdout.

**Failure handling**:

| Failure mode | Behaviour |
|---|---|
| `python3` not found (ENOENT) | `spawn` emits `error` → `optimize()` logs a warning and falls back to greedy |
| Non-zero exit code | Rejected promise → `optimize()` logs a warning and falls back to greedy |
| Timeout (`OPTIMIZATION_TIMEOUT` ms, default 300 000 ms) | SIGTERM → SIGKILL after 5 s → `optimize()` falls back to greedy |
| Malformed JSON output | Parse error → `optimize()` falls back to greedy |

The `optimize()` return status is `GREEDY_FALLBACK` when the Python solver was
unavailable; `AutoScheduleService` turns that into a surfaced `engine: "greedy"`,
`degraded: true` result rather than a silent substitution.

**CP-SAT formulation**:

- **Variables** — one boolean per `(employee, shift)` candidate assignment.
- **Hard constraints** — the full canonical set (see `constraintValidator.ts`): coverage windows, no double-booking (absolute time), minimum rest, declared availability, required skills, daily-hours cap, rolling 7-day weekly-hours cap, and maximum consecutive days — each also charging the employee's `existing_assignments` on other schedules. These match the greedy engine exactly (enforced by the parity suite); minimum rest and consecutive-days used to be soft objective penalties and are now hard.
- **Objective** — a weighted sum to **maximize**: coverage (fill every seat) first, then employee preferences.
- **stdout contract** — a single pure-JSON document; CP-SAT search logging is disabled (`log_search_progress = False`) so diagnostics never interleave with the result. Diagnostic prints go to stderr.

**Performance characteristics**: CP-SAT is branch-and-bound with propagation. Small problems (< 50 shifts, < 30 employees) typically solve in under 1 s. Large problems run until `timeLimitSeconds` (default 300 s for the Python call) then return the best feasible solution found.

---

## 7. Module system

Runtime feature flags persisted in the `modules` table. All 11 default modules are enabled on a fresh install.

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
| `attendance` | Clock-in/clock-out punches and approval — see [7a](#7a-attendance-tracking) |
| `payroll` | Planned-vs-actual labor cost estimation, gates `GET /api/attendance/cost-estimate` on top of `attendance` |

`requireModule(code)` middleware returns **404** (not 401) for disabled modules so consumers cannot infer the route's existence. It runs before `authenticate`.

Admin API: `GET /api/modules`, `PUT /api/modules/:code` (requires `settings.manage`).

> **Note (Tier 3+):** The module-enabled cache is in-process only. With multiple backend instances, cache invalidation is not propagated across instances — one node may serve stale enabled/disabled state. At Tier 3+, replace the in-process cache with a Redis-backed store or add a background job that broadcasts cache invalidation to all instances.

---

## 7a. Attendance tracking

Clock-in/clock-out punches, independent of shift assignment (an employee may punch without one, e.g. for unscheduled work), with a separate approval step before the hours count toward reporting.

```
POST /api/attendance/clock-in            clock in (self)
POST /api/attendance/:id/clock-out       clock out an open record (self, ownership-checked)
GET  /api/attendance                     list (own for employees, all for holders of attendance.approve)
GET  /api/attendance/:id                 read one (own or approver)
POST /api/attendance/:id/approve         requires attendance.approve
POST /api/attendance/:id/reject          requires attendance.approve
GET  /api/attendance/cost-estimate       planned vs. actual hours/cost for a date range — requires the payroll module and attendance.read
```

**Lifecycle**: `clock-in` creates a record with `clock_out = NULL, status = 'pending'`. `clock-out` fills `clock_out`. Only a clocked-out record (`clock_out IS NOT NULL`) can be approved; a still-open record can only be rejected outright.

**Separation of duties**: a reviewer holding `attendance.approve` still cannot approve or reject their own record — `AttendanceService.approve`/`reject` guard on `user_id != reviewerId` in the same atomic `UPDATE ... WHERE status = 'pending'` used elsewhere in the codebase, returning a clear "cannot approve your own attendance record" error rather than a generic conflict.

**Cost estimate**: compares planned cost (sum of `shift_assignments` hours × `users.hourly_rate` for the date range) against actual cost (sum of approved `attendance_records` hours × hourly rate) per department. Gated by the `payroll` module in addition to `attendance`, and by `attendance.read`.

Required permissions: `attendance.approve` (approve/reject), `attendance.read` (view others' records and cost estimates). Clock-in/out require no special permission beyond authentication — every user can punch for themselves.

---

## 7b. Business policies

Configurable rules (`policies` table, `PolicyService`/`PolicyValidator`) scoped to `global`, an org unit, a schedule, or a shift template. `policyKey` is a free-text field — the catalog is not a fixed enum — but `PolicyValidator.evaluate()` only assigns real blocking behavior to specific keys:

| `policyKey` | Enforcement |
|---|---|
| `manual_assignment_locked` | **Enforced.** Blocks `POST /api/assignments` outright unless the target has an approved `PolicyExceptionRequest`. |
| `min_rest_hours`, `max_hours_week`, `max_consecutive_days`, `staffing_min`, `skill_required` | **Not enforced by the policy engine.** These keys are accepted by `POST /api/policies` and stored, but `PolicyValidator` treats them as informational only — creating one does not block anything. The equivalent working-time limits (rest hours, weekly hours, consecutive days) **are** enforced separately and unconditionally by `ComplianceEngine.evaluateAssignmentCompliance` (§6, driven by `system_settings` / `user_preferences`, not by the `policies` table), so assignments are still protected — but through a different, non-configurable-per-scope mechanism. `staffing_min` and `skill_required` have no equivalent enforcement anywhere today. |

Implication: an administrator who creates a `max_hours_week` (or `staffing_min` / `skill_required`) policy through the Policies UI gets no error, but the policy has no effect — this is a known gap, not yet surfaced in the UI. Extending `PolicyValidator.evaluate()` to cover the remaining keys (or wiring `ComplianceEngine`'s thresholds to read from `policies` instead of `system_settings`) is open work; `manual_assignment_locked` is the only key to treat as load-bearing today.

---

## 8. Delegation framework

User A can grant User B a time-bounded subset of their own permissions.

```
POST   /api/delegations           { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId? }
GET    /api/delegations           list own delegations (as delegator or delegatee)
DELETE /api/delegations/:id       revoke (delegator only)
```

Rules:
- Creating and revoking require the `delegation.manage` permission (granted to Administrator and Manager by default); listing one's own delegations only requires authentication.
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

Valid `approverScope` values for `approval_steps`:
- `policy_owner` — the user who owns the policy being acted on
- `unit_manager` — manager of the org unit in context
- `unit_manager_chain` — walks up the org tree and returns the first unit with a manager
- `unit_structure` — assigns the decision to the org unit as a whole rather than a single person; the unit's head then chooses to keep, delegate, or open it — see [9c](#9c-structure-vs-person-decision-delegation)
- `company_role` — any active user holding `approverRoleId`
- `company_user` — a specific user identified by `approverUserId`
- `responsibility_rule` — resolves approvers dynamically via the responsibility matrix; requires `approverPermissionCode` on the step; `ApprovalEngineService.resolveAllApproversForStep(step, ctx)` returns the full set for fan-out notifications

Every `pending_approvals` row belongs to exactly one entity — `change_request_id`, `time_off_request_id`, `employee_loan_id`, or `shift_swap_request_id` (a `CHECK` constraint enforces exactly one is set). Time-off, employee-loan, and shift-swap approve/reject now route through the same `ApprovalEngineService.decidePendingApproval` as change requests, instead of each having its own bespoke authorization check.

---

## 9a. Responsibility matrix

The responsibility matrix maps `(subject group × permission code) → responsible org unit`, supporting multiple offices holding the same responsibility over different subordinate groups.

```
GET    /api/responsibility-rules              list rules (responsibility.read)
POST   /api/responsibility-rules             create rule (responsibility.manage)
GET    /api/responsibility-rules/resolve     resolve responsible user IDs (responsibility.read)
GET    /api/responsibility-rules/:id         get one (responsibility.read)
PUT    /api/responsibility-rules/:id         update (responsibility.manage)
DELETE /api/responsibility-rules/:id         delete (responsibility.manage)
```

**Subject types** (`subjectType`):
- `org_unit` — rule applies when the subject belongs to a specific org unit (`subjectId` = org unit ID)
- `department` — rule applies when the subject belongs to a department
- `role` — rule applies when the subject holds a role
- `all` — rule applies globally regardless of group membership (`subjectId` must be null)

**Resolution algorithm** (`GET /api/responsibility-rules/resolve?permissionCode=...&orgUnitId=...&departmentIds=1,2&roleIds=5`):
`ResponsibilityRuleService.resolveResponsibleUsers(ctx)` builds a single query covering all applicable subject conditions (org_unit OR department OR role OR all), joins the matching rules to `user_org_units` of the responsible org unit, and returns de-duplicated user IDs. The optional `delegatedToRoleId` on a rule further filters to members who also hold that role.

Limits: `departmentIds` and `roleIds` are capped at 100 entries each.

Required permissions: `responsibility.read` (read), `responsibility.manage` (write). Both are granted to the Manager role by default.

---

## 9b. Change requests

The change request mechanism lets subordinates propose changes that, once approved and applied, are attributed in the audit log to the authority holder (approver) while preserving the proposer's identity via `on_behalf_of_user_id`.

```
GET    /api/change-requests              list all (change_request.review)
POST   /api/change-requests             submit proposal (change_request.create)
GET    /api/change-requests/:id         get one (change_request.review or own proposer)
POST   /api/change-requests/:id/approve approve (change_request.review)
POST   /api/change-requests/:id/reject  reject  (change_request.review)
POST   /api/change-requests/:id/apply   apply   (change_request.review)
POST   /api/change-requests/:id/cancel  cancel  (own proposer or change_request.review)
```

**Lifecycle**: `pending → approved → applied` (or `rejected` / `cancelled`). Status transitions are strictly guarded — attempting an invalid transition returns HTTP 409.

**Proxy attribution**: when `apply` is called, `ChangeRequestService.apply()` writes an audit log entry with `actorId = approverUserId` (authority holder) and `onBehalfOfUserId = proposerUserId`. This makes the action appear decided by the authority holder while keeping the full delegation chain auditable.

**`proposedPayload`**: arbitrary JSON object describing the proposed change (e.g. `{ "scheduleId": 42, "action": "publish" }`). The schema is opaque to the service layer; the caller that processes the `apply` event is responsible for interpreting it.

Required permissions: `change_request.create` (propose), `change_request.review` (approve/reject/apply/list). Both are granted to the Manager role by default.

---

## 9c. Structure-vs-person decision delegation

Any workflow-routed decision — change request, time-off, employee loan, or shift swap — can be assigned to an org unit as a whole (`approverScope: 'unit_structure'`) instead of a single person. `pending_approvals.assigned_to_org_unit_id` holds the unit; `assigned_to_user_id` defaults to that unit's head (`org_units.manager_user_id`) so the decision is immediately actionable without the head having to "claim" it first.

The unit head then has three choices for a decision still sitting with them:

```
POST /api/pending-approvals/:id/keep               keep and decide it personally (idempotent)
POST /api/pending-approvals/:id/delegate            { targetUserId } — hand it to one member of the unit
POST /api/pending-approvals/:id/open-to-structure   any member of the unit may now decide it
GET  /api/pending-approvals/:id/chain               chain of command for this decision
```

Every keep/delegate/open-to-structure action appends one row to `decision_reassignments` (`action`, `actor_user_id`, `target_user_id`, `created_at`) — an append-only audit trail, never overwritten. `GET .../chain` assembles: the assigned org unit and its head, the full `decision_reassignments` history in order, the current assignee, and who ultimately decided it (`pending_approvals.decided_by_user_id`).

**Authorization**:
- Deciding a `unit_structure` item: the current assignee, or (once opened) any member of `assigned_to_org_unit_id` — same `ApprovalEngineService.decidePendingApproval` check used for person-assigned decisions.
- Keeping/delegating/opening: only the unit's head (`requireStructureHead` — verifies `org_units.manager_user_id === headUserId`, and that the decision is still `pending`).
- Viewing the chain: deliberately broader than deciding it — the original proposer, the current assignee, whoever already decided it, and any member of the assigned structure (regardless of whether it has been opened to the whole team yet), since "who is this decision with" is exactly what an affected team member needs to see.

`approve`/`reject` on `/api/pending-approvals/:id/...` are entity-agnostic: they inspect which of the four entity FKs is set on the `pending_approvals` row and dispatch to the matching service (`ChangeRequestService`, `TimeOffService`, `EmployeeLoanService`, or `ShiftSwapService` — note `ShiftSwapService.decline`, not `.reject`), via the shared `dispatchPendingApprovalDecision` helper (`src/services/PendingApprovalDispatch.ts`).

---

## 10. Audit trail

Every sensitive mutation writes an `audit_logs` row via `AuditLogService.write(input)`.

Audited actions: `user.create`, `user.update`, `user.delete`, `role.grant`, `role.revoke`, `schedule.publish`, `schedule.archive`, `policy.create`, `policy.update`, `policy.delete`, `org_unit.create`, `org_unit.update`, `org_unit.delete`, `delegation.grant`, `delegation.revoke`.

`before_snapshot` and `after_snapshot` (JSON) are captured for role grants and policy changes.

`GET /api/audit-logs` supports filtering by `userId`, `action`, `entityType`, `entityId`, `fromDate`, `toDate`, `limit`, `offset`. No `DELETE` endpoint exists.

`GET /api/audit-logs/export` returns all matching entries without row limit (same filters, no `limit`/`offset`). Supported formats: `?format=csv` (returns `text/csv` with `Content-Disposition: attachment`) and `?format=json` (default). Requires `audit.read` permission. Use `fromDate`/`toDate` to scope exports to a specific period and avoid loading the full table.

---

## 10a. Observability and operations

The backend exposes both halves of observability; a self-hosted stack to consume
them ships as an opt-in Docker Compose profile.

### Metrics

`GET /metrics` renders Prometheus metrics (`backend/src/observability/metrics.ts`):

- default process metrics (event loop, memory, GC);
- `http_request_duration_seconds` — request-duration histogram labelled by
  `method` / `route` / `status_code`. The label is the matched **route pattern**
  (e.g. `/api/v1/schedules/:id`), never the concrete path, so ids can't explode
  label cardinality. The `_count` series doubles as the request/error counter;
- `db_pool_connections` — a gauge of the mysql2 pool by state
  (`total`/`free`/`in_use`/`queued`), sampled at scrape time;
- `optimization_queue_depth` — optimization jobs waiting in the BullMQ queue.

`/metrics` is mounted **outside** `/api` (a scraper is not a JWT user) and guarded
by a static bearer token: set `METRICS_TOKEN` and scrapers must send
`Authorization: Bearer <token>`. When unset, the endpoint is open — only
appropriate for local dev or when `/metrics` is not reachable from outside the
internal network (as in the bundled `ops` profile).

### Tracing

OpenTelemetry (`backend/src/observability/tracing.ts`) adds distributed traces
with HTTP/Express/mysql2 auto-instrumentation. It is **off by default** and
starts only when `OTEL_ENABLED=true` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set;
`otel-bootstrap.ts` is imported first in `index.ts` so instrumentation patches
the libraries before they load. Every span carries `request.id`, matching the
`X-Request-Id` header and the logs — so an operator can pivot from a log line or
a response header to the exact trace and back.

### The `ops` compose profile

```bash
docker compose --profile ops up -d
```

Starts Prometheus, Grafana, Loki and Promtail (config under `ops/`), all on the
internal network with only Grafana published (`GRAFANA_PORT`, default `3002`;
login `admin` / `GRAFANA_ADMIN_PASSWORD`):

- **Prometheus** scrapes `backend:3001/metrics` every 15s and loads the alert
  rules in `ops/prometheus/alerts.yml` (high 5xx rate, high p95 latency, DB pool
  near exhaustion, optimization-queue backlog, backend down).
- **Grafana** is pre-provisioned with the Prometheus and Loki datasources and a
  base "Service health" dashboard (request rate by status, 5xx ratio, p95
  latency, DB pool, queue depth).
- **Loki** stores logs; **Promtail** tails the backend's Winston log file from
  the shared `backend_logs` volume and ships it to Loki, so logs are queryable in
  Grafana alongside the metrics.

The bundled profile leaves `METRICS_TOKEN` unset and relies on network isolation.
To require a token, set `METRICS_TOKEN` and add a matching `authorization` block
to `ops/prometheus/prometheus.yml`.

### Backups and restore

Logical `mysqldump` backups run from a sidecar; the scripts live in `ops/backup/`.

Start the scheduled backup sidecar (also included in the `ops` profile):

```bash
docker compose --profile backup up -d
```

It writes a consistent (`--single-transaction`), gzipped, timestamped dump to the
`backup_data` volume every `BACKUP_INTERVAL_SECONDS` (default daily) and prunes
dumps older than `BACKUP_RETENTION_DAYS` (default 14). A dump smaller than 1 KB
is treated as a failure and removed, so an empty/failed dump never masquerades as
a good backup.

**Restore runbook** (recovering into the running stack):

1. Identify the dump to restore (newest is `--latest`):
   ```bash
   docker compose exec backup ls -1t /backups
   ```
2. Stop the backend so nothing writes mid-restore:
   ```bash
   docker compose stop backend
   ```
3. Restore (the script recreates the database if needed):
   ```bash
   docker compose exec backup /scripts/restore.sh --latest
   # or a specific file:
   docker compose exec backup /scripts/restore.sh /backups/staff_scheduler_YYYYMMDDToooooZ.sql.gz
   ```
4. Bring the backend back up and verify:
   ```bash
   docker compose start backend
   curl -fsS http://localhost:3001/api/health
   ```

To validate a backup **without** touching production data, point `DB_NAME` at a
scratch database before running `restore.sh`.

**Restores are tested, not assumed.** The `.github/workflows/backup-restore.yml`
job runs weekly (and whenever the backup scripts or migrations change): it applies
the migrations, seeds a marker row, runs the real `backup.sh`, DROPs the database,
runs the real `restore.sh --latest`, and asserts the marker survived the
round-trip. A broken restore path is therefore a red CI check, not a discovery
made during an incident.

### Deployment hardening and scaling

The production compose file (`docker-compose.yml`) is hardened relative to the dev
override:

- **MySQL is not published to the host.** It listens only on the internal compose
  network; the backend and the migration runner reach it by service name. Local
  tooling gets a host port back through the dev override, and production admin
  access goes through the `dev`-profile phpMyAdmin or a temporary, explicit port
  forward — the database is never exposed to the host by default.
- **`caching_sha2_password`.** MySQL uses its 8.x default authentication plugin;
  the legacy `mysql_native_password` (deprecated, removed in MySQL 9) is no longer
  forced. Both the backend driver (`mysql2`) and the migration runner
  (`dbmate`/go-sql-driver) authenticate with it over the internal network.

### Replicas and zero-downtime rolling deploys

Externalising all shared state to Redis (JTI blacklist, auth-context cache,
module flags, SSE fan-out) removed the implicit "exactly one backend instance"
constraint: replicas are interchangeable, so one can be replaced while the others
serve traffic. The default compose file runs a single backend; the
`docker-compose.scale.yml` overlay adds the deployment side.

```bash
# Run N replicas behind an nginx load balancer (which owns the API host port)
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale backend=2
```

The overlay clears the backend's published port (several replicas cannot share
one host port) and puts `backend-lb` (nginx, `ops/nginx/backend-lb.conf`) in
front. Both that load balancer and the frontend's own `/api` proxy resolve the
`backend` hostname **through Docker's DNS with a short TTL, via a variable
`proxy_pass`** — nginx resolves a literal `proxy_pass` hostname only once at
startup, which would pin every request to a single replica and break when that
replica is replaced. Both also disable proxy buffering and raise the read timeout
so the SSE stream (`/api/events`) works through them.

Rolling deploy:

```bash
ops/deploy/rolling-deploy.sh 2      # replica count (default 2)
```

Compose has no native per-replica rolling update, so the script does the standard
scale-up/scale-down dance: build the new image, scale **up** to 2N (new replicas
start alongside the old), wait until the load balancer answers, then scale back
**down** to N — Compose removes the oldest containers, i.e. the previous image.
Throughout, a poller hits `/api/health` twice a second and the script **fails the
deploy if a single request was dropped**, so "zero downtime" is verified rather
than asserted.

Requires Redis (the default): with `REDIS_ENABLED=false` the caches are
process-local and replicas would disagree with each other.

---

## 11. Extension points

### Adding a new route

1. Create `backend/src/routes/myFeature.ts` with `export const createMyFeatureRouter = (pool: Pool): Router => { ... }`.
2. Register in `backend/src/app.ts`: `app.use('/api/my-feature', createMyFeatureRouter(pool))`.
3. Add `requireModule('my-module')` and `requirePermission('my.perm')` guards as needed.

### Adding a new permission

1. Add an `INSERT IGNORE INTO permissions` row in a new migration (`npm run db:migrate:new -- add_<code>_permission`).
2. Assign it to the appropriate role(s) via `role_permissions` seed rows.
3. Reference the code string in your route / middleware.

### Adding a new module

1. Add an `INSERT IGNORE INTO modules` row in a new migration.
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

# One install for the whole monorepo: the repository uses npm workspaces with
# a single root lockfile, so backend, frontend and packages/shared are
# installed (and the shared contract package compiled) in one step.
npm install

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET

cd backend
npm run db:init          # applies schema migrations (no data)
npm run db:seed:demo     # optional: load realistic demo data
npm run dev              # starts on http://localhost:3001

# Frontend (new terminal)
cd frontend
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

**Input validation**: Use `validateBody(schema)` and `validateParams(schema)` from `src/middleware/validation.ts` with Zod schemas in `src/schemas/`. The `express-validator` library is not used in this codebase and must not be introduced in new code.

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

1. Add the Zod schema to `packages/shared/src/schemas.ts` — the shared package is
   the canonical contract; `backend/src/schemas` re-exports it.
2. Add the business logic to an existing service or create a new one in `backend/src/services/`.
   Services throw typed errors from `src/errors`; they never format HTTP responses.
3. Add the route handler in `backend/src/routes/`, wrapped in `asyncHandler`, using
   `validateBody`/`validateParams` with the shared schema. Mount new routers in
   `backend/src/app.ts` (under both the `/api` and `/api/v1` prefixes).
4. Regenerate the contract: `npm run openapi:generate` (backend) — request bodies in
   `backend/openapi/openapi.json` are **generated** from the Zod schemas and CI fails on
   drift. Only curated prose (summaries, response descriptions) is edited by hand.
   Then regenerate the frontend client: `npm run api:generate` (frontend).
5. Write tests in `backend/src/__tests__/`.
6. Update the relevant section of `DOCUMENTATION.md` in the same PR.

### Adding a new frontend page

1. Create the page component in `frontend/src/pages/`.
2. Put server state in a TanStack Query hook under `frontend/src/hooks/` (queries plus
   mutations that invalidate the relevant key) rather than hand-written loading/error
   state in the component. Service modules call the generated typed client
   (`src/api/client`) where the endpoint exists in the OpenAPI spec.
3. Add the route in `frontend/src/App.tsx`.
4. Reuse the contract types: import request/response shapes from
   `@staff-scheduler/shared` or the generated `src/api/schema.ts`. Do not hand-copy
   backend types — the shared package exists precisely so they cannot drift.
5. Wrap async regions in the shared `QueryState` component so loading/error/empty
   states are consistent across pages. Page tests must import `render` from
   `src/test-utils/renderWithClient` (it provides an isolated QueryClient).

### Database schema changes

All schema changes are dbmate migrations in `backend/db/migrations/`. The migration chain is the single source of truth for the schema — CI applies it from scratch and also verifies the rollback path.

Guidelines:
- One migration per PR-sized schema change, created with `npm run db:migrate:new -- <name>`; never edit a migration that has already been merged.
- Every migration defines both `-- migrate:up` and `-- migrate:down`.
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

### Dependency major-version policy

The frontend build tooling is Vite (`vite` + `@vitejs/plugin-react`); the former Create React App toolchain and its unpatchable transitive vulnerabilities were removed during that migration. Remaining major-version gaps are deliberate pins, upgraded only when there is a concrete driver: React 18 (React 19 offers no feature this app needs and would force `@testing-library` / type churn), Jest 29 (aligned with the `ts-jest` 29.x line used in both packages), and ESLint 8 (the flat-config migration required by ESLint 9+ is pending). Security patches within these majors are applied as they appear.

## 13. Architectural decisions

| Decision | Rationale |
|---|---|
| Permission-based RBAC (no hardcoded roles) | Roles are customer data. Hard-wiring `admin`/`manager`/`employee` prevents multi-tier hierarchies. `user_roles` grants are scoped and time-bound, supporting org-unit subtree access and temporary elevation. |
| JWT in httpOnly cookie + JTI blacklist | The cookie prevents XSS from stealing the token. The `jti` claim in each token enables server-side revocation on logout via an in-memory `Map<jti, expiresAt>` with lazy TTL expiry — lightweight and sufficient for single-instance deployments. |
| Auth cookie is `SameSite=Strict` | The SPA's HTML shell is public and all authenticated calls are same-site fetches, so Strict costs nothing and closes the residual CSRF window Lax leaves for top-level GET navigations. |
| Single MySQL pool per process | `src/index.ts` reuses the pool owned by the `database` singleton (`config/database.ts`) instead of creating a second one, so the configured `DB_POOL_LIMIT` is the real ceiling against MySQL. |
| Overnight shifts are rejected at validation | Conflict detection, hour accounting and the dashboard aggregates all assume a shift starts and ends on the same calendar day. Zod time schemas enforce `startTime < endTime` so the invariant is explicit at the boundary instead of silently violated downstream. |
| Hard cutover (no backward-compat shim) | The 3-role ENUM was the root of every hardcoded check. A migration shim would perpetuate the pattern. The seeded bootstrap roles (Administrator/Manager/Employee) reproduce prior behaviour without any shim. |
| `requireModule` returns 404 | A 401 leaks that the route exists. 404 is the correct response when an entire feature is absent; no information is disclosed. |
| In-process module cache | Module state changes infrequently. A per-request DB lookup for a static flag is wasteful. Cache invalidation on `setEnabled` is a single line. |
| `AuditLogService.write` swallows errors | An audit write failure must never block a business operation. The audit log is observability, not a transaction requirement. |
| `WITH RECURSIVE` CTE for org-unit subtrees | Fetches the entire subtree in one query. No N+1. Depth is bounded by the org tree (typically < 10 levels). |
| `approval_matrix` preserved alongside `approval_workflows` | Removing it would break existing service tests and the `policies` route that still calls `ApprovalMatrixService`. A future PR can migrate these callers and drop the legacy table. |
| Deliberate major-version holds: express 4, helmet 7, express-rate-limit 7, jest 29, dotenv 16 | All are actively maintained with zero known vulnerabilities (`npm audit` gate in CI). Their next majors are API-breaking (e.g. Express 5 changes wildcard routing) with no security payoff today; upgrades should be dedicated PRs, not drive-by bumps. ESLint, by contrast, was EOL on v8 and has been migrated to v9 flat config. |

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

### Backend integration tests (real MySQL)

The mocked unit suites cannot catch drift between service SQL and the actual schema, so `backend/src/__tests__/integration/` runs the real Express app against a real MySQL server:

```bash
cd backend
DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=... npm run test:integration
```

The suite provisions a throwaway `staff_scheduler_itest` database from the migration chain, seeds minimal fixtures, exercises login/logout (including JTI revocation), `POST /api/assignments`, the user directory and the dashboard aggregates, then drops the database. It is excluded from `npm test` (see `testPathIgnorePatterns`) and runs in CI inside the e2e job, which already provides a MySQL service.

### Workforce simulation harness

`backend/scripts/simulation/` contains a database-level simulation harness that complements the Playwright UI smoke tests:

```bash
cd backend
npm run sim:run        # one full simulation against the configured database
npm run sim:campaign   # many simulations, each on a freshly created database
```

- `sim:run` simulates a whole organization in rolling rounds: employee actors file time-off / employee-loan / shift-swap requests, manager actors decide or delegate every pending approval, the period schedule is generated with the real `AutoScheduleService`, and every outcome is verified against actual database state plus the production `ComplianceEngine`.
- `sim:campaign` fans out N runs over parallel lanes. Each run derives its org structure, pacing, and approval-authorization model deterministically from `--baseSeed`, and gets a fresh per-lane database (drop, re-create, schema init, demo seed). Requires root credentials via `DB_ROOT_PASSWORD` (or `MYSQL_ROOT_PASSWORD`). Results land in `backend/scripts/simulation/output/campaign-<timestamp>/` (`run-XX.log` per run plus `summary.log`); the exit code is non-zero if any run reports a verification failure.

---

Planned work is tracked exclusively in [GitHub Issues](https://github.com/lucaosti/StaffScheduler/issues): every capability, refactoring or idea gets a small, atomic issue. This document describes the system as it exists; anything aspirational belongs in an issue, not here.
