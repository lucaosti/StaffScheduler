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
├── middleware/       # authenticate, requirePermission, requireModule, validation,
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
- **`departments.org_unit_id`** — optional FK added in PR #103 to enable org-tree scoping of schedules and shifts, and later reused as the bridge that lets `employee_loans` (scoped to `org_units`) extend a department's scheduling candidate pool.
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

`http://localhost:3001/api/v1` (development). Every endpoint in this document is written relative to this base — `POST /auth/login` means `POST /api/v1/auth/login`.

**Legacy `/api` prefix (#319)**: retired as a live mount. A request to the bare `/api/...` prefix now gets a 308 redirect to the equivalent `/api/v1/...` path — method and body are preserved, but a client still depending on the old prefix should move to `/api/v1` directly rather than relying on the redirect indefinitely.

### Authentication

```
POST /api/auth/login             { email, password, code?, methodType? } → sets httpOnly cookie "token"; body: { user: { id, email, firstName, lastName, roles, permissions } }
POST /api/auth/login/challenge   { email, password, methodType } → pre-session challenge request (email code delivery, WebAuthn assertion options)
GET  /api/auth/verify            (cookie) → { user }
POST /api/auth/refresh           (cookie) → rotates cookie; body: { user }
POST /api/auth/logout            blacklists the JTI and clears the cookie
```

JWT payload: `{ userId, email, jti }` — no role. Permissions are resolved from the DB on every request. The `jti` field enables server-side revocation on logout via an in-memory blacklist with TTL-based expiry. The cookie lifetime tracks `JWT_EXPIRES_IN` so cookie and token always expire together.

**Two-factor authentication**: when an account has ANY method enabled (`POST /api/auth/2fa/setup` + `/enable`, with an optional `methodType` — see the method registry below), login additionally requires `code` (and, when the enrolled method isn't TOTP, `methodType`) — that method's code/assertion, or an unused recovery code. A password-valid login without `code` answers 401 `TWO_FACTOR_REQUIRED`, whose response carries `data.methods` (the account's enabled method types, so the client knows what to offer); a wrong code answers 401 `TWO_FACTOR_INVALID`. Disabling one method (`POST /api/auth/2fa/disable`) likewise requires a valid code for that method, or a recovery code. Accepted codes are single-use: TOTP's matched time-step counter and email/WebAuthn's challenge are cleared via a compare-and-set update on verification, so an intercepted code/challenge cannot be replayed; recovery-code consumption uses the same compare-and-set pattern.

**Method registry**: `TwoFactorService` is a dispatcher over `TwoFactorMethodProvider` implementations keyed by `TwoFactorMethodType` (`'totp' | 'webauthn' | 'email' | 'sms'`) — TOTP (`TotpProvider`), email one-time codes (`EmailCodeProvider`), WebAuthn/passkeys (`WebAuthnProvider`), and SMS one-time codes (`SmsCodeProvider`) are all registered, each slotting into the same provider map with no change to the dispatcher, the routes, or the request schema. Enrollment data is per-user-per-method in `two_factor_methods` (`secret_data` is a provider-specific JSON blob — a TOTP secret and a WebAuthn credential have nothing in common, so dedicated `users` columns per method would force a migration per provider and leave most columns NULL for most rows; the table's `UNIQUE(user_id, method_type)` also means one passkey per user, not a full passkey manager — sufficient for a second factor). Recovery codes stay OFF that table, on `users.two_factor_recovery_codes`: they authenticate "you own this account," not "you have this specific method," so there is one set per user regardless of how many methods are enrolled — generated the first time ANY method is enabled, reused (not regenerated) when a second method is added, and cleared only once the last enabled method is removed. Every public `TwoFactorService` method defaults its `methodType` parameter to `'totp'`, so a caller that only ever used TOTP (every caller before #591) is unaffected.

**Multi-method routes and login (#591, part of #331)**: `GET /api/auth/2fa/methods` lists the caller's own enabled method types (for a Settings-page enrollment UI); `POST /api/auth/2fa/setup`/`/enable`/`/disable`/`/verify` all accept an optional `methodType` (defaults to `'totp'`); `POST /api/auth/2fa/challenge` (authenticated) requests a fresh challenge for an already-enabled method via `TwoFactorService.requestChallenge`. Login itself now checks `hasAnyEnabled`/`listEnabledMethods` rather than hardcoding the `'totp'` provider. For a method that needs a challenge before it can be verified (email, WebAuthn) but the caller has no session yet, `POST /api/auth/login/challenge` is the pre-session equivalent of `/auth/2fa/challenge`: it re-verifies email+password (the same reason `/login` itself waits for a valid password before revealing anything 2FA-related — an unauthenticated caller must not be able to trigger an email send, or learn a WebAuthn credential exists, for an arbitrary address by guessing it) before issuing the challenge. It is intentionally NOT under `/auth/2fa/*`, which is entirely behind `authenticate` — living alongside `/auth/login` instead means an unauthenticated request never has to pass through that router's gate at all.

**Frontend (#594, part of #331)**: `TwoFactorSection.tsx` (Settings) renders one row per available method (TOTP, WebAuthn, email — SMS is omitted here too, since `isSmsConfigured()` is always false until an operator wires in a real vendor, and offering it would be a button that always fails), each with its own enrollment and disable flow rather than one shared form, since disabling now targets ONE method. `Login.tsx` renders the method picker from `TWO_FACTOR_REQUIRED`'s `data.methods` (via `ApiError.data`, added for exactly this) and, for a method that needs a challenge (email, WebAuthn), calls `POST /auth/login/challenge` before a code can be produced. WebAuthn ceremonies go through `services/webAuthnClient.ts`, a thin wrapper over `@simplewebauthn/browser`'s `startRegistration`/`startAuthentication` that translates ceremony failures (the user cancels the OS passkey prompt, the browser lacks WebAuthn support) into a message a person can act on rather than a generic "request failed". WebAuthn's browser gesture requirement shapes two UI decisions: enrollment shows an explicit "Continue with passkey" button rather than auto-running the ceremony right after `beginTwoFactorSetup`'s `await` (chaining across that boundary risks the browser silently refusing the prompt), and disabling a passkey-only account offers "Use a recovery code instead" as a fallback, since there is no code field to type into otherwise.

**Delivered challenge codes**: unlike TOTP, an email, SMS, or WebAuthn code/assertion cannot be computed from a stored secret — it must be generated first, and for email and SMS, sent. `TwoFactorMethodProvider.requestChallenge` is that extra, OPTIONAL step (TOTP has no equivalent and simply omits it; `TwoFactorService.requestChallenge(userId, methodType)` throws a clear error for a method whose provider doesn't implement it, same as for an unregistered method type). Its return value is provider-specific: `EmailCodeProvider` writes directly to `email_outbox` with `notification_id = NULL` — not through `NotificationService.notify()`, because a one-time code has no business sitting in someone's in-app notification list — delivered by the same `OutboxWorker`, with the same retry behaviour, as every other outbound email, and returns nothing (the code goes out of band). `WebAuthnProvider` has no delivery channel at all: the challenge itself (a `PublicKeyCredentialRequestOptionsJSON`) IS what the browser needs to call `navigator.credentials.get()`, so `requestChallenge` returns it directly rather than sending it anywhere. Codes/challenges are single-use via the same compare-and-set pattern as TOTP's replay guard; email and SMS codes are additionally 6-digit and SHA-256-hashed at rest (a fast hash, not bcrypt — a low-entropy short-lived code gains nothing from a slow per-hash cost that expiry+single-use don't already provide). `EmailCodeProvider` refuses to operate at all when `isEmailConfigured()` is false, rather than silently enrolling an undeliverable method; `SmsCodeProvider` does the same with `isSmsConfigured()` (see below).

**SMS provider abstraction**: the `sms` method type exists end-to-end in the registry (routes, schemas, `two_factor_methods.method_type` ENUM), but no SMS vendor is implemented — that is a deliberate scope boundary, since choosing one is a separate decision involving an external paid account and credentials. `SmsService.ts` defines the seam a vendor plugs into: a `SmsProvider` interface with a single method, `send(toNumber: string, body: string): Promise<void>`, and `isSmsConfigured()`, shaped identically to `isEmailConfigured()` but hardcoded to always return `false` today (there is nothing valid to gate on without a vendor's config). `SmsCodeProvider` (structurally a mirror of `EmailCodeProvider`: 6-digit code, `secret_data` hash + expiry, compare-and-set single-use verification) takes an optional `SmsProvider` via constructor injection, defaulting to `undefined` — `TwoFactorService` currently constructs it with none, which is safe because `isSmsConfigured()` being false means every send-capable operation (`beginSetup`, `requestChallenge`) refuses with a `ConflictError` before it would need one. Unlike `email`, `users.phone` is optional, so a missing number on an otherwise-configured account is a distinct `ConflictError` ("no phone number on file"), not `NotFoundError`. There is no `sms_outbox` table or worker: delivery goes straight through the injected `SmsProvider`, since a queue for a delivery path nothing can use yet would be speculative infrastructure.

To wire in a real vendor: add its config fields under `config.sms` in `backend/src/config/index.ts` (mirroring `config.email`'s host/auth/from shape); change `isSmsConfigured()` in `SmsService.ts` to the same `Boolean(config.notifications.smsEnabled && config.sms.provider && ...)` shape `isEmailConfigured()` uses, over the new fields; implement `SmsProvider` in a new class wrapping the vendor's SDK (`send(toNumber, body)`); and construct that class into `SmsCodeProvider`'s second constructor argument where `TwoFactorService` builds its provider map. No route, schema, or dispatcher change is needed for any of this.

**WebAuthn/passkeys (#587, part of #331)**: `WebAuthnProvider` wraps `@simplewebauthn/server`. The relying party ID is derived from `CORS_ORIGIN`'s bare hostname (`new URL(config.cors.origin).hostname`) — WebAuthn ties every credential to a specific RP ID, so this must match the frontend's real origin in every environment, not a hardcoded value. `beginSetup` calls `generateRegistrationOptions` and returns the whole options object as the setup payload (the browser passes it straight to its passkey-creation call); `confirmEnable`'s `code` parameter is a JSON-stringified `RegistrationResponseJSON` rather than a short code — the interface's `code: string` is reused as-is (not widened) so no other layer needs to know WebAuthn's payload is richer. The credential's public key (`Uint8Array`) is base64-encoded for JSON storage in `secret_data` and decoded back whenever a credential needs reconstructing for `verifyAuthenticationResponse`. The counter `@simplewebauthn` returns after a successful authentication is persisted (clone-detection bookkeeping the library's own docs recommend keeping) but not independently re-validated — the library's `verified` boolean is treated as authoritative, and the challenge-based compare-and-set is what actually prevents replay.

### List endpoints: filtering and pagination

List endpoints accept `?page` and `?pageSize` (max 200, default 25). When
either is present the response carries a `meta` block
(`{ total, page, pageSize, pages }`) alongside `data`; when neither is present
the plain `{ success, data }` shape is returned, for backward compatibility.

Query filters are validated with `validateQuery(schema)` against a Zod schema
in `@staff-scheduler/shared`, the same way bodies and path params are, and the
spec's `parameters` are **generated** from those schemas by
`npm run openapi:generate`.

This is deliberate. Request bodies were generated and drift-checked from the
start, but `parameters` were hand-curated prose that nothing compared against
the code — so they drifted: six endpoints published filters their handlers
never read (`GET /api/assignments` ignored all seven of its documented filters;
`/departments`, `/schedules`, `/employees`, `/users` and `/shifts` each ignored
one or more), and the reporting endpoints published `startDate`/`endDate` while
the code read `start`/`end`. A caller narrowing by `userId` or `isActive`
silently received everything.

The check runs in **both directions**, because each catches a defect the other
cannot:

- the spec documents a query parameter with no `validateQuery` behind it — the
  API promises a filter nothing parses;
- a handler reads `req.query` with no `validateQuery` on its route — the API
  accepts a filter the spec never mentions, so the generated client cannot
  offer it and the value reaches the service unvalidated.

Both fail generation, and `openapi.contract.test.ts` asserts the same two
properties in the normal Jest run. Together they make the query contract
complete: nothing documented is unparsed, and nothing parsed is undocumented.
Reading `req.query` or `req.body` directly in a route is therefore a failing
build, not a stale-documentation problem.

Both directions resolve `$ref` parameters before classifying them, because a
`$ref` entry carries only `$ref` and no `in`: testing `parameter.in === 'query'`
reads `undefined` and treats a referenced query parameter as though it were not
one. Since query parameters are generated, a referenced one is by construction
hand-written — precisely the case that needed checking, and the only one the
guards skipped. That blind spot let two reusable parameters,
`components.parameters.pageQuery` and `limitQuery`, publish a `limit` filter on
six operations no schema accepts (queries are schema-validated, so a client
following the contract had it stripped silently) and a duplicate `page` on four
of them, through a generator reporting a clean run. Both components are gone;
`limit` on `GET /api/dashboard/activities` — where the handler took `_req` and
hardcoded `LIMIT 10` — is now a real, validated parameter bounded at 50, since
that feed is a preview of the audit trail and `/api/audit-logs` is the endpoint
for reading through it. A reusable parameter no operation references now fails
generation, and `in: 'path'` refs (the structural `id`) stay hand-written.

A request body is marked `required` only when its schema has at least one
required field, so an all-optional body (the free-text audit `reason` /
`justification` fields) does not force every caller to send `{}`.

**Every** domain component in `components.schemas` is generated from the Zod
schemas in `packages/shared/src/domain.ts`, where each type is a `z.infer` of
its schema rather than a second hand-written copy. Only `ApiSuccess` and `ApiError` remain hand-written: they describe the
response wrapper itself, not a domain entity, so there is no single type to
derive them from — and a contract test asserts the hand-written set is exactly
those two, so nothing can quietly rejoin the surface that drifted.

`PaginationMeta` was on that list until it turned out to be wrong: it published
`limit` and `totalPages` while `sendPaginated` has always emitted `pageSize`
and `pages`, so every paginated response documented two fields that never
arrive and omitted two that do. It survived the phantom-field check because
that check is textual — it asks whether a name exists anywhere in the source,
not whether it belongs to that entity — and `totalPages` existed in a second,
unused pagination helper with a different shape. Deriving the component made
the comparison exact, and the dead helper is gone. They
had previously drifted into describing an older model — `User.role`, a field
the API has never sent; `Permission.category`/`key` instead of
`code`/`resource`/`action`; `Role.isBuiltin` instead of `isSystem` — which is
worse than an omission, because a client generated from them gets wrong types.
Every generation run lists whatever is still hand-written, so the remaining
surface is stated rather than silently tolerated — and a contract test asserts that no
component, generated or hand-written, publishes a field that exists nowhere in
the source. Four did: `Department.memberCount` (the real field is
`employeeCount`), `Policy.valueType`, `TimeOffRequest.reviewedBy` (the reviewer
FK is `reviewerId`), and `Employee.employeeNumber` — the last on a component
for an entity the system does not have, since `GET /employees` returns users.
That component is gone and the endpoint references `User`.

Timestamps are the one place where the published shape and the in-process type
legitimately differ: the schema is `string | Date`, because mysql2 hands the
backend `Date` objects, while the wire form is always a string. The shared
`timestamp` schema is tagged so the generator emits
`{ type: 'string', format: 'date-time' }` for it.

`GET /api/assignments` additionally refuses — with `400`, rather than
truncating — an unpaginated request matching more than 5000 rows.
`shift_assignments` grows by one row per person per shift indefinitely, and a
short list that looks complete hides missing assignments; narrow the filters
or request a page.

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

**`GET /api/dashboard/attention-items`** is a shortlist, not a report: shifts in the next two weeks below their minimum staffing, and the caller's own pending approvals sorted oldest-first with counts over 24h/48h/7d. Understaffed shifts are scoped to the org units the caller belongs to (their own subtree) unless they hold `report.read`, which lifts that to everything — the same membership-bound-plus-lift shape used elsewhere in the app, applied here because nothing on the dashboard was previously scoped by org unit at all. Pending-approval aging needs no separate scoping: it is built directly on `PendingApprovalService.listForUser`, which already answers "assigned to this person, or their structure" — reusing it rather than re-deriving the same visibility rule a second time. Both lists are capped (20 items) with a `truncated` flag on the shift list when more matched; `/api/reports` and `/api/shifts` are where the full picture behind each figure lives.

**Batch endpoints (#316)**: `POST /api/employees/batch` and `POST /api/assignments/batch` accept up to 200 rows per request and report one outcome per row instead of aborting the whole batch on the first failure — the shape a high-volume integration needs to retry only what actually failed. Both return HTTP 207 with the shared envelope from `packages/shared/src/batch.ts`:

```json
{
  "success": true,
  "data": {
    "results": [
      { "index": 0, "success": true, "data": { "...": "the created row" } },
      { "index": 1, "success": false, "error": { "code": "CONFLICT", "message": "..." } }
    ],
    "succeeded": 1,
    "failed": 1
  }
}
```

`index` is the row's position in the request array — the only way to correlate a failure back to its input, since a row has no id of its own before creation. This is deliberately distinct from `POST /api/assignments/bulk`, which predates it: that endpoint serves internal callers that want "create what you can, discard the rest" (see `AssignmentService.bulkCreateAssignments`'s header) and returns only the successfully created rows, with no per-row detail. The two are not interchangeable — an integration that needs to know *which* rows failed and why must use `/batch`, not `/bulk`.

### Error codes (common)

| Code | HTTP | Meaning |
|---|---|---|
| `MISSING_TOKEN` | 401 | No `token` cookie and no `Authorization` header |
| `INVALID_TOKEN` | 401 | JWT invalid or expired |
| `TWO_FACTOR_REQUIRED` | 401 | Account has 2FA enabled; login needs `code` (`data.methods` lists which) |
| `TWO_FACTOR_INVALID` | 401 | Wrong 2FA code or recovery code |
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
| `report.read` | Reports (also gates the dashboard's monthly labor cost, and lifts `GET /dashboard/attention-items`'s understaffed-shift list from the caller's own org units to unrestricted) |
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

### Staffing suggestions (seasonal baseline)

`DemandForecastService` (`backend/src/services/DemandForecastService.ts`)
suggests a `min_staff` for the schedule editor from recent history — a
statistical seasonal baseline, not a model. For a department, weekday and
exact start/end time window, it averages how many distinct employees actually
worked matching shifts on **PUBLISHED** schedules (a draft is not what
happened) over the last `FORECAST_LOOKBACK_WEEKS` (12 by default), rounding
the average up. When there is no matching history, it falls back to the
matching active shift template's own `min_staff`, or to `1` if neither exists
— and always reports `basedOnOccurrences`, so the caller can tell a measured
suggestion from a fallback.

`GET /api/shifts/staffing-suggestion?departmentId=&date=&startTime=&endTime=`
(requires `schedule.read`) returns `{ suggestedMinStaff, basedOnOccurrences,
lookbackWeeks }`. The schedule editor shows this as a non-blocking hint next
to the min-staff input ("Suggested: 4 staff, based on 8 past occurrences") —
it is never auto-filled, so it cannot silently override what a planner typed.

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
cannot jointly bust a limit each satisfies alone. **Which** other schedules count
is a decision, not a sweep: assignments on **published** schedules within ±14 days,
plus the schedule this one explicitly continues from (`previous_schedule_id`),
whatever its status. A monthly schedule is consequent on the one before it, and
when several generations cover the same period — an abandoned one alongside the
one that happened — which is the predecessor is the manager's judgement:
`GET /schedules/:id/predecessor-candidates` lists them, `PUT /schedules/:id`
records the choice, and leaving it null resolves the default, the most recent
published schedule for the department ending before this one starts. Fairness crosses this boundary too, by a different route: each employee arrives with a **carried equity load** over the previous 90 days, read from published schedules only. Without it "weekend work is spread evenly" was true of every month in isolation and could be false of the year — the same person could take the unpopular end every month with nothing in the objective noticing, as long as each month was internally balanced. What is carried is a **deviation from the average of the people being scheduled**, not a raw count: raw totals make someone who joined mid-period look as though they had never worked a weekend, so they are chosen for the next ones until they catch up, which is a penalty for having been hired later. The values are normalised to be non-negative, which changes nothing the solver optimises because `max − min` is invariant under adding the same constant to every load, and spares both engines a negative lower bound on every load variable. Ninety days is a chosen number, not a derived one: long enough that a heavy month is compensated within the window, short enough to be explainable to the person it affects. A calendar quarter was rejected because it resets — whoever took every weekend in March would be level again on 1 April. This exact set is the canonical
definition in `constraintValidator.ts`, and the Python CP-SAT engine enforces the
same set as hard constraints — the parity suite keeps the two aligned.

**How to add a new constraint**:

1. Add the rule to `constraintValidator.ts` first — it is the single source of truth.
2. Add any needed state tracking in `generateGreedySchedule` (e.g. a new `Map`) and the check to `evaluateCandidate(emp, ctx)` — the method is pure; no DB calls allowed there.
3. Add the matching hard constraint to `schedule_optimizer.py`.
4. Extend the fixtures/assertions in `backend/src/__tests__/optimizer.parity.test.ts` so both engines are verified against the new rule.

**Known limitations**:
- No backtracking: a locally greedy choice can block a later shift from being staffed. The CP-SAT path solves this globally, which is why `or-tools` is the default and greedy is a signalled draft/fallback.
- Employee ordering within the candidate list is deterministic (input order) and not optimized for fairness. Workload balancing is a soft objective in **CP-SAT only**: the greedy has no global view of the schedule when it places each assignment, so it cannot balance without backtracking, and this difference is signalled rather than hidden — a greedy result carries `engine: "greedy"`. (This line previously made the same claim while no such objective existed at all; it does now.)

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
- **Hard constraints** — the full canonical set (see `constraintValidator.ts`): `max_staff` as a ceiling, no double-booking (absolute time), minimum rest, declared availability, required skills, daily-hours cap, rolling 7-day weekly-hours cap, and maximum consecutive days — each also charging the employee's `existing_assignments` on other schedules. These match the greedy engine exactly (enforced by the parity suite); minimum rest and consecutive-days used to be soft objective penalties and are now hard.
- **`min_staff` is a target, not a hard constraint** — *overconstrained planning*. It used to be hard, which made the behaviour backwards: when the available staff could not cover even one shift, CP-SAT proved the whole model INFEASIBLE and the run degraded to greedy. The harder the problem, the worse the engine you got — and understaffing is the normal condition, not an exceptional one. A shortfall variable per shift is minimised instead, so `INFEASIBLE` now means what it should: a genuine conflict among rest, skill, availability or hours rules. The result reports `understaffedShifts` and `totalMissingStaff`, so a partial schedule is visibly partial.
- **Objective — two lexicographic levels, not a weighted sum.** MEDIUM is coverage shortfall; SOFT is employee preferences, workload fairness and a surplus-staffing charge. Priority expressed as a ratio between weights is not a guarantee: at the previous coverage-100 / preferences-55, two satisfied preferences outweighed one covered seat, and whether coverage dominated depended on how many preference terms a dataset happened to produce. CP-SAT optimises one scalar, so the ordering is emulated by scaling MEDIUM above a bound **summed from the soft coefficients that actually enter the model** — not derived from the weight, which is what made the first attempt wrong (preferences are ±10, not ±1, so soft outranked medium and the solver left shifts empty to satisfy an "avoid"). `optimizer.parity.test.ts` asserts the property directly.
- **Pairing: who may share a shift (hard).** `apart` — two people must not be on the same shift (conflict separation, or a control requirement). `requires` — one may only work a shift the other also works, for a trainee who must not work unsupervised. **`requires` is directional on purpose**: "they must work together" reads as symmetric and almost never is, since the supervisor works perfectly well alone, and a symmetric rule would forbid them from taking any shift the trainee is not on. Symmetric pairing is two rows. **Both can be hard only because coverage became a shortfall** — before that, "the trainee may only work with their supervisor" could make a period infeasible; now an unsatisfiable pairing leaves that person unassigned and the shift short, which is reported. Unlike skills and availability these cannot be folded into eligibility, because whether a pairing is legal depends on who *else* is assigned. The greedy enforces them but places a dependent only if the person they depend on is **already** on the shift: with no lookahead it may leave the shift short where CP-SAT would pair them — conservative, never illegal, and the same class of limitation as its inability to balance workload. Rules are managed through `/api/employee-pairings` (list, create, edit the reason, delete) behind `employee.manage` — see the decisions table for why that permission and not `employee.read`.
- **"At least N people at level L" per shift (medium).** The rule regulated settings actually run on — one senior per night shift, one first-aider per site. **Not the same as the proficiency filter**: that says *everyone* assigned must be at least this good, while this is a **count** over the shift, and it cannot be expressed by narrowing eligibility since requiring everyone to be senior would make most rotas unstaffable. They are independent requirements over the same shift, hence separate columns. Modelled as a minimised **shortfall at MEDIUM**, beside coverage — made hard, a period with no available senior would produce no schedule at all, which is exactly the failure that made `min_staff` a target. A shift can be fully staffed and still have nobody qualified: a different problem with a different fix, so it is reported separately. An **unrecorded** proficiency does not count toward the requirement — the reverse of the eligibility filter, where unknown means "no reason to exclude"; here it would assert a competence nobody recorded, on the one rule that exists to guarantee it.
- **Skill proficiency is enforced, not just stored (hard).** `user_skills.proficiency_level` (1–5) has existed since the initial schema and is settable through the API, but the optimizer received skills as bare names — so someone at level 1 and someone at level 5 were interchangeable to it, and the data was captured, displayed, then discarded at exactly the point it would matter. `shift_skills.min_proficiency` now says what a shift needs, and both engines compare. **Absent means unconstrained** on the shift and **unknown** on the employee, so a problem carrying no levels behaves exactly as before — without those defaults, adding the field would have silently re-qualified everyone. Note this expresses "*everyone* assigned must be at least this good", a predicate over each assignment; "*at least one* senior on this shift" is a counting constraint over the shift and a different mechanism, tracked separately.
- **Unsocial-hours equity (soft), one mechanism for two categories.** The hours fairness balances *how many* hours; these balance *which* hours. Weekend equity and night equity ask the same question of different shifts — who loses which days — so they are one contributor parameterised by a shift predicate rather than two copies. The unit is **days**, not hours: a four-hour Sunday shift costs the day either way, two matching shifts on one date cost one day, and work held on other schedules counts because the day is gone regardless of which schedule took it. Both definitions are configurable (`constraints.weekend_days`, `constraints.night_window`), since what counts as unsocial is sector-specific. Night is decided by **overlap** with the window, not by start time: 22:00–06:00 and 02:00–10:00 are both night work but only the first starts late — and the occurrence that catches the second is the window that began the *previous* day.
- **Minimum consecutive days off (soft).** `max_consecutive_days` caps how long someone works without a break and says nothing about the break: five-on, one-off, five-on, one-off satisfies it completely while the person never gets two days together — the difference between "not overworked" and "rested". A contract may ask for a run of N free days **at least once per rolling 7-day window**. That quantifier is deliberate: requiring *every* rest run to reach N would forbid a single day off outright, and requiring one per schedule *period* is meaningless over a month; one per rolling week is the formulation working-time regulations use. Soft rather than hard, because a hard rule makes an understaffed period unsolvable — the same reasoning that made coverage a target. The greedy engine does not optimise it (no global view, as with fairness), so `restShortfalls` in `constraintValidator.ts` measures both engines and neither is required to reach zero.
- **Adjacency to an approved absence (soft, reported).** Working the day immediately before or after an employee's own approved time off erodes the point of the absence, even though neither shift falls on the covered date itself — a different question from `unavailability`, which only rejects a shift ON the covered date. Soft for the same reason coverage and rest blocks are: forbidding it outright can make an already-tight period infeasible. `timeOffAdjacencies` in `constraintValidator.ts` reads the same `unavailable_dates` the hard check already loads, so it needs no new input; it is a pure checker over a finished solution, not an objective term, and neither engine is required to drive it to zero.
- **Minimum total days off per period (soft, reported).** Distinct from minimum consecutive days off above: that asks for one rest *block* per rolling week; this asks for a total *count* across the whole period, however distributed — a contract can guarantee a weekend every week while staying silent on whether four weeks of exactly one rest day each add up to enough time off overall. The contract stores a **rate** per 7-day reference period (`employment_contracts.min_days_off_per_period`), not an absolute count, because a contract has no fixed schedule length to be absolute about; `daysOffShortfalls` in `constraintValidator.ts` prorates it against whatever period the schedule actually spans (`ceil(rate × periodDays / 7)`). Soft for the same reason as every other item in this family: a hard rule makes an understaffed period unsolvable.
- **Start-time spread within a period (soft, reported).** Bounds how much an individual employee's own shift start times bounce around within a period — someone whose start time moves between 06:00, 14:00 and 22:00 across one period has their daily rhythm reshuffled week to week even though every individual shift is otherwise legal. Unlike weekend/night equity, this measures variation WITHIN one employee's own shifts, not a gap BETWEEN employees, so there is no team-wide number to report — `startTimeSpreads` in `constraintValidator.ts` reports one `max − min` figure per employee, in minutes, with no invented pass/fail threshold: there is no working-time-regulation precedent for a cutoff here the way there was for a weekly rest block, so the raw measurement is left for whoever reads it to judge.
- **Night-then-morning turnaround (soft, reported).** The general minimum-rest hard constraint is calibrated for an ordinary turnaround, not the fatigue a night shift leaves behind — a gap that clears the general figure can still be a recognised unsafe pattern: finish a night shift, come back a few hours later for an early morning one. `illegalTurnarounds` in `constraintValidator.ts` checks the same pair of adjacent shifts `min-rest` already looks at, against a separate, normally higher, threshold (`constraints.min_hours_after_night_shift`, default 11h) that only applies when the earlier shift was night work. Only the IMMEDIATELY next shift is examined — the pattern this exists to catch is about adjacency, not general workload. Soft for the same reason as every other item in this family: made hard, an already-tight rota with one person able to cover the gap becomes unsolvable. Rotating shift TYPES across periods so nobody holds nights indefinitely is a related but separate concern, tracked separately since it needs carried history across periods rather than a same-period check.
- **Workload fairness (soft).** Minimises the spread between the busiest and least-busy employee, measured in minutes so half-hour shifts are not invisible. Squared deviation from the mean is the textbook form and is what Timefold uses, but CP-SAT is a linear/integer solver, so it would need a piecewise-linear approximation whose parameters are harder to justify than the thing they approximate; the spread is exactly expressible in two auxiliary variables. Its known weakness — indifference to the middle of the distribution — is stated rather than left to be discovered. The greedy engine cannot balance at all (no global view), which is why the engine is always reported.
- **Surplus staffing is charged (soft), at a derived weight.** Fairness rewards over-staffing *indirectly*, because adding people flattens the distribution: when the term first landed, a 3-shift / 4-employee fixture went from 6 assignments to 8, buying an even split with two extra shifts of wages. One extra assignment can improve the spread by at most the longest shift's duration, so surplus is charged strictly more than that — over-staffing is never worth a fairness gain, while remaining available when coverage needs it, since shortfall sits at MEDIUM and outranks both.
- **A published assignment is a commitment, not a proposal.** `generate` used to solve from scratch every time, so re-running it on a published schedule could legally reshuffle everyone — wrong in a way no scheduling metric can see, since a published assignment is something a person has arranged their life around. **Publishing is what writes the pin**, in the same transaction as the status change — "published" and "committed" are one fact, and a crash between them would leave a live schedule the optimizer is free to reshuffle. Only `pending` and `confirmed` assignments are pinned: nobody is relying on work they declined. An assignment added to an *already published* schedule is pinned on creation, with the schedule's status read inside the `INSERT` rather than fetched first, so a schedule published between the read and the write cannot produce an unpinned commitment. Assignments on a published schedule carry `is_pinned`, enter the model as commitments, and are rewarded at **their own objective level between coverage and the soft terms**: above preferences and fairness, so a commitment is never broken to satisfy a preference however many accumulate; below coverage, so it *is* broken rather than leave a shift unstaffed. Pinning is a stored column, not inferred from schedule status, because a planner deliberately unpinning one person is the normal way to use this and an inferred rule leaves nowhere to record it. **The diff is the deliverable**: every run reports `keptCommitments` and `brokenCommitments`, and a broken one is logged with the affected users named — reporting both halves matters because an empty broken list on its own is indistinguishable from a diff that was never computed. Re-solving with unchanged inputs returns zero changes, which the previous implementation could not do at all.
- **Re-solving a published schedule PROPOSES; approving is what applies it.** `generate` used to write its result and report the diff afterwards, so a planner learned that fourteen people had moved by reading the response — the change to their commitments had already happened before anyone could judge whether it was worth making. On a published schedule the run now writes nothing: it records the whole solved plan in `schedule_replan_proposals` and returns `status: 'PROPOSED'` with a `proposalId`, and `POST /schedules/:id/replan-proposals/:proposalId/apply` (or `/reject`) decides it. Drafts keep the immediate path — nobody has been told anything about a draft. **Applying is what makes the diff true**: the old persist path was `INSERT IGNORE` and nothing else, so assignments the optimizer dropped survived the run and `brokenCommitments` named people who were still assigned in every read path the app has; a schedule solved twice was the union of both solves. Applying removes what the approved plan leaves out and writes what it adds, pinned, in one transaction. **Staleness is handled by verify-at-apply**: the stored plan is checked against live data (the shifts still exist and still belong to this schedule, the people are still active) and refused *whole* if anything moved, because a plan that is 95% still valid is not 95% approved. Re-solving at approval time was rejected — a solver is not required to return the same optimum twice, so an approved diff could legitimately fail to reproduce and the planner would have approved a decision the system then declines to make. A second re-solve **supersedes** any undecided proposal rather than leaving two. Deciding is gated on `schedule.publish`, deliberately stronger than `schedule.optimize`: applying a plan changes commitments people were already told about, and gating it on the weaker permission would let anyone who can press "generate" rearrange a live schedule. **Everyone whose commitment the applied plan breaks is notified inside the same transaction** — the removal and the message commit together, so nobody is left unassigned and uninformed, which is what the outbox exists to rule out. One message per person listing every shift they lost, not one per shift: a re-solve that moves forty people can take several from the same one, and forty separate emails bury the fact that their week changed. Only *pinned* losses are announced — an unpinned assignment on a published schedule is one nobody was told about, and announcing it would claim a shift was taken away that the person never knew they had. One audit row per broken commitment, attributed to the **approver**: the optimizer produced the plan but a person decided to apply it, and recording a machine actor would now be the synthetic attribution.
- **`INFEASIBLE` now has exactly one cause, and it is explained.** Measured rather than assumed: with coverage a minimised shortfall, assigning nothing satisfies every remaining hard rule, and skills and availability produce no constraints at all (an ineligible pairing is never given a variable). The only thing left that can make a problem unsolvable is an employee's `existing_assignments` — work on OTHER schedules, fixed facts here — already breaching a daily, weekly or consecutive-day limit. `findOverCommitments` in `constraintValidator.ts` detects that deterministically before solving, names the employee, the rule and the numbers, and the engine EXCLUDES them rather than failing the run: they cannot legally take more work anyway, so removing them changes no legal outcome and everyone else still gets a schedule. Reported on every run through `overCommittedEmployees`, not only on failures. An unsat core was considered and rejected — assumption literals would disable parts of CP-SAT's presolve on every solve to explain a case decidable in one pass over data already in hand.
- **Nothing rewards staffing between `min_staff` and `max_staff`.** The objective used to add a flat reward per assignment, so with coverage hard-bounded the solver always filled to `max_staff`: more people was always worth more and nothing charged for them. `min_staff` therefore never acted as a target, and the greedy engine — which fills only to `min_staff` — produced systematically different staffing from the same input, invisibly, since the parity suite checks constraint validity and not staffing level.
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

**Geofencing (#308)**: `clock-in` optionally carries `latitude`/`longitude`. Enforcement is per-caller and opt-in per department — `GeofenceService.isCallerWithinAllowedGeofence` resolves the departments the caller belongs to; if none of them has an active `department_geofences` row, geofencing has no effect and the coordinates (if any) are stored but not checked. Once at least one of the caller's departments has an active fence, the punch is rejected (a `ValidationError`, and an `attendance.clock_in_rejected_geofence` audit entry) unless the point falls inside at least one of them — a caller in several departments is satisfied by any one fence, so a multi-site employee isn't blocked by a department they aren't physically at. Fences are polygons (`{lat, lng}[]`, at least 3 points), checked with a plain ray-casting point-in-polygon test (`backend/src/utils/geo.ts`) rather than a spatial database feature or a mapping library — deliberately, per this project's usual preference for owned code over a new dependency where the algorithm is small.

```
GET    /api/departments/:id/geofences               list a department's fences
POST   /api/departments/:id/geofences                create a fence
PUT    /api/departments/:id/geofences/:geofenceId    update a fence
DELETE /api/departments/:id/geofences/:geofenceId    delete a fence
```

Same access rule as every other department sub-resource: `settings.manage` reaches any department, `department.manage` only the caller's own. Configured from Settings → Geofences (admin only); the editor is a plain coordinate-list form, not a map — see that component's header for why.

**Kiosk clock-in (#309)**: a shared tablet parked at a physical location, punching by employee id rather than a user login — there is deliberately no signed-in user at a kiosk. Authentication is a per-device token (`X-Kiosk-Token` header), not a JWT: `KioskService.authenticate` hashes the header with SHA-256 and looks up `kiosk_devices` by the hash, the same token-hashing pattern `RefreshTokenService` uses for refresh tokens. The raw token exists in plaintext only once, in the create response — only its hash is ever stored, so it cannot be shown again if lost; the admin UI displays it once and the device operator must copy it into the tablet immediately.

```
GET    /api/departments/:id/kiosks              list a department's kiosk devices
POST   /api/departments/:id/kiosks               register a device, returns its one-time raw token
DELETE /api/departments/:id/kiosks/:kioskId      revoke a device
POST   /api/attendance/kiosk/punch                punch (toggle) by employee id — kiosk-token auth, no user session
```

`POST /kiosk/punch` is mounted ahead of `authenticate` in `routes/attendance.ts` so it never runs through user auth: `authenticateKiosk` (`middleware/kioskAuth.ts`) is the only gate. It resolves the employee id to a user scoped to the device's own department (`KioskService.resolveEmployee`, an active `users` row joined to `user_departments`), then calls `AttendanceService.punch(userId)`, which toggles — clocks in if the user has no open record, clocks out the open one otherwise — so the same button on the tablet serves both directions without the employee having to remember their current state.

Device management uses the same `canManageDepartment` access rule as geofences. Configured from Settings → Kiosk Devices (admin only). The public punch page lives at `/kiosk` — outside the authenticated app shell, since a device browser has no user session — and stores its device token in `localStorage`, scoped to that browser/tablet rather than to any person.

---

## 7b. Business policies

Configurable rules (`policies` table, `PolicyService`/`PolicyValidator`) scoped to `global`, an org unit, a schedule, or a shift template. `policyKey` is a free-text field — the catalog is not a fixed enum — but `PolicyValidator.evaluate()` only assigns real blocking behavior to specific keys:

| `policyKey` | Enforcement |
|---|---|
| `manual_assignment_locked` | **Enforced.** Blocks `POST /api/assignments` outright unless the target has an approved `PolicyExceptionRequest`. |
| `min_rest_hours`, `max_hours_week`, `max_consecutive_days`, `staffing_min`, `skill_required` | **Not enforced by the policy engine.** These keys are accepted by `POST /api/policies` and stored, but `PolicyValidator` treats them as informational only — creating one does not block anything. The equivalent working-time limits (rest hours, weekly hours, consecutive days) **are** enforced separately and unconditionally by `ComplianceEngine.evaluateAssignmentCompliance` (§6, driven by the user's effective-dated `employment_contracts` limit first, then `user_preferences`, then `system_settings` — not by the `policies` table), so assignments are still protected — but through a different, non-configurable-per-scope mechanism. `staffing_min` and `skill_required` have no equivalent enforcement anywhere today. |

Implication: an administrator who creates a `max_hours_week` (or `staffing_min` / `skill_required`) policy through the Policies UI gets no error, but the policy has no effect — this is a known gap, not yet surfaced in the UI. Extending `PolicyValidator.evaluate()` to cover the remaining keys (or wiring `ComplianceEngine`'s thresholds to read from `policies` instead of `system_settings`) is open work; `manual_assignment_locked` is the only key to treat as load-bearing today.

---

## 7c. Notifications

In-app notifications (`notifications` table) are the base layer — `NotificationService.notify()` writes one on any event a service decides is worth surfacing. Two delivery channels are transactional-outbox extensions on top of that same write, both optional and both gated on their own configuration so a deployment with neither accumulates no dead rows:

- **Email**: `email_outbox` — see `MailerService`/`OutboxWorker`, gated by `isEmailConfigured()`.
- **Web Push** (#310): `push_subscriptions` (per-device registration) + `push_outbox` (delivery queue) — `PushService`/`PushWorker`, gated by `isPushConfigured()` (`VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` both set; generate a pair with `npx web-push generate-vapid-keys`).

`NotificationService.notifyWithin()` is the single seam: inside the SAME transaction as the notification row, it inserts one `email_outbox` row (if email is configured and the recipient has an address) and one `push_outbox` row **per active subscription** the recipient has registered (a person with push on two devices gets it on both). Either channel's write failing rolls back the whole notification — a notification that exists is a notification whose delivery intents are durably recorded, never a phantom promise.

```
GET    /api/notifications/push/public-key   VAPID public key + `enabled` flag (always 200, never 404 — an
                                              unconfigured deployment answers `enabled: false` so the SPA can
                                              hide the toggle rather than surface a broken feature)
POST   /api/notifications/push/subscribe    register/reactivate a device's push subscription
DELETE /api/notifications/push/subscribe    deactivate a device's push subscription
```

**Delivery**: `PushWorker` polls `push_outbox` the same way `OutboxWorker` polls `email_outbox` (interval poll, `FOR UPDATE SKIP LOCKED` batch claim so multiple backend replicas coexist safely, retries up to 5 attempts). The one real difference: a send failing with HTTP 404/410 means the push service has permanently discarded the subscription (uninstalled, permission revoked, endpoint rotated) — that subscription is deactivated immediately rather than retried, since retrying a permanently-gone endpoint would just burn attempts until the generic cap kicked in anyway.

**Frontend**: `usePushNotifications()` (`frontend/src/hooks/usePushNotifications.ts`) resolves subscription state by asking the browser's `PushManager.getSubscription()` first — the server only knows which endpoints it has been told about, and a browser can silently drop a subscription without ever telling it, so the browser is the source of truth for "is this device currently subscribed," not the backend. The toggle lives in Settings → Personal (`WebPushToggle.tsx`), deliberately separate from the pre-existing "Push Notifications" preference checkbox: that checkbox is a stored preference ("do I want push at all"), this is the per-device subscription mechanic ("has this specific browser completed the one-time subscribe step") — the two can legitimately disagree. `public/service-worker.js` handles the `push` event (shows the notification the payload describes) and `notificationclick` (focuses an already-open tab rather than piling up duplicates, falling back to opening one).

---

## 7d. Outbound webhooks

An organization (scoped by `users.organization_name`, this app's existing soft-multi-tenant tag) can register HTTP endpoints that receive a signed POST when a `WebhookEventType` fires: `schedule.published`, `assignment.confirmed`, `approval.decided`.

```
GET    /api/webhooks                    list the caller's org's subscriptions
POST   /api/webhooks                    create — { url, eventTypes[] } — returns the raw secret ONCE
GET    /api/webhooks/:id                read one (rejects cross-org access)
PUT    /api/webhooks/:id                update url / eventTypes / isActive
DELETE /api/webhooks/:id                delete
GET    /api/webhooks/:id/deliveries     delivery log (status, attempts, response_status, last_error), capped [1, 200]
```

All routes require `settings.manage` and are scoped to the caller's own `organizationName`; a subscription belonging to another organization 404s rather than 403s, so its existence isn't leaked.

**Same transactional-outbox shape as email/push**: `WebhookService.dispatch(organizationName, eventType, payload, conn?)` enqueues one `webhook_deliveries` row per active matching subscription — the optional `conn` lets a call site enqueue inside its own transaction, the same seam `NotificationService.notifyWithin` offers. Call sites are best-effort and fire-and-forget (`.catch(...)`, not awaited): `ScheduleService.publishSchedule`, `AssignmentService.confirmAssignment`, and `ApprovalEngineService.decidePendingApproval` (the last one takes `organizationName` as an explicit optional parameter supplied by its callers — see below — rather than looking it up itself, since it is a shared method used by four unrelated entity services and an unconditional lookup query there would run on every call regardless of whether webhooks are in play).

**`organizationName` threading**: `ApprovalEngineService.decidePendingApproval` is invoked by `TimeOffService`, `ShiftSwapService`, `EmployeeLoanService`, `PolicyExceptionService`, and `ChangeRequestService`, all of which now accept `organizationName` as a trailing optional parameter (default `null`, meaning "skip dispatch") and forward it unchanged. Routes supply it from `req.user.organizationName` — already resolved by `authenticate` — so no extra query is needed at the HTTP boundary either.

**Signing and delivery**: `signPayload(secret, rawBody)` produces `X-Webhook-Signature: sha256=<hex>` via HMAC-SHA256, so a subscriber can verify the request came from this deployment. The secret is stored in **plaintext** in `webhook_subscriptions` — deliberately, unlike the kiosk/refresh-token pattern: `WebhookWorker` must reproduce the same signature the subscriber verifies, which needs the raw secret at delivery time, not a one-way hash of it (the standard shape for webhook secrets, e.g. Stripe, GitHub). `WebhookWorker` polls `webhook_deliveries` the same way `OutboxWorker`/`PushWorker` poll their tables (interval poll, `FOR UPDATE SKIP LOCKED` batch claim, unref'd timer), but backs off exponentially on failure instead of retrying every poll: `next_attempt_at` is pushed forward by `min(2^attempts, 60)` minutes, since an endpoint that's down tends to stay down, up to `MAX_ATTEMPTS = 6` before a delivery is marked `failed`. Unlike email/push, there is no "is this configured" gate — a delivery row only exists because `dispatch()` already found a matching active subscription, so the worker always polls.

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

Every `pending_approvals` row belongs to exactly one entity — `change_request_id`, `time_off_request_id`, `employee_loan_id`, `shift_swap_request_id`, or `policy_exception_id` (a `CHECK` constraint enforces exactly one is set). Time-off, employee-loan, shift-swap, and policy-exception approve/reject now route through the same `ApprovalEngineService.decidePendingApproval` as change requests, instead of each having its own bespoke authorization check. `policy_exception_id` was the last holdout: `PolicyExceptionService` previously routed exclusively through the legacy `approval_matrix`/`ApprovalMatrixService` — the entire approval mechanism for that one request type, not the narrow creation-time auto-approve fast path `EmployeeLoanService` and `PolicyExceptionService` both still make of it — so it alone lacked the ordered multi-step routing, structure delegation, and responsibility rules the other four already had.

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

`approve`/`reject` on `/api/pending-approvals/:id/...` are entity-agnostic: they inspect which of the five entity FKs is set on the `pending_approvals` row and dispatch to the matching service (`ChangeRequestService`, `TimeOffService`, `EmployeeLoanService`, `ShiftSwapService` — note `ShiftSwapService.decline`, not `.reject` — or `PolicyExceptionService`), via the shared `dispatchPendingApprovalDecision` helper (`src/services/PendingApprovalDispatch.ts`).

---

## 9d. Shift swaps

```
GET    /api/shift-swap                    list requests, scoped to the caller unless shiftswap.approve (authenticated)
POST   /api/shift-swap                    propose a swap (authenticated)
GET    /api/shift-swap/candidates         eligible target assignments for one of the caller's own assignments (authenticated)
POST   /api/shift-swap/:id/respond        the target accepts or declines (identity-gated: target only)
POST   /api/shift-swap/:id/approve        manager approves (shiftswap.approve)
POST   /api/shift-swap/:id/decline        manager declines (shiftswap.approve)
POST   /api/shift-swap/:id/cancel         requester withdraws (own request only)
GET    /api/shift-swap/open               open shift board, scoped to units the caller may see (authenticated)
POST   /api/shift-swap/open               post one of the caller's own assignments as an open offer (authenticated)
POST   /api/shift-swap/open/:id/claim     claim an open offer by offering an assignment back (authenticated)
POST   /api/shift-swap/open/:id/cancel    withdraw the caller's own open offer (own offer only)
```

**Two gates, not one**: `pending_target → pending → approved | declined | cancelled`, with `declined` reachable from either gate. `pending_target` is the state before the target has responded — only they can accept or decline it, gated on identity (`respondAsTarget`) rather than a permission code, since agreeing to swap your own shift isn't a manager privilege. A target decline ends the request immediately, recording `declinedBy: 'target'`; there is nothing left for a manager to decide. Accepting moves the request to `pending`, which now means "target accepted, awaiting manager" rather than the request's original "just submitted" meaning — only then is the first `pending_approvals` row created (via `ApprovalEngineService`, change type `ShiftSwap.Request`) and `approve`/`decline` become available, recording `declinedBy: 'manager'` on a manager refusal. `cancel` is available to the requester at either gate.

`ShiftSwapService.create()` runs an approver dry run up front so a request that can never be routed fails immediately rather than stranding the target with something to accept that can never be approved; the real approval-step resolution happens again in `respondAsTarget`'s accept path, since the requester's org-unit membership (or the workflow itself) may have changed between request and response. If that later resolution fails, the swap reverts to `pending_target` rather than being left stuck in `pending` with no pending-approval row and nobody able to act on it — the target can simply retry their acceptance once the underlying issue (e.g. a missing org-unit manager) is fixed.

**Open shift board.** A targeted swap requires already knowing who to ask; `shift_swap_offers` adds a discovery layer on top of the same machinery, not a second approval path. `ShiftSwapService.createOpenOffer` posts one of the caller's own live (`pending`/`confirmed`), not-yet-past assignments as `open`, refusing a second concurrent open offer on the same assignment. `listOpenOffers` scopes the board to the org units the caller may see — the same scope `SwapCandidateService` uses for its own candidate search — enriched with the offered shift's details for display; `mine=1` shows the caller's own posted offers instead of excluding them. Claiming (`claimOpenOffer`) pairs the offer with one of the claimer's own assignments and inserts the resulting `shift_swap_requests` row directly at `pending`, skipping `pending_target`: offering a specific assignment back *is* the claimer's consent, so unlike the targeted flow there is no separate accept step. The offer owner is the row's `requesterUserId` and the approval workflow is resolved from their org unit, matching `create()`'s convention that the requester is whoever's ask a swap traces back to. The claim runs inside a transaction that re-locks the offer row before inserting, so two people racing to claim the same offer cannot both succeed; if approver resolution changes between the pre-transaction dry run and the workflow attachment that follows it, the whole claim is undone — the swap request is cancelled and the offer returns to `open` — rather than leaving a `pending` swap with no pending-approval row and nobody able to act on it.

---

## 10. Audit trail

Every sensitive mutation writes an `audit_logs` row via `AuditLogService.write(input)`.

Audited actions: `user.create`, `user.update`, `user.delete`, `role.grant`, `role.revoke`, `schedule.publish`, `schedule.archive`, `policy.create`, `policy.update`, `policy.delete`, `org_unit.create`, `org_unit.update`, `org_unit.delete`, `delegation.grant`, `delegation.revoke`.

`before_snapshot` and `after_snapshot` (JSON) are captured for role grants and policy changes.

`GET /api/audit-logs` supports filtering by `userId`, `action`, `entityType`, `entityId`, `fromDate`, `toDate`, `limit`, `offset`. No `DELETE` endpoint exists.

`GET /api/audit-logs/export` returns every matching entry (same filters, no `limit`/`offset` paging). Supported formats: `?format=csv` (returns `text/csv` with `Content-Disposition: attachment`) and `?format=json` (default). Requires `audit.read` permission.

The export is capped at **100,000 entries**. Beyond that it returns `400` and asks you to narrow the range rather than returning a partial file: an audit export is a compliance artefact, so a truncated one that looks complete would be worse than an error. Use `fromDate`/`toDate` to scope the export to a period.

**Person history — `GET /org/history{/:userId}?asOf=YYYY-MM-DD`** (`PersonHistoryService`): an "as of a past date, what was true" projection for one person — roles held, org units belonged to (with which was primary), and org units headed — reconstructed entirely from `audit_logs` rather than a dedicated temporal schema, since every fact involved already produces a row when it changes. Roles and membership replay forward from empty (every grant/join is INSERT-shaped, so every one that has ever existed produced an event); headship anchors on the CURRENT `org_units.manager_user_id` and walks backward through that unit's own `org_unit.update` history, because a headship set at unit *creation* (not audited) would otherwise be invisible to a forward replay. `asOf` is whole-day granularity — treated as through the end of that calendar day. Same visibility rule as `/org/authority/{userId}`: your own history needs only authentication, someone else's requires `org_unit.read`. Org-unit membership events key `entity_id` on the org unit, not the subject — the subject id lives in the JSON payload, so that one query is an unindexed-but-bounded scan (see the service's own header for the sizing call and the documented next step, a generated column, if it stops being fine). A fact written before auditing existed has no audit row and cannot appear in a past snapshot — the same limitation `/roles/users/{userId}/timeline`'s `hasHistory` flag documents for the current-state view.

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
   curl -fsS http://localhost:3001/api/v1/health
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

**Set `TRUST_PROXY_HOPS=1` whenever this overlay is in use.** Express does not
trust `X-Forwarded-For`/`X-Forwarded-Proto` by default, so without it every
request's `req.ip` resolves to the load balancer's own address rather than the
real client — collapsing IP-keyed rate limiting (including the login
brute-force limiter) into one shared bucket across every caller, and making
audit-log IPs useless. Left at its default of `0` for any directly-exposed
instance (dev, or a single, unscaled backend): with no proxy actually in
front, trusting the hop would let a client set its own `X-Forwarded-For` and
spoof its IP to dodge rate limiting.

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

### MySQL read-replica routing for analytical reads

Distinct from the backend-instance replicas above: this is a **MySQL** read
replica, optional, for offloading the heaviest analytical SELECTs
(`ReportsService`, `CalendarService`'s feed generation, `AuditLogService`'s
listing/export) from the primary. Configured with `DB_REPLICA_HOST` (see
`.env.example`); every other `DB_REPLICA_*` variable falls back to its
primary `DB_*` counterpart when unset, since a replica is normally the same
schema/user under a different host.

**The pool-selection seam** (`config/database.ts`'s `createReadPool`) returns
the exact same pool object passed in — not a second pool pointed at the same
host — when `DB_REPLICA_HOST` is unset, so a single-instance deployment is
genuinely unaffected: no extra connection budget, nothing extra to close on
shutdown, and every read-replica-aware service falls back to querying the
primary through the identical pool instance it always has. `buildApp`'s
`readPool` option threads this pool into `createReportsRouter`,
`createCalendarRouter`, and `createAuditLogsRouter`, each of which pass it to
their service's constructor.

**Split at the service, not the route**: `ReportsService` is entirely
read-only and takes a single pool (the read one). `CalendarService` and
`AuditLogService` take two — a primary `pool` for their few writes (calendar
token create/revoke; the audit log's own `write()`) and a `readPool`
(defaulting to `pool`) for everything else. A replica lags the primary by
design, so routing a write through it would be a correctness bug, not just a
missed optimization — this is why the split is per-method inside the
service, not a blanket "route reads to X" at the transport layer.

`AuditLogService` instances constructed elsewhere in the codebase for
`write()`-only use (every other service's audit trail) are unaffected: they
still take a single `pool` argument, and `readPool` inside that instance
simply defaults to it, unused.

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
3. Add the route handler in `backend/src/routes/` as a plain `async` function (Express 5
   forwards a rejected handler's promise to `errorHandler` on its own — no wrapper needed),
   using `validateBody`/`validateParams` with the shared schema. Mount new routers in
   `backend/src/app.ts` under `/api/v1` — the legacy `/api` prefix redirects there rather
   than being a second mount (#319).
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

**react-router 6, with the open redirect closed at the call sites.** `react-router-dom ^6.30.4` carries two *moderate* advisories fixed only in 7.x, which is a major with a different route API. `npm audit` gates on *high*, so neither would ever fail the build — this is the record that they were examined rather than missed.

The **SSR hydration** advisory (`deserializeErrors`) needs server-side rendering; this app is a client-rendered Vite SPA and never calls the affected path.

The **open redirect via backslash** was reachable, which the grep found rather than the reasoning predicted. Two navigations take a target that did not come from the code: the post-login redirect replays the path an unauthenticated visitor originally asked for (`Login.tsx`, from router state set by `ProtectedRoute`), and a notification may carry a link (`Header.tsx`, currently never populated by any producer and with no endpoint to create one — unreachable today, one new producer from being live).

Both now go through `isInternalPath`, which requires a single leading slash and rejects anything a browser could read as an authority: `//host`, and `/\host` — the backslash being the bypass, and the case a reader would not think to reject. That guard is not a substitute for the upgrade, it is better than one: never navigating to an unvalidated external target is correct whichever router version is underneath, and it survives the migration.

**Re-check trigger:** raise the v7 upgrade when a route change is wanted for its own sake, when a *high* advisory lands on the 6.x line, or when the guard's assumptions stop holding — a new notification producer taking a link from user input would be the likely one.

## 13. Architectural decisions

| Decision | Rationale |
|---|---|
| A skill in use cannot be deleted, only retired | All three tables referencing a skill do so `ON DELETE CASCADE`, so deleting one would silently strip it from every employee holding it **and every shift requiring it** — and the second half changes what a legal schedule is without anyone having decided to change it. The refusal names the counts and points at deactivation, which keeps existing requirements meaningful and stops the skill being used for anything new. A skill nothing references can still be deleted outright, so a typo does not become permanent. The usage counts travel with every read rather than living behind a statistics call: they are what make the choice informed, and a caller who must ask for them separately will decide without them. Retiring is `PUT` with `isActive: false` rather than a dedicated verb — renaming and retiring are the same kind of act, and a `/deactivate` sitting beside `DELETE` would mean almost the same thing as it. |
| An approved absence is shown as "not yet recorded" until it is | Approving time off writes an `user_unavailability` row, and only a schedule generated afterwards actually leaves the person free — so approval alone has not told the optimizer anything. The time-off page reads `unavailabilityId` and says which of the two states a request is in, because that is the difference between "approved" and "you are actually off", and it is the one thing someone needs to be sure of before making plans. Pending requests say nothing about it: "not yet recorded" on an undecided request would read as a problem rather than as the ordinary state of not having been decided. The approver's queue is gated with `enabled` rather than hidden after fetching — a queue nobody may decide is a list of other people's private business. |
| "Today" is the local calendar day, never `toISOString()` | Six pages each wrote their own `new Date().toISOString().slice(0, 10)`, under four different names. That is the **UTC** date: in a positive-offset timezone the hours between local midnight and the offset are still yesterday in UTC, so at 00:30 in Rome it yields the 29th when the calendar says the 30th. Every default date range in the app started a day early during those hours — the kind of defect nobody reports, because it looks like the app simply chose a different default. `todayIso(offsetDays)` and `firstOfMonthIso()` in `utils/format.ts` read local calendar components, the browser half of the rule the backend documents on `DateUtils.fromMySQLDate`. They live beside the formatters because discoverability is what failed: people wrote their own rather than finding one. The same trap has a second half, in the helpers that FORMAT a date rather than produce one. `toLocalDateString` replaces four hand-written copies of `typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)`, whose second branch is the UTC day — latent, because dates cross the wire as strings and nothing yet constructs the `Date` the types permit. `formatDate` was the live one: `new Date("2026-04-25")` is UTC midnight by specification, so a locale formatter rendering in local time showed **24 April to every user west of Greenwich**, on every screen using the helper. A date-only string is therefore parsed as local midnight; a string carrying a time still names a real instant and is left alone, because which day a timestamp falls on genuinely depends on the reader. Neither defect was visible here or in CI, both being at or east of UTC — which is why the decisive test cases are written to fail in `America/New_York` and the suite was run across five zones. `Timeline.tsx` keeps `toISOString` deliberately and says so: its window is parsed as UTC midnight, so its day ticks must be labelled in the frame the bar geometry is measured in. |
| Report charts sit beside the tables, not instead of them | Each report gets a horizontal single-series bar chart above the table it already had. Horizontal because every label is a person or a department and those names are long — vertical columns would truncate or rotate them, which is the commonest way a chart stops being readable. No charting dependency: a single-series bar is a rectangle whose width is a fraction of the largest value, and a library would bring an axis model and a scale abstraction to do one division. One hue means colour carries no identity, so there is no legend — a box with one swatch restates the heading — and every bar is labelled, so nothing rests on colour. The hue is a sequential blue with a separate step per surface (`#2a78d6` light, `#3987e5` dark), each validated to clear 3:1 against its own surface rather than one colour dimmed by the theme. The fairness chart draws the **mean** as a reference line, because fairness is read as distance from it: a list of hours answers "how many", the line answers "compared with whom". The scale spans the reference as well as the tallest bar, so a mean above every bar stays on the chart instead of being clipped off the end. Empty reports draw no chart at all — an empty frame reads as a load that failed rather than as an absence of data. |
| A two-factor transition drops the cached auth context | `twoFactorEnabled` travels on the authenticated user, and that object is what the opt-in auth-context cache serialises — so with the cache enabled a stale entry would keep telling the client 2FA is off. Enabling would leave the settings page offering to set up what is already on; disabling is worse, since the page would ask for a code from a secret the account no longer has. Both transitions therefore call `invalidateAuthContext`, the same mechanism role changes already use. A refused attempt does not: nothing changed, and dropping a valid entry on every typo would turn a mistyped code into a burst of re-reads. Setup does not either — it stores a secret and leaves the flag false, so the cached user is still accurate. The cache is off by default, which is precisely why this needed a test: nothing in a default-configuration run would notice the omission, and the failure would appear only in the deployments that turned an optimisation on. |
| Two-factor recovery codes require an explicit acknowledgement | `enable` returns them once and they are not fetchable afterwards — that is what makes them a fallback rather than a second copy of the secret. A panel someone can navigate past without noticing is how an account is lost the first time a phone is replaced, so the step does not close until the person says they have kept them. The secret is shown as text alongside the `otpauth://` URI rather than only as a QR image: the URI is what a QR encodes, every authenticator accepts it pasted, and it covers the case a QR cannot — enrolling on the same device you are reading on. Enrolment stays two steps, because doing it in one would lock people out whenever the secret failed to reach their authenticator: setup stores a secret with the account still unprotected, and the page says so. `twoFactorEnabled` was added to the authenticated user for this — the flag, never the secret — because without it the enrolment screen could not tell whether 2FA was already on, which left the whole feature unusable despite every endpoint existing. |
| A field policy is configuration, and never the published contract | Organizations differ on what an employee record must contain, so `employee_field_policies` holds per-organization rules — required, visible-to, editable-by, and a small validation vocabulary — resolved with a named row overriding the global one, the same order module overrides use. **It is deliberately not a Zod schema.** The shared schemas are the published contract: they generate this API's OpenAPI document and its typed client, so what they say is true for everyone. One customer requiring a phone number is not a fact about the API, and folding it in would publish their rules as the contract and ship them in the generated client. The two therefore run in sequence and mean different things — Zod decides what the API accepts, the policy what THIS organization requires — and a policy refusal carries `FIELD_POLICY_VIOLATION` precisely because it is not a contract violation. **The governable fields are an allowlist in code**, which is the decision the whole feature turns on: a policy table able to name any column would let a configuration change — not a deploy, not a review — make `password_hash` a visible directory field or `totp_secret` editable. `email`, `firstName` and `lastName` are on the list for validation and visibility only; a policy is silently corrected to keep them required rather than refused, because the database and authentication require them and configuration that lies is worse than configuration that cannot express a thing. **Enforcement is write-only**: switching on "phone is required" must never make READING an existing incomplete record fail, or the first time anyone enabled it the whole directory would break — and on an update, a field the body does not mention is not being cleared, so requiring it there would lock the incomplete record out of being fixed. The validation vocabulary is closed (`minLength`, `maxLength`, `min`, `max`, `pattern`, `allowedValues`): an arbitrary-expression evaluator reading from a configuration table is a code-execution surface, and being administrator-writable does not make it less of one. `pattern` is length-capped and compiled at WRITE time, so a broken regex is refused where the person who typed it is still looking rather than silently blocking every write later. Writing a policy needs `settings.manage`, not `employee.manage` — every scheduling manager holds the latter, and deciding what a record must contain is a different act from filling one in — while reading is open to any authenticated caller, since a form must know the rules before someone fills it in or the only way to discover one is to break it. **The OpenAPI guard was found not to guard**: its `ROUTE_MOUNTS` table is hand-maintained and every check iterates it, so a whole new router file was invisible in both directions and generation reported success. `assertEveryRouterIsMounted` now fails on any `src/routes/*.ts` exporting a router factory that is missing from the table, with `openapi.ts` — which serves the document itself — the one recorded exclusion. |
| A field-policy form binds to raw draft strings, and parses only at submit | The admin panel for `employee_field_policies` (Settings → Employee Fields) originally bound each input straight to the `string | null` / `number | null` shape the API uses, normalising on every keystroke — trimming, splitting `allowedValues` on commas. That fights whoever is typing: trimming a trailing space on every change strips the space the instant it's typed, so "We need a number" collapsed to "Weneedanumber" as words ran together, and splitting `allowedValues` on every keystroke dropped a trailing comma the instant it appeared, since it produced one more empty segment `filter(Boolean)` removed. A controlled input's `value` has to be exactly what the last `onChange` reported or the DOM and React disagree about the cursor, and characters vanish — found by a test that typed a sentence with `userEvent.type` rather than setting a value in one call. The form now holds a `Draft` of untouched strings and normalises exactly once, at submit. The panel itself offers only the `governableCoreFields` the read endpoint returns, never a local copy of the allowlist — for the same reason the allowlist is enforced server-side at all: a stale frontend copy would show a field the server refuses, or hide one it accepts, and neither failure announces itself. Editing the global policy (no organization) and an organization's own override read as visibly different states, because the two rows mean different things and the failure mode of confusing them is silently changing every organization's fallback while believing you changed only your own. |
| An aggregate calendar feed resolves its scope on every fetch, never from the URL | A feed URL is a **credential that lives as long as the subscription**, so a scope decided when the link was made would keep publishing a ward after its owner stopped managing one. `GET /calendar/aggregate.ics` therefore carries only filters — departments, roles, people, and a range — and re-reads the token owner's permissions and role scope on each fetch, intersecting them with whatever was asked for. A caller cannot widen their reach through the filters, and the link narrows by itself when their authority does. A scope that resolves to an **empty array returns an empty calendar**, not an unfiltered one: falling through an empty-list check is the classic way a restriction becomes its opposite, and here it would publish the whole organization. It answers to `timeline.read` / `timeline.read_all` rather than a new pair, because it makes the same disclosure the timeline does — when a named colleague is at work — and two rules for one disclosure is how they come to disagree; that resolution now lives in `services/orgScope` and both callers share it, including the part that is easy to get wrong (`read_all` lifts the MEMBERSHIP bound and never the role scope). The range reaches **backward** as well as forward: the per-department feed started at `CURDATE()`, so a subscribed calendar had no memory and could not answer "who was on that Tuesday" once Tuesday had passed. Filters travel as comma-separated id lists validated by the schema, not split in a handler — `"3,abc".split(',').map(Number)` yields `[3, NaN]`, and NaN in a query silently matches nothing, so a filter quietly loses half its terms. The per-person filter is an `EXISTS` rather than a join condition: filtering the joined assignment rows would keep the shift and drop its other assignees, so the event would say "1 on duty" for a shift with four people on it. UIDs are prefixed `agg-` so a client subscribed to both this and a department feed does not treat the two events as one. Absences stay excluded, for the reason the timeline documents. |
| Self-service delegation is a permission code, and revoking never needs one | The service was already built for this and nobody had noticed: the route has never accepted a delegator other than the caller, and `createDelegation` refuses any code the delegator does not currently hold. So `delegation.manage` on that route was never a limit on **what** could be delegated — only on **who** was allowed to delegate at all. `delegation.self` says the same thing with the meaning it should have had, and grants nothing new. It is a permission code rather than a new policy table because the issue asked for "a flag per role or per org unit" and a code is already both: roles are configurable data, so granting it to a role IS the per-role flag, and a role grant carrying `scope_org_unit_id` IS the per-org-unit one — where a separate policy table would be a second authorization mechanism beside the one every other decision uses. `delegation.manage` survives rather than being replaced: a deployment wanting delegation to be an administered act keeps exactly that by granting `manage` and withholding `self`, so the two are alternatives rather than a hierarchy, and no ordinary role receives `self` by default because whether people may hand their authority to a colleague unsupervised is an organizational decision. **Revocation lost its permission gate entirely**, which fixes a real defect: `revokeDelegation` already refuses anyone who is not the delegator — stricter than any code could express — while the `delegation.manage` gate in front of it meant someone who created a delegation and later lost that permission could no longer revoke it, so a delegation they granted outlived their ability to withdraw it. Being able to take back authority you handed out must not depend on a permission you might lose. `PermissionRoute` and the sidebar now accept an array of codes meaning ANY of them, since this is the first route reachable by two that are alternatives. |
| A role timeline shows the events AND the current grants, because neither implies the other | Grants and revocations were already audited — actor, scope, expiry, justification and a `{userId, roleId, scopeOrgUnitId, expiresAt}` snapshot — and simply not consultable. `GET /roles/users/{userId}/timeline` and `GET /roles/{id}/timeline` return both halves together, deliberately: current grants live in `user_roles` and the events live in the audit log, and **neither is derivable from the other**. A grant made before auditing existed, or written by the seed, appears in `user_roles` with no event; a grant that reached its `expires_at` stops applying with no event at all, because nobody revoked it. A view built only from events would state that someone never received a role they demonstrably hold, and would show a lapsed grant as live. So every current grant carries `hasHistory`, and a lapsed one gets a synthesised `expired` entry flagged `derived: true` — inferred rather than recorded, and a reader who wants only what was actually logged can tell them apart. `truncated` says when the cap was hit, so a window is never presented as the whole story. A revocation's payload is in `before_snapshot` and a grant's in `after_snapshot`; reading only one is how half a timeline comes back with a null role. Per user the query uses the `(entity_type, entity_id)` index the audit table already has; per role the id lives inside the JSON snapshot, which no index covers, so that one is a bounded scan over the indexed `action` filter narrowed by `since` — stated in the header rather than left to be discovered, because an unbounded JSON scan over a table that only grows is fine for a year and then is not. Deliberately not waiting for the person-history model (#327): this history is already entirely in the audit log, and when that model lands this becomes one of its consumers rather than a blocker. |
| The authority over a person is shown by asking the deciders, not by describing them | The model was complete and correctly enforced, and completely invisible: the way to learn who would approve your time off was to file it and watch, and there was no way at all to learn that **nobody** would. `GET /org/authority/:userId?` answers three questions on one screen — who you depend on, who may grant or revoke your roles, and who would decide each step of every kind of request you can file. It resolves nothing itself: the manager chain comes from `OrgUnitService`, the approvers from `ApprovalEngineService`'s own `resolveAllApproversForStep`, the responsible parties from `ResponsibilityRuleService`. A panel that re-implemented any of that would be a second, unreviewed copy of the authority model whose failure mode is the worst kind — a screen that confidently names the wrong approver. A step that resolves to **nobody** is reported with `unresolved: true` and rendered as the loudest thing on the page, because an org unit with no manager or a rule pointing at an empty unit means requests of that kind cannot be decided at all, and this is the only place that is visible. Each name carries the scope that produced it: "Anna decides this" invites the question that "because she manages your unit" answers, and when the answer is wrong the scope names the rule to fix. Role administrators are labelled `responsibility_rule` or `permission` rather than merged — being made responsible for someone and being able to do it everywhere are different statements. Reading your own profile needs no permission, since knowing who decides your requests is what you need in order to use the system; another person's needs `org_unit.read`, the gate the rest of the tree carries. Building it surfaced a real divergence: `ChangeRequestService` resolved the subject's org unit as the **lowest** membership id while the approval engine read `is_primary`, so anyone belonging to two units had their change requests routed against a different unit than their time off, invisibly. Both now call `resolveSubjectContext`, which prefers `is_primary` and keeps the old ordering as the fallback for data predating the single-primary enforcement — so the change can only improve a case, never degrade one. |
| `process.exit` inside a try/catch always gets an explicit `return` after it | `startServer()`'s DB-connectivity check called `process.exit(1)` on failure with no `return` after it, relying on the process actually dying to stop execution. In production it does; in a test that `jest.spyOn(process, 'exit').mockImplementation(...)` specifically so it can assert the call without killing the runner, it does not — so the fallthrough went on to `buildApp()` and then to `startOutboxWorker(pool)` with the very pool that had just failed its connectivity check, arming a real 30-second `setInterval`. That timer fired long after the triggering test had finished and threw inside an async timer callback in whatever unrelated suite happened to be running under `--runInBand` at that moment — reproduced as `TypeError: pool.getConnection is not a function` inside `OutboxWorker.ts`, crashing the suite with no connection to the actual defect (#394). It reproduced locally and never in CI for a second reason worth its own row: `isEmailConfigured()` gates the worker, `config.notifications.emailEnabled` defaults to **true**, and `config.email.host` always has a fallback — so the real gate is whether `EMAIL_USER`/`EMAIL_PASSWORD` happen to be set, which they commonly are in a developer's local `.env` for manual SMTP testing and never are in CI. `src/__tests__/setup.ts` already had exactly this shape of safety net for Redis (`REDIS_ENABLED` defaulted to `'false'` before `dotenv` can load the `.env` file's value, since dotenv never overwrites an already-set variable) with the same stated reason — a live client's reconnection timer keeping Jest from exiting. Email now gets the identical treatment, so a local `.env`'s SMTP credentials can no longer make a test run non-deterministic depending on whose machine runs it. The guard logic itself moved into `testEnvDefaults.ts`, a module with no side effects beyond the env-var write, specifically so it could be exercised directly — `setup.ts` cannot be re-required mid-test to prove its own guard holds, because it also registers a top-level `beforeEach` and `expect.extend`, and Jest Circus refuses to register a hook once test execution has started ("Hooks cannot be defined inside tests"); `jest.isolateModules` sandboxes the `require` cache, not the shared Circus globals `setup.ts` calls into. Six further cases were added on the strength of an independent review of this fix (a scripted multi-agent pass grepping every `process.exit` call site in `index.ts` for the same fallthrough shape, and proposing coverage gaps): `startOutboxWorker`'s interval is confirmed `unref`'d under REAL timers — the one property fake timers cannot observe, and the most direct pin on the regression class, since an interval that kept its ref would itself keep a bare process alive; a second `startOutboxWorker` call while one is already running is confirmed to arm nothing new (asserted as "unchanged from the count after the first call" rather than a literal number, because Jest's modern fake timers also count a `setImmediate` Winston's logger schedules internally on `logger.info(...)` even when silent — a real count, just not evidence about this guard, and pinning the assertion to that incidental number would fail on a logging-library upgrade for a reason unrelated to the code under test); a stopped worker is confirmed to restart; and `startServer`'s outer catch (a step succeeding the DB check but failing later) and its happy path both got their first test — before this, every case in the file proved what does NOT happen on a failure branch, and none proved the success path does what it is supposed to. Verifying this fix caused no regression also surfaced a second, unrelated, pre-existing flake (#556): under `jest --coverage` with Jest's default parallel workers (not `--runInBand`), a small fraction of runs fail one arbitrary route suite with a symptom that varies by run. Reproduced independently on a clean `main` checkout via `git worktree`, confirming it predates and is unrelated to this fix; filed separately rather than folded in, to keep this fix scoped to the mechanism it actually diagnosed. |
| The request budget is charged per organization, and counted once for the whole deployment | `express-rate-limit` with its defaults was wrong here twice over. Its store is **per process**, and this backend is documented and scripted as horizontally scalable (`--scale backend=2` behind nginx) — so a configured limit of 200/min silently permitted 400/min at two replicas, and nothing in a single-instance test run reveals it. Its key is the **client IP**, which behind a corporate NAT lumps an entire organization into one bucket so the busiest site throttles its own quiet colleagues, while a client spread over several addresses gets a bucket each and the limit does not bind at all. The counters now live in the shared cache store — the same Redis-or-in-process module the JTI blacklist and auth-context cache use — and the key is the caller's **organization** (the root of their org-unit tree), falling back to their user id, then to the IP. Each fallback is an unavailability, not a policy: a user with no org-unit membership still gets a per-caller bucket rather than borrowing anyone's. The token is verified in the limiter, before `authenticate`, because the limiter must protect the login endpoint — an HMAC check with no database, used **only** to choose a counter and never as an authorization decision: an expired or forged token falls through to the IP bucket, so a bad token can never buy the larger organization allowance. The user → organization mapping is cached five minutes, which would be unacceptable for a permission and is fine for a budget; the worst case is that someone who changed organization is charged to their previous one briefly. Every failure mode admits the request and logs a warning, because a limiter that 500s when its own store is unavailable takes the API down to enforce a budget. The login limiter moved onto the same counter for the reason that matters most: at two replicas its ten attempts were twenty, and there the multiplication is a security property rather than a fairness one. It stays IP-keyed deliberately — keying on the submitted email would let an attacker lock a known account out by exhausting its budget on purpose. `express-rate-limit` is no longer a dependency, and the two tests that configured their own instances of it (and so kept passing while testing the library rather than this system) now exercise the middleware the app actually mounts. |
| The audit gate decides from the report, never from npm's exit code | Both CI jobs ran `npm audit --audit-level=high --omit=dev`, and both failed intermittently with a 400 from `/-/npm/v1/security/audits/quick` — an endpoint the registry is retiring — reporting "Invalid package tree, run npm install to rebuild your package-lock.json". That message was the least likely explanation and the simplest experiment disproved it: re-running the identical job on the identical lockfile passes. npm uses the BULK advisory endpoint and falls back to `quick` when the bulk call fails, so the failure was transport rather than tree. It mattered beyond the annoyance: a security gate that fails for reasons unrelated to security teaches people to re-run it, and once that is the reflex a genuine advisory gets the same treatment. `scripts/audit-dependencies.mjs` asks npm for `--json` and decides locally, because a bare `npm audit` conflates "found a vulnerability" with "could not reach the registry" in one exit code. A parseable report with a high or critical advisory fails the build; a report with nothing at that level passes; **no** report after three attempts with backoff passes with a loud GitHub warning annotation naming what was skipped. That last case is a decision rather than a `|| true`: blocking every merge on an external service's availability is its own failure mode, one nobody can fix from inside the repository, and the realistic response to it is to disable the gate — strictly worse. What is never tolerated is a report that arrives and contains a finding, since no network condition can produce that. npm's own JSON error object parses cleanly and carries no vulnerability metadata, so "parses" is not the test — "carries `metadata.vulnerabilities`" is, and that distinction has its own case in `scripts/audit-dependencies.test.mjs`, run under `node --test` with no framework, because a gate needing the dev dependencies installed to verify itself would be circular. |
| Exports go through one serializer, and every one is audited | Eight datasets are downloadable as CSV — the three reports, employees, shifts, assignments, attendance and time-off — plus the audit log, which was the only export before this and whose inline serializer became the shared one. Two of its three properties were wrong and both failed silently: no UTF-8 BOM, so Excel on Windows read "Müller" as "MÃ¼ller", and no formula guard, so a value beginning `=`, `+`, `-`, `@`, TAB or CR was evaluated by the spreadsheet — and these files carry names, descriptions and justifications a user typed, which makes `=HYPERLINK(...)` in a display name a live link in the manager's workbook. Such a value is now prefixed with a tab and quoted; the characters are kept, because stripping them would be silent data loss. Columns are DECLARED per dataset rather than derived from the row: an export that serialized whatever the service selected would keep publishing every field added later, and "employees" quietly growing a salary column is a disclosure nobody decided to make. `ExportService` is a class rather than a helper because it is where the audit entry is written — an export copies data out of the access-control system entirely, and no later permission change reaches the file — so an unaudited export would have to be written by deliberately not using it; the entry records the filters, since "exported 412 rows" does not answer *which* 412. Each `/export` endpoint calls the same service method as its JSON sibling with the same filters minus pagination, and each route's filter construction — including the org-unit scope and the "pinned to your own records" rules — was extracted into one function the two share, because a second copy of that clause is a second authorization path. **Streaming was asked for and deliberately not built**: every export is bounded by a range or a scope, and streaming would mean giving up the error envelope on a mid-flight failure, since the status line is already sent. Revisit past roughly a hundred thousand rows; the seam is `toCsv`. Every `/export` endpoint also accepts `?format=csv\|xlsx` (default `csv`); `ExportService.send` is the single method for both, so the audit entry, the filename rule and the before/after ordering cannot drift between formats — only the serializer and the two response headers differ. The XLSX writer (`utils/xlsx.ts`) reuses the same declared `CsvColumn` list and the same formula-injection guard as CSV, but writes numbers and dates as their own cell types rather than as text, which is the reason to open the file over the CSV in the first place. |
| A calendar feed is one of several named subscriptions, and is never rotated | `user_calendar_tokens` had `user_id` as its PRIMARY KEY, so a person held exactly one token and obtaining another overwrote the hash — every device already subscribed stopped working, which is the opposite of what a calendar subscription is for. `calendar_tokens` holds many per user, each with a **label**, because revoking the right one requires knowing which is which: "Phone" and "Work laptop" is the difference between cutting off a lost device and cutting off yourself. There is no rotate endpoint any more; rotation *was* the defect. Revoking sets `revoked_at` rather than deleting the row, so someone can see that a feed existed and when it stopped — a row that quietly vanished is indistinguishable from one never created — and it keeps the hash reserved against resurrection. The UNIQUE key stays on the hash alone, not `(user_id, hash)`: a token identifies its owner, so the same hash held by two people is exactly the ambiguity the constraint must prevent. The raw value is shown once, at creation, and the page offers no way to see it again, because only the digest is stored and an offer to redisplay would be claiming otherwise. The confirmation before revoking says the other feeds are unaffected — under the old model this action broke all of them, and anyone who remembers that needs telling. Existing tokens migrate across labelled `Existing subscription`; a migration that dropped them would be the very failure this change fixes. |
| A directory field states its visibility on the row | Custom fields carry `isPublic`, and a field someone fills in without knowing who will read it is how a private note becomes a published one. The badge is on every row rather than inside an edit dialog nobody opens. The vCard is a plain link rather than a fetch: the endpoint returns a file with a content type, and pulling it through the typed client into a blob only to hand it back to a download achieves nothing an anchor does not, while losing the filename the server sets. |
| Bulk vCard import previews before it writes (#534) | Left out of the directory UI for a while on purpose, because its questions were not UI questions: a duplicate email is **skipped, never updated** — the existing person may carry local edits an external card knows nothing about, and updating silently would discard them without asking; a bad card among two hundred is **skipped and reported with a reason**, not a cause to abandon the other 199; and a card becomes a real **account** (able to sign in), the same thing `POST /users` creates, which is why import stays gated on `user.manage` rather than something weaker. Answering those questions still left the UI question: a bulk write that reports only a total is how someone discovers three months later that forty people were never created. New `POST /directory/import-vcard/preview` runs the exact same decision logic as the real import — including that a second card in the same file with an already-seen email is treated as a duplicate, because that is what actually happens once the first one commits — but writes nothing, so the page can show every row's fate (create / skip + why) before the button that commits to it is even enabled. |
| A manual assignment is checked against the same contract the optimizer already respects (#330) | Found while scoping #330's "preferences vs constraints" review: `ComplianceEngine.evaluateAssignmentCompliance` — the gate `AssignmentService.createAssignment` runs on every DIRECTLY created assignment — never consulted `employment_contracts` at all, only `user_preferences` then `system_settings`. Meanwhile `AutoScheduleService` (the optimizer) already resolved the same three fields from `EmploymentContractService.resolveLimitsForPeriod` first. The two paths could disagree: a manager sets a 20h/week contract limit, the optimizer respects it, and a manually created assignment outside the optimizer was checked only against a stale `user_preferences` value — the contract had no effect on the one enforcement path meant to be unconditional. Fixed by resolving the same contract lookup first in `evaluateAssignmentCompliance`, ahead of `user_preferences`/`system_settings`, so both paths now agree. A contract field left `null` (deliberately "not constrained" per that contract, see the row below on blank limits) still falls through to `user_preferences`/`system_settings` rather than being treated as truly unbounded — an existing simplification `AutoScheduleService` already made the same way, so this keeps the two paths consistent with each other rather than fixing one gap by opening a new disagreement. |
| An org unit's audit entry records what it was, not what the request said (#327) | `PUT /org/units/:id` wrote its audit entry from the raw request body as `after`, with no `before` at all — a real gap found while scoping person-history (#327): the body is a partial patch (every field optional), so a request that appoints a new manager and touches nothing else produced an entry saying only `{managerUserId: 42}`, with no record of who held that headship before. An event trail that can't answer "who managed this unit before this change" can't answer the "appointments" question #327 asks about at all. Moved the audit write into `OrgUnitService.update()` itself, the only place that has both the pre-update row and the resolved merged state; `before`/`after` now carry the full resolved shape (name, description, parentId, managerUserId, isActive) either way, not just the touched keys. |
| The frontend no longer keeps its own copy of `ShiftAssignment` | `types/index.ts` declared `Assignment` by hand alongside the shared package's `z.infer<typeof shiftAssignmentSchema>` — the same schema that generates the OpenAPI component and therefore the API's actual response. The two had already drifted: `userId` was optional on the copy and required on the schema, and two fields marked "legacy" (`employeeId`, `role`) corresponded to nothing the API returns. Code reading `assignment.employeeId` compiled and was always `undefined`, so `assignment.userId ?? assignment.employeeId ?? ''` in the schedule grid carried two fallbacks that could never fire. Removing the copy made the compiler find that on its own, which is the point: a hand-written duplicate is only ever compared by a human, so nothing announces the day the API changes and the copy does not. |
| An account is deactivated, never deleted, and the UI says so | `DELETE /users/{id}` sets `is_active = 0`: the row stays, and so does everything hanging off it — assignments worked, decisions made, the audit trail. That is the right behaviour and the wrong verb, so the control reads **Deactivate** and the service function is named `deactivateUserAccount`. A button promising removal would be lying about an account that cannot simply disappear. Deactivated accounts stay in the list, because hiding them makes a disabled account indistinguishable from one that never existed — which is exactly the question someone is asking when they cannot find a colleague. The page also states that it is the ACCOUNT and not the employee record: they share a person and almost nothing else, and conflating them is how a deactivated account keeps appearing in a roster. No password field exists here at all — the holder sets their own credential through the reset flow. |
| Retiring a shift template is soft, and the UI says "Retire" | The server marks a template inactive rather than removing it, which is right: shifts already created from it are ordinary shifts with their own rows, and a template is a pattern used at a moment rather than something those shifts belong to. Calling the control "Delete" would promise a reach into past schedules that does not happen — and that nobody should want, since a shift people have already worked cannot be edited by changing the pattern it came from. The page states what becomes of those shifts, because "retire" with no explanation invites the reader to wonder. `deleteShiftTemplate` also now reports a miss instead of returning `true` unconditionally, which had made the route's 404 branch unreachable: deleting a template that does not exist answered "deleted successfully". |
| A blank contract limit means "not constrained", never zero | `null` on a limit means the contract does not bound it and the person falls back to their historical default — a different statement from "zero hours" and from "unknown". The form therefore OMITS an untouched field rather than sending `0`, which would cap someone at nothing, and the table prints "not constrained" rather than a dash or a zero. The same distinction runs through an open-ended assignment, shown as "still in force" rather than as a blank end date: one is a deliberate absence, the other looks like missing data. The page states in its own text that limits are set by managers and never by the person they apply to — these are legally bounded and once lived on `user_preferences`, which is how an employee came to be able to raise their own legal maximums. |
| Being on call is presented as held, not worked | A period is availability, not attendance: the person is reachable, not at work, and the hours are not hours worked. The page keeps it in its own shape rather than the shift's, for the same reason the timeline draws it as a separate source — showing it identically would invite exactly the wrong reading. Coverage (`assignedCount` against `minStaff`) is on every row rather than behind a click, because whether the rota is covered is the only question anyone asks of it. The rota itself is gated with `enabled` on `schedule.read`, not fetched and hidden: it is a statement about where named colleagues have to be reachable. The employee picker is fetched only when a manager has a period open — a picker that is not on screen is a request for an answer nobody reads. |
| A swap UI names both sides, and says plainly who decides | A swap changes two people's commitments at once, so every candidate is shown as one sentence naming what the requester takes **and** what the other person takes, before anything is sent — a screen showing only one half is how someone agrees to a shift they did not realise they were taking. The person whose shift is being taken currently has no say: `approve` and `decline` are gated on `shiftswap.approve`, so a manager decides and both assignments move. Their row therefore reads "a manager decides this" rather than showing buttons that would 403 or an empty cell that looks like a page which failed to load. Whether that model is right is a separate question (#522); what would be wrong is a UI that hides it. |
| Swap candidates are their own question, not a widened assignment listing | Proposing a swap needs a colleague's assignment id, and every endpoint that lists other people's assignments is gated on `assignment.manage` — so the feature was reachable only by someone who already knew such an id, which in practice meant not at all. `GET /assignments/{id}/swap-candidates` answers the narrower question instead: the caller must **own** the assignment, and the answer is bounded by the org units they belong to, resolved server-side from membership and narrowed by a scoped role, never accepted from the request. Relaxing `GET /assignments` would have exposed the whole roster to everyone to serve one legitimate case. Excluded: the caller's own, the same shift, shifts already run or beyond a 60-day horizon, and any exchange that would leave either person double-booked — checked through `AssignmentValidator`, not re-derived. The conflict check costs two queries per candidate so it is capped, and `truncated` says when the list is a prefix: a caller told nothing would believe they had seen everything. |
| Assignments have two screens, not one | "My shifts" offers only confirm and decline, and only on a pending assignment: creating or deleting one is a planner's act on a shift, and putting both on the same page would suggest an employee can give themselves work. The planner's half lives on the shift, behind `assignment.manage`, and uses the server's **available-employees** endpoint rather than the full staff list — the server already applies the skill, availability, conflict and capacity rules, and offering everyone instead would make the user discover those rules one refusal at a time while leaving an endpoint built for exactly that unused. The refusal messages are relayed verbatim: they are the only place in the product where those rules are explained to a person, and the picker narrows the candidates but a rule can still fire between opening it and clicking. |
| The timeline is lanes and bars, not "the schedule drawn" | A view that renders `shifts` on a time axis would have to be rewritten the first time anything else needs the same picture — a hospital wants its operating theatres on a timeline, where the lane is a room and the bar is a procedure, and none of that is a shift. So the model is deliberately smaller than scheduling: a **lane** is something time is booked against, a **bar** is a half-open interval on one lane, and a **scope** is a date range plus the org units the caller may see. Two sources exist rather than one because an abstraction with a single implementation is an indirection that breaks on the second caller; shifts and on-call periods are both already in the schema, genuinely different in shape, and overlap in time — which is itself what a planner wants to see. Operating theatres are **not** implemented: there is no room, procedure or equipment entity to draw, and inventing one would be the opposite mistake. Each source scopes inside its own query, because "which org unit owns this bar" has a different answer for a person and for a room, so a single downstream filter would be wrong the moment a lane stops being an employee. |
| Timeline visibility is its own permission, and its projection is narrow | `timeline.read` shows the caller's own organization units and their subtrees; `timeline.read_all` lifts the **membership** bound — a planner is not limited to the ward they happen to belong to — while the org-unit scope a role carries still binds in both cases, so a manager scoped to one ward never sees another's. Two codes because `allowedOrgUnitIds` is NULL — meaning unrestricted — for anyone whose roles carry no org-unit scope, so one code granted to the Employee role would publish the whole organization's movements to everyone in it. The scope is computed from **membership** (`user_org_units`, expanded through the subtree) and intersected with the role scope when there is one, so a scoped role can only narrow it. Someone attached to no unit sees an empty timeline rather than everything — the direction in which a misconfigured membership is visible rather than catastrophic. `schedule.read` is not reused: it governs the schedule as an object of planning, while this governs seeing *people*. The projection is name, activity, start, end and status — never pay, never assignment notes, and **absences do not appear at all**, because showing who is away on the covered days makes leave and sickness deducible. Columns are listed explicitly rather than selected and trimmed, so a column added to `users` later cannot surface here by omission. |
| Permission-based RBAC (no hardcoded roles) | Roles are customer data. Hard-wiring `admin`/`manager`/`employee` prevents multi-tier hierarchies. `user_roles` grants are scoped and time-bound, supporting org-unit subtree access and temporary elevation. |
| JWT in httpOnly cookie + JTI blacklist | The cookie prevents XSS from stealing the token. The `jti` claim in each token enables server-side revocation on logout via an in-memory `Map<jti, expiresAt>` with lazy TTL expiry — lightweight and sufficient for single-instance deployments. |
| Auth cookie is `SameSite=Strict` | The SPA's HTML shell is public and all authenticated calls are same-site fetches, so Strict costs nothing and closes the residual CSRF window Lax leaves for top-level GET navigations. |
| Single MySQL pool per process | `src/index.ts` reuses the pool owned by the `database` singleton (`config/database.ts`) instead of creating a second one, so the configured `DB_POOL_LIMIT` is the real ceiling against MySQL. |
| Working-time limits live on an effective-dated employment contract | A contract is a shared, named bundle of limits (`employment_contracts`) associated with a person over a period (`user_employment_contracts`). Previously they were columns on `user_preferences`: unshareable, so each person's limits were retyped and drifted independently; undated, so moving to part-time overwrote the value and last month's schedule appeared to violate a limit that did not apply then; and incomplete, since the daily cap was not stored at all — the engines invented `max(8, weekly/5)`, a formula appearing in no contract and no documentation as a decision, yet enforced as a hard constraint. A dedicated entity rather than a `policies` scope because `policies` has no validity period, and effective dating is the whole point. When a schedule period spans a contract change the optimizer takes the **most restrictive** limit in force at any point in it: conservative in the direction that matters, since it can under-schedule someone whose limits rose but never produces a schedule breaching a limit that applied while it ran. Per-shift resolution is the eventual answer and is deliberately not built first, because it makes limits vary per shift and reshapes the problem format both engines agree on. |
| Equity carries a deviation from the team average, not a raw count | Weekend and night loads were counted per solve, so someone who worked every weekend in March started April level with a colleague who worked none. Carrying raw totals fixes that and creates a worse problem: a person who joined mid-period appears never to have worked a weekend and is chosen for the next ones until they "catch up", which is a penalty for having been hired later. A deviation puts a new joiner at zero — neither owed nor owing. The average is taken over **the candidates of this solve**, not the whole organization, because the comparison that means anything is with the people the solver is choosing between; averaging across departments would compare a ward with an office. Carried values are normalised to be non-negative, which changes nothing the solver optimises (`max − min` is invariant under adding the same constant to every load) and spares both engines a negative lower bound on every load variable. |
| Labour cost stays out of the optimizer's objective | `hourly_rate` exists on `users` and is deliberately not read by either engine. A cost term makes the solver systematically prefer cheaper staff, and since pay correlates with seniority, age and tenure the cumulative effect is indirect discrimination produced by a system nobody reads as a pay decision — the optimizer assigns shifts, not salaries, and the person on the receiving end can neither see it nor contest it. A low-weight soft term was rejected for the same reason at a smaller scale ("all else equal, pick the cheaper" happens often, and it lands on the same people every time); a hard budget ceiling was rejected because under a tight budget coverage collapses and the solver ends up deciding which shifts go unstaffed, which is a service decision disguised as a technical constraint. Reporting a plan's cost to the planner without it entering the objective remains open and is a separate question. |
| A schedule continues from ONE chosen predecessor, not from every other schedule | The boundary read used to take every other schedule within ±14 days and filter on the *assignment's* status, never the *schedule's* — so drafts and archived generations counted as though they had happened. A planner comparing candidate generations for a period had all of them read at once: one person appeared to be working several overlapping sets of shifts, their consecutive-days and weekly-hours history at the boundary was inflated by however many existed, and the new month was constrained by work that will never happen, since at most one of them can be published. Now: published schedules, which are what happened, plus the explicitly chosen predecessor whatever its status — a planner who names a draft means it. `previous_schedule_id` is a column and not an inferred rule because the inference (latest published schedule for the department ending before this one) is right in the ordinary case and cannot settle the case it exists for; NULL therefore means "resolve the default", not "no predecessor". The candidate list deliberately includes archived schedules — an abandoned generation is precisely what the choice may be between — and flags which one the default would pick, so the UI never re-derives the rule. |
| A replanning proposal stores the whole solved plan, not just the diff | The plan sits between solving and deciding, and the world moves in between. Storing only the diff and re-deriving the rest at apply time means trusting that nothing else moved. Re-solving at approval and requiring the diff to match was rejected: a solver is not required to return the same optimum twice, so an approved diff could legitimately fail to reproduce and the planner would have approved a decision the system then declines to make. Storing the whole set and verifying it against live data means what gets applied is exactly what was approved, or nothing. The verification is deliberately narrow — shifts still exist and still belong to the schedule, people are still active — and does **not** re-run the constraint validator: the plan was legal when solved, and re-litigating it here would create a second authority on what is legal. A plan invalidated by a genuine change in the inputs is caught by re-solving, not by a second opinion. |
| Replanning proposals live in their own table, not `change_requests` | `change_requests` carries a proposed payload and routes it through `approval_workflows`, which is the right shape — but its `apply` executes no domain effect for any change type: it marks the row applied and writes an audit entry, leaving a human to perform the change. A replanning diff cannot be performed by hand, and approving it is precisely what must write the rows. Its payload is also unlike the others: hundreds of assignments plus the diff against what people were told, which has to be verified against live data before it can be applied at all. |
| Pairing rules are gated on `employee.manage`, not `employee.read` | Every other staff-record read uses `employee.read`, which the default Employee role holds — so the same gate here would publish, to everyone in the organization, the list of which colleagues must be kept apart. An `apart` rule is an inference about two named people even with no text attached: the fact that someone decided these two must not share a shift is itself the sensitive part. Writes take the same permission rather than `preferences.manage`, because a pairing is an employer-imposed constraint on staff, not something anyone wants. The free-text `reason` is deliberately **not** separately gated: a caller who can already see that two named people must be kept apart infers the substance without the sentence, so hiding the text while showing the rule protects nothing and only makes the record less useful to the next manager. A genuine need-to-know tier would belong in the permission catalogue as its own code, not as a field the API omits on a guess. There is no self-service view for the same reason — an employee asking why they are never scheduled with a colleague is asking a question a manager should answer in person. |
| A mutual `requires` is allowed; `requires` + `apart` on the same pair is not | Two `requires` rows in opposite directions read like a deadlock and are not one: the engines encode `requires` as `a <= b`, so the pair means `a == b` — both people on the shift or neither, which is exactly what a symmetric pairing is and what the migration names two rows as the way to express. What genuinely cannot hold is `requires` and `apart` between the same two people, in either direction: one says A may only work shifts B works, the other that A may never share a shift with B, so A can never be assigned — and neither engine would report why, because each rule is individually satisfiable. Rejected at creation (409) rather than diagnosed at solve time. `apart` is symmetric, so the reverse row is refused as a duplicate the ordered-pair unique key cannot catch. |
| Working-time limits are manager-set, not self-service | `maxHoursPerWeek`, `minHoursPerWeek` and `maxConsecutiveDays` are hard constraints the optimizer enforces, and legally bounded in most jurisdictions — so they are excluded from `PUT /api/preferences/me`, which is guarded by authentication alone, and settable only through `PUT /api/preferences/:userId` behind `preferences.manage`. They live in the `user_preferences` table beside genuine preferences, and that shared home is exactly why one endpoint once covered both; the durable fix is an effective-dated employment contract (#454), since a person moving to part-time still overwrites the old value and makes last month's schedule appear to violate a limit that did not apply then. |
| Overnight shifts are supported; a shift's `date` is its START date | Night shifts are ordinary in every sector this system targets, and the constraint validator, both optimizer engines, the calendar feed and the compliance engine had always handled them — only the request schemas refused, so careful tested logic existed for a shape the API would not accept. The schemas now reject `startTime === endTime` only (a zero-length shift). Because a shift is a DATE plus two TIME columns, everything that reasons about when a shift runs reconstructs the absolute interval first: `DateUtils.shiftBounds` in application code, `SHIFT_HOURS_SQL` / `SHIFT_ABS_END_SQL` in queries. An overnight shift's hours count entirely against the day it begins — a Monday-night shift is a Monday shift, not four hours of each day. |
| Hard cutover (no backward-compat shim) | The 3-role ENUM was the root of every hardcoded check. A migration shim would perpetuate the pattern. The seeded bootstrap roles (Administrator/Manager/Employee) reproduce prior behaviour without any shim. |
| `requireModule` returns 404 | A 401 leaks that the route exists. 404 is the correct response when an entire feature is absent; no information is disclosed. |
| In-process module cache | Module state changes infrequently. A per-request DB lookup for a static flag is wasteful. Cache invalidation on `setEnabled` is a single line. |
| `AuditLogService.write` swallows errors | An audit write failure must never block a business operation. The audit log is observability, not a transaction requirement. |
| `WITH RECURSIVE` CTE for org-unit subtrees | Fetches the entire subtree in one query. No N+1. Depth is bounded by the org tree (typically < 10 levels). |
| `approval_matrix` preserved alongside `approval_workflows`, but `ApprovalMatrixService.resolve()` has no remaining callers | The migration of `PolicyExceptionService` onto `approval_workflows`/`pending_approvals` (matching the other request types) removed the last caller that used the matrix as its ENTIRE approval mechanism. `EmployeeLoanService`'s and `PolicyExceptionService`'s one remaining use — a creation-time "does the actor auto-approve their own request" check — turned out to be answering a question `ApprovalEngineService.resolveApprover` already had the pieces to answer, just not in the shape a caller about to INSERT its entity needed (that method discards which step resolved to whom once every step auto-approves, since its contract is "who's the first REAL approver"). `resolveFirstStepAutoApprove(changeType, ctx)` gives both facts for step one specifically, sourced from the same workflow the request is about to be attached to — so both services now decide auto-approval from `approval_workflows`/`approval_steps.auto_approve_for_owner` directly, with no `ApprovalMatrixService` dependency left in either. The matrix table, `ApprovalMatrixService`, and the admin CRUD on `policies.ts` (`GET`/`PUT /policies/approval-matrix`) are unchanged: an admin UI (`Policies.tsx`) still edits the table, and no route or service resolves through it for a real decision anymore — dropping the table needs that UI reworked first, not a data-layer change alone. |
| Deliberate major-version holds: helmet 7, express-rate-limit 7, jest 29, dotenv 16 | All are actively maintained with zero known vulnerabilities (`npm audit` gate in CI). Their next majors are API-breaking with no security payoff today; upgrades should be dedicated PRs, not drive-by bumps. Express was migrated to 5 (#318) once its predecessor entered security-only maintenance; ESLint was EOL on v8 and has been migrated to v9 flat config. |
| Approving an employee loan makes the person schedulable in the destination unit, via `departments.org_unit_id` | `EmployeeLoanService.isOnLoan()` had zero production callers: approving a loan changed only the loan row's own status, never who the optimizer or the manual-assignment picker considered. Loans are scoped to `org_units`; scheduling is scoped to `departments`, a separate hierarchy bridged only by the optional `departments.org_unit_id` FK. `AutoScheduleService.generate` (both engines share this candidate pool) and `AssignmentOrchestrator.getAvailableEmployeesForShift` now widen their `user_departments` membership query with an OR against `EmployeeLoanService.listLoanedInUserIds()` for the department's bridged org unit and the relevant date range — a `LEFT JOIN` rather than the previous `INNER JOIN`, since a loaned-in person may have no `user_departments` row at all. The unavailability and cross-schedule-conflict reads that follow were switched from a fresh `user_departments` subquery to the already-resolved candidate id list, so a loaned-in person's existing commitments are respected exactly like a permanent member's — otherwise they would look free when they were not. A department with no `org_unit_id` bridge degrades to the plain department-only pool, so an installation that never linked the two hierarchies sees no behavior change. `OrgUnitService.listMembersDetailed` separately appends loaned-in staff to the destination unit's roster, flagged `onLoan: true` rather than `isPrimary`, since a manager borrowing someone for two weeks plausibly wants to see them on the roster and real membership is a different, stronger fact than a loan. |

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

The suite provisions a throwaway `staff_scheduler_itest` database from the
migration chain, seeds minimal fixtures, then drops the database. It is
excluded from `npm test` (see `testPathIgnorePatterns`) and runs in CI inside
the e2e job, which already provides a MySQL service.

Six layers, 164 tests:

- **Flows** — login/logout including JTI revocation, refresh-token rotation and
  reuse detection, `POST /api/assignments`, the delegation lifecycle, the user
  directory and the dashboard aggregates.
- **Every fixture-free GET** (46 endpoints) — asserting only that the statement
  runs, i.e. a status below 500. The subject is whether MySQL understood the
  query, not the response body: a 200, a 403 and a 404 all mean it did.
- **Fixture-free mutations** (21 endpoints) — the same assertion for the
  POST/PUT/PATCH endpoints that need no path parameter, with bodies built from
  the suite's fixtures. A 400 also fails the case: it means validation rejected
  the body and no SQL ran, so the endpoint would appear covered while nothing
  was tested.
- **Path-parameter mutations** (42 endpoints) — UPDATE and DELETE on a real
  row, including the membership join tables. A bogus id would short-circuit at
  the handler's existence check and never reach the mutation SQL, so each case
  creates its own disposable row through the admin connection and drives the
  endpoint against that id. The rows are disposable so a DELETE cannot remove
  one a later case depends on.
- **Workflow actions** (18 endpoints) — approve / reject / cancel / apply for
  time-off, change-requests, policy-exceptions and org-loans, plus the
  pending-approval decision actions (approve, reject, keep, open-to-structure,
  delegate). Each files a real request through its endpoint — which needs the
  requester's primary org unit to have a resolvable manager, wired in the
  block's fixture — then drives the action, reaching the decision
  state-machine SQL that is the app's most join-heavy path.
- **Remaining mutations** — the cheap-fixture endpoints the layers above
  missed (skills, directory fields, module overrides, bulk operations,
  on-call assignment, schedule duplicate, attendance, calendar tokens), the
  multi-actor shift-swap (two assignments on two users), and the CSV/vCard
  imports. Deliberately excluded: `auth/2fa/*` (enabling 2FA on the shared
  admin fixture invalidates the login cookie every later test needs, and the
  endpoints need valid TOTP codes; their single-table SQL is unit-tested) and
  `schedules/:id/generate` (runs the optimizer, covered by the parity suite;
  its DB write is the assignment INSERT already swept).

**Adding an endpoint means adding it to the relevant sweep.** This is not
ceremony: on its first run the GET sweep found four endpoints — `/audit-logs`,
`/change-requests`, `/notifications` and `/on-call/me` — returning 500 in every
deployment, invisible to 2479 mocked tests. A mocked pool asserts that a
service composed a particular SQL string, never that MySQL accepts it, so line
coverage says nothing about SQL correctness.

Bodies in the mutation sweep are thunks rather than literals, because
`it.each` evaluates its table when the module is collected — before `beforeAll`
inserts the fixtures — so a literal capturing a fixture id would send
`undefined` and be rejected before reaching the database.

### Finding code kept alive only by its tests

```bash
cd backend
npm run deadcode:tests
```

`knip.json` lists the test files as entry points. That is right for its
purpose — without it, every helper exported purely so a unit test can reach it
is reported as unused — but it also means anything a test reaches counts as
used, so production code kept alive by nothing but its own tests sits behind a
green dead-code gate. Three separate reviews found instances: `CryptoUtils`,
`HierarchyUtils` and `ResponseUtils`; `ResponseUtils.paginated`; and
`SkillService`, 634 lines implementing a skill catalog no route ever exposed.

Configuring knip with a production entry point does not substitute for this —
verified against the tree that still contained `SkillService`, it reported
nothing.

The script **warns and exits 0** by design. A test-only export is not
automatically a defect: internal helpers exposed for unit testing (`parseCsv`,
`hotp`, `buildVCard`), declared test hooks (`resetModuleCacheForTests`) and the
canonical constraint validator — which is by construction the specification
both scheduling engines are held to — are all legitimate. The output is a list
to judge, not a gate to satisfy.

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
