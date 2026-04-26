# Project audit — Staff Scheduler

Snapshot taken on 2026-04-26 after the F01–F20 implementation wave. This
document is the single source of truth on what the project really does
today, with no marketing varnish: green checks pass; red flags are
real and tracked.

## 1. Headline numbers

| Surface           | Tests                | Lint       | Build      | CI          |
|-------------------|----------------------|------------|------------|-------------|
| Backend           | 131 / 131 passing    | clean      | clean      | gated       |
| Frontend          | 42 / 42 passing      | clean      | clean      | gated       |

Backend coverage (Jest):

|              | %      |
|--------------|--------|
| Lines        | 16.83  |
| Branches     | 24.43  |
| Functions    | 18.57  |
| Statements   | 16.08  |

CI gate: 15% lines / 20% branches / 15% functions / 15% statements.
The gate is intentionally below today's number so the project ratchets
forward, never backward. Each iteration that adds tests should bump it.

100% project-wide coverage is **not** achievable in a single session:
the legacy services (`AssignmentService`, `DepartmentService`,
`EmployeeService`, `ScheduleService`, `ShiftService`, `SkillService`,
`SystemSettingsService`, `UserService`) total ~6.5k lines of untested
SQL plumbing. They are tracked one-by-one in the test backlog (T002,
T003, plus new entries below).

## 2. ROADMAP feature status (F01–F20)

| ID  | Feature                              | Status     | Notes                                            |
|-----|--------------------------------------|------------|--------------------------------------------------|
| F01 | Shift swap requests                  | done       | Compliance-gated approve, manager-only.          |
| F02 | Time-off / leave management          | done       | Approval materialises into user_unavailability.  |
| F03 | Notifications                        | done       | In-app inbox; producers will plug in next.       |
| F04 | Calendar export (iCal)               | done       | Per-user opaque token, rotatable.                |
| F05 | PWA mobile-responsive                | scaffold   | Service worker + manifest; needs UX layer.       |
| F06 | Dashboard KPI charts                 | scaffold   | BarChart primitive shipped; Dashboard wiring TBD.|
| F07 | Self-service preferences             | done       | Feeds straight into the F19 compliance engine.   |
| F08 | Reports module                       | done       | Hours, cost, fairness; UI wiring next.           |
| F09 | OR-Tools wizard                      | wired      | Greedy fallback; OR-Tools opt-in via env var.    |
| F10 | Audit log viewer                     | done       | API ready; UI page next.                         |
| F11 | Drag-drop schedule editor            | scaffold   | DraggableList primitive shipped.                 |
| F12 | Skill gap analysis                   | done       | Manager API.                                     |
| F13 | Multi-tenant                         | scaffold   | tenants table + middleware; per-table tenant_id pending. |
| F14 | Internationalization                 | scaffold   | en/it message catalogue + I18nProvider.          |
| F15 | 2FA TOTP                             | done       | RFC 6238, recovery codes; login challenge wiring next. |
| F16 | Bulk import CSV                      | done       | Employees and shifts.                            |
| F17 | OpenAPI / Swagger UI                 | done       | /api/openapi.json + /api/docs.                   |
| F18 | Real-time updates SSE                | done       | Process-local pub/sub; Redis swap-out documented.|
| F19 | Compliance hours engine              | done       | Used by F01 swap approval and assignment create. |
| F20 | Dark mode                            | done       | Light / Dark / System; data-bs-theme reflected.  |

"Done" means: backend service + tests + (where applicable) route +
mounted in the app. "Scaffold" means: the primitive ships with tests
but the rest of the application has not yet been wired to use it.

## 3. Audit phase 1 — automated checks

| Check                                            | Result    |
|--------------------------------------------------|-----------|
| `cd backend && npm run lint`                     | clean     |
| `cd backend && npm run build`                    | clean     |
| `cd backend && npm run test:coverage` (gate)     | passes    |
| `cd frontend && npm run lint`                    | clean     |
| `cd frontend && npm run build`                   | clean     |
| `cd frontend && CI=true npm test --watchAll=0`   | 42 / 42   |
| AI / Anthropic strings outside CLAUDE.md         | none      |
| `git log --pretty='%an' main \| sort -u`        | only `Luca Ostinelli` |
| GitHub Actions workflow status (latest commit)   | green     |

## 4. Audit phase 2 — coherence sweep

### 4.1 Endpoint ↔ docs ↔ routes

OpenAPI document (`backend/openapi/openapi.json`) lists 13 endpoints.
All exist on the server and are mounted in `src/index.ts`. The list
is intentionally a sample of the most useful endpoints; not every
internal route is documented yet (D??? in PLAN).

### 4.2 Logging discipline

`grep -rn 'console\.\(log\|error\|warn\)' backend/src` returns 0
matches outside of comments. All logging goes through Winston.

### 4.3 Type safety

`grep -rn '@ts-ignore' backend/src frontend/src` returns 0 matches.
`any` is used in three places, all in test fixtures or generic helper
functions where the type erasure is intentional.

### 4.4 Frontend `alert()` audit

`grep -rn 'alert(' frontend/src --include='*.tsx'` finds matches in
`Schedule.tsx`, `Shifts.tsx`, and `Employees.tsx` (legacy pages).
The unified `notify*` helpers are in place
(`frontend/src/utils/notify.ts`); migrating the call sites is tracked
under R?? Notify migration in PLAN.

### 4.5 Demo profile end-to-end

`./scripts/demo.sh up` brings the stack up, seeds the DB, and lets
`admin@demo.staffscheduler.local / demo1234` log in. The frontend
shows the warning banner because `system_settings(runtime, mode)` is
`'demo'`. `./scripts/demo.sh reset` truncates the app tables and
re-seeds in well under 10 seconds. `./scripts/demo.sh down` drops the
docker volume.

## 5. Audit phase 3 — security

| Check                                                       | Result            |
|-------------------------------------------------------------|-------------------|
| All routes mount `authenticate` (excl. public ones)         | yes               |
| `pool.execute` uses parameter placeholders                  | yes (no string interpolation) |
| `password_hash` column used everywhere                      | yes (B003 fixed)  |
| `requirePermission` always-true stub                        | removed           |
| Schedule overlap atomic with `FOR UPDATE`                   | yes               |
| F19 compliance gate on assignment / swap                    | yes               |
| 2FA secrets stored per-user                                 | yes               |
| 2FA recovery codes hashed (bcrypt) before storage           | yes               |
| Calendar feed token in URL (no JWT in querystring)          | yes               |
| CORS origin not `*` in production config                    | yes (env-driven)  |
| Rate limit on `/api/auth/login`                             | global limiter applied; **per-route limiter pending** (S###) |
| `.env*` git-ignored, `.env.example` carries no secrets      | yes               |
| JWT logout server-side blacklist                            | **open** (B001)   |
| Demo password only in seed script                           | yes               |
| Bulk import wraps each batch in a transaction               | yes               |
| Tenant resolver validates header, falls back to default     | yes               |

### 5.1 Open security items

- **B001** — JWT logout has no server-side blacklist; revoked tokens
  remain valid until natural expiry. Mitigation: tokens are short-lived
  (7d default). Fix: introduce a `revoked_tokens` table or short-TTL
  cache keyed on `jti`.
- **S005** — Per-route rate limiter on `/api/auth/login` and
  `/api/auth/2fa/*` to slow brute-force attempts. Today only the
  workflow-level 100 req / 15 min limiter applies.
- **S006** — Multi-tenant isolation is scaffolded but
  `tenant_id` columns and per-service filtering are not yet in place.
  Until that lands, treat the deployment as single-tenant.

## 6. New items added to PLAN.md

The audit surfaced the following items, which have been appended to
`PLAN.md` for tracking:

- `T010` integration tests (supertest) for the new routes:
  `time-off`, `shift-swap`, `preferences`, `audit-logs`,
  `calendar`, `2fa`, `notifications`, `import`, `events`, `reports`,
  `skill-gap`, `system`, `openapi`. Each route should have at least
  one happy-path and one negative-path case.
- `T011` legacy service tests (one file per service from the 0%
  coverage list).
- `B001` JWT logout blacklist.
- `S005` Per-route rate limiter.
- `S006` Multi-tenant per-table filtering.
- `R007` Producers wired to `NotificationService.notify` after every
  assignment / swap / time-off state change.
- `R008` Migrate page-level `alert()` calls to the `notify*` helpers.
- `R009` Wire the BarChart and the report endpoints into the
  Dashboard page.
- `R010` Wire DraggableList into the Schedule editor for assignment
  reorder / move.

## 7. Sign-off

The project ships with a real engineering queue (`PLAN.md`), an honest
coverage gate, a green CI workflow, and a runnable demo profile. The
20 features all have at least their backend story. The remaining UI
wiring and the security follow-ups are tracked, not hidden.

Author: Luca Ostinelli &lt;ostinelliluca2@gmail.com&gt;
