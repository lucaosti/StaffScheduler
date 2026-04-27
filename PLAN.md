# PLAN

Operating queue for Staff Scheduler. **`ROADMAP.md`** is the customer-facing
catalogue (immutable order, descriptions); **this file** is the engineering
queue that mutates over time. Every iteration starts here, picks the next
ready item from **Up next**, finishes it, and ticks it off.

## How to use this file

1. Read **In progress** and **Up next**. Pick the top of **Up next** unless a
   `P1` bug or security item exists in the backlog — those pre-empt features.
2. Move the picked item into **In progress** (only one at a time).
3. Implement it: code + tests + (if relevant) docs.
4. Tick the box, append a one-liner to **Changelog** with the commit SHA, move
   the next item from **Up next** when starting the following iteration.
5. New work uncovered along the way goes into **Backlog** with a fresh id.

## Item shape

```
- [ ] **<id>** | <type> | P1|P2|P3 | S|M|L
      Title — short noun phrase
      Acceptance: 1–3 testable bullets
      Files / area: paths or service names
      Depends on: <id>, <id>   (optional)
```

Type prefixes:

- `F##` &mdash; ROADMAP feature.
- `B##` &mdash; bug.
- `S##` &mdash; security.
- `R##` &mdash; refactor / tech debt.
- `T##` &mdash; test gap.
- `D##` &mdash; documentation / DX.
- `X##` &mdash; demo / seed data.
- `A##` &mdash; audit.

---

## In progress

_(none — pick from Up next)_

## Up next

1. **R007** — drop the dead `src/optimization/ScheduleOptimizer.ts`
   (genetic-algorithm path, 0 % covered, never wired). Bumps overall
   coverage by ~5 percentage points for free.
2. **T010** — happy-path tests on legacy routes (employees, schedules,
   shifts, departments, assignments). Currently those routes only have
   401-rejection smoke tests; mocking the underlying services and
   exercising one method per endpoint should add ~20 pp of line
   coverage.
3. **T020** — frontend RTL tests on Login + Dashboard pages, plus
   `<service>.test.ts` for the service modules that still have 0 %
   coverage (notifications, timeOff, shiftSwap, reports, calendar).
4. **A002** — re-run the full Phase 1/2/3 audit after R007/T010/T020
   land and produce `AUDIT-2026-04-27.md`.

## Recently completed

- **F19, F02, F01, F07, F10, F04, F15, F17, F12, F08, F03, F16, F18,
  F09, F06, F14, F05, F20, F11, F13** — all 20 ROADMAP features have
  backend services + routes + tests.
- **F21** — on-call (reperibilità) full backend (10 service tests,
  9 route smoke tests).
- **F22** — configurable user-profile fields + vCard 4.0 import/export
  (10 vCard utility tests, 9 service tests, 7 route smoke tests).
- **F04++** — calendar feed enhancements: aggregated department feed,
  colleagues listed in DESCRIPTION, on-call CATEGORIES, ETag +
  If-None-Match → 304 (4 service tests + 7 route tests).
- **CI** — Node 22 + Node 24 action runtime opt-in, coverage artifacts
  and per-job coverage tables in the GitHub job summary.
- **Coverage** — backend went from 18 % → 47 % lines, 25 % → 43 %
  branches, 24 % → 45 % functions. 406 backend tests, 38 suites.

---

## Backlog

### Demo and seed data

- [ ] **X001** | demo | P1 | M
      Demo seed script and idempotent reset
      Acceptance: `npm run db:seed:demo` populates a working dataset; rerunning
      it does not duplicate rows; `system_settings(runtime, mode) = 'demo'` is
      written.
      Files: `backend/scripts/seed-demo.ts`, `backend/scripts/fixtures/demo/*.json`,
      `backend/package.json`.

- [ ] **X002** | demo | P1 | S
      Demo banner in the UI
      Acceptance: when `/api/system/info` reports `mode: 'demo'`, a sticky banner
      renders; otherwise it does not.
      Files: `frontend/src/components/DemoBanner.tsx`, `frontend/src/App.tsx`,
      `backend/src/routes/system.ts`.
      Depends on: X001.

- [ ] **X003** | demo | P1 | S
      `scripts/demo.sh` orchestration: `up | reset | down | status`
      Acceptance: `./scripts/demo.sh up` brings the stack up and seeds; `reset`
      truncates and re-seeds in <10s.
      Files: `scripts/demo.sh`.
      Depends on: X001.

### Tests and CI

- [ ] **T001** | test | P1 | S
      Coverage gate in CI (start at 25% lines/statements/functions, 15% branches).
      Acceptance: `npm run test:coverage` fails the build if thresholds are
      not met; CI is wired to call it.
      Files: `backend/jest.config.json`, `.github/workflows/ci.yml`.

- [ ] **T002** | test | P2 | M
      `assignment.service.test.ts` — skill match, double-assign rejection.
      Files: `backend/src/__tests__/unit/services/assignment.service.test.ts`.
      Depends on: B002.

- [ ] **T003** | test | P2 | M
      `schedule.service.test.ts` — overlap atomicity simulated, archived state
      machine.
      Files: `backend/src/__tests__/unit/services/schedule.service.test.ts`.

- [ ] **T004** | test | P2 | S
      `routes/error-mapping.test.ts` — typed errors → HTTP statuses.
      Depends on: R002.

- [ ] **T005** | test | P2 | M
      `AuthContext.test.tsx` — login / logout / refresh flow.
      Files: `frontend/src/contexts/AuthContext.test.tsx`.

- [ ] **T006** | test | P2 | M
      Frontend `Login` page integration test (RTL).
      Files: `frontend/src/pages/Auth/Login.test.tsx`.

- [ ] **T007** | test | P2 | M
      Backend route smoke tests via supertest for `/api/auth/login` and one
      CRUD route.
      Files: `backend/src/__tests__/integration/routes/*.test.ts`.

### Bugs

- [ ] **B001** | bug | P1 | M
      JWT logout has no server-side blacklist.
      Acceptance: a token used after `/api/auth/logout` is rejected with 401.
      Files: `backend/src/services/AuthService.ts`, `backend/database/init.sql`,
      `backend/src/__tests__/...`.

- [ ] **B002** | bug | P1 | M
      `AssignmentService` does not enforce skill compatibility.
      Acceptance: assigning a user without a required skill returns 409 with a
      typed code.
      Files: `backend/src/services/AssignmentService.ts`.

- [ ] **B003** | bug | P2 | M
      `getAllUsers / getAllShifts / getAllSchedules` have no pagination.
      Acceptance: `?page=&pageSize=` honoured; default 50, max 200; total in
      response envelope.
      Files: services + routes.

### Security

- [ ] **S002** | sec | P1 | S
      Verify `dashboardRoutes` mount the `authenticate` middleware.
      Acceptance: integration test fails without a token.
      Files: `backend/src/index.ts`, `backend/src/routes/dashboard.ts`.

- [ ] **S003** | sec | P2 | S
      Sweep every `req.query`/`req.body` field that ends up in a SQL string
      (sanity check; we already use prepared statements).
      Acceptance: a written report; any finding becomes a follow-up item.

- [ ] **S004** | sec | P2 | S
      `npm audit --omit=dev` on both packages, file each fixable vuln separately.

### Refactors

- [ ] **R001** | refactor | P2 | M
      `executeTransaction(pool, fn)` helper, replace ~15 hand-rolled blocks.
      Files: `backend/src/utils/executeTransaction.ts` + every service.

- [ ] **R002** | refactor | P2 | M
      Typed error hierarchy (`NotFoundError`, `ConflictError`, `ValidationError`).
      Routes branch on `instanceof`, not `error.message`.
      Files: `backend/src/utils/errors.ts` + every route + every service.

- [ ] **R003** | refactor | P2 | M
      Row mappers in `backend/src/utils/mappers.ts`.

- [ ] **R004** | refactor | P2 | M
      Frontend fetch interceptor: 401 → refresh → retry once.
      Files: `frontend/src/services/apiUtils.ts`.

- [ ] **R005** | refactor | P3 | M
      Extract `<EntityFormModal>` from `Employees.tsx` and `Shifts.tsx`.

- [ ] **R006** | refactor | P3 | S
      Drop genuinely unused frontend deps (`react-table`, `recharts`,
      `react-toastify`, `react-dnd`, `html2canvas`, `jspdf`, `xlsx`, `yup`,
      `react-hook-form` — verify each before removing; some may be earmarked
      for upcoming features).

- [ ] **R007** | refactor | P2 | S
      Delete `src/optimization/ScheduleOptimizer.ts` (legacy 344-line
      genetic-algorithm module, 0 % covered, never imported by any
      runtime code path — `AutoScheduleService` uses
      `ScheduleOptimizerORTools` instead).
      Acceptance: file removed; backend builds; coverage automatically
      bumps by ~5 pp.

### Documentation

- [ ] **D001** | doc | P2 | S
      `backend/README.md` quickstart.

- [ ] **D002** | doc | P2 | S
      Deduplicate `TECHNICAL.md` ↔ `API_DOCUMENTATION.md`.

- [ ] **D003** | doc | P2 | S
      Reconcile `CONTRIBUTING.md` with the shipped CI.

- [ ] **D004** | doc | P2 | S
      Document the demo profile.
      Depends on: X001, X002, X003.

### Features (linked to ROADMAP)

- [x] **F01** Shift swap requests with manager approval and compliance gate.
- [x] **F02** Time-off / leave management (vacation, sick, custom unavailability).
- [x] **F03** In-app notifications inbox.
- [x] **F04** iCalendar feed per user (+ aggregated department feed,
       colleagues in DESCRIPTION, ETag, REFRESH-INTERVAL — see F04++).
- [x] **F05** PWA service worker registration + manifest.
- [x] **F06** Dashboard KPI bar charts.
- [x] **F07** Self-service preferences feeding the compliance engine.
- [x] **F08** Reports module (hours, cost, fairness).
- [x] **F09** Auto-schedule wizard wiring the OR-Tools optimizer.
- [x] **F10** Audit log viewer API.
- [x] **F11** Drag-and-drop primitive component.
- [x] **F12** Skill gap analysis per department + date range.
- [x] **F13** Multi-tenant scaffolding (tenant middleware).
- [x] **F14** i18n provider + API.
- [x] **F15** Two-factor authentication (TOTP, RFC 6238).
- [x] **F16** Bulk CSV import for employees and shifts.
- [x] **F17** OpenAPI 3.1 spec + Swagger UI.
- [x] **F18** SSE event bus and `/api/events/stream`.
- [x] **F19** Compliance hours engine (rest, consecutive days, weekly cap).
- [x] **F20** Dark mode toggle (mounted in app header).
- [x] **F21** On-call (reperibilità) periods + assignments.
- [x] **F22** Custom user fields + vCard 4.0 import/export.

---

## Doing rules

- A feature does **not** graduate to *done* without at least one passing test
  exercising the new code path.
- Every commit message follows Conventional Commits with the item id in the
  subject: `feat(F19): ...`, `fix(B001): ...`, `test(T002): ...`.
- Single author: `Luca Ostinelli <ostinelliluca2@gmail.com>`. No co-authors,
  no AI references in code, commits, or docs (see `CLAUDE.md`).
- Force-push on `main` only after explicit user approval.
- After the work is committed, push and confirm the CI run is green via
  `https://api.github.com/repos/lucaosti/StaffScheduler/actions/runs?per_page=5`.

## Final audit checklist (`A001`)

Run before declaring v1 done. Produces an `AUDIT-<date>.md` report.

### Phase 1 — automated

- [ ] `cd backend && npm run lint && npm run build && npm run test:coverage`
- [ ] `cd frontend && npm run lint && CI=true npm run test:coverage && npm run build`
- [ ] `npm audit --omit=dev` (both packages)
- [ ] `grep -ri 'claude\|anthropic' --exclude-dir=node_modules --exclude=CLAUDE.md`
      returns empty.
- [ ] `git log --pretty='%an' main | sort -u` returns only `Luca Ostinelli`.
- [ ] ROADMAP `[x]` ratio matches PLAN changelog.
- [ ] All workflow runs on the merge commit are green.

### Phase 2 — manual sweep

- [ ] Endpoint ↔ route ↔ service ↔ frontend service ↔ page coherence.
- [ ] `console.log/error` count in backend is 0 (Winston only).
- [ ] `alert(...)` count in frontend ≤ open `notify*` migration items.
- [ ] No `@ts-ignore`, no `any` outside generic helpers.
- [ ] Demo seed still produces a fully-working app (`./scripts/demo.sh up`).
- [ ] WCAG AA pass on Login, Dashboard, Schedule, Shifts (axe in RTL test).

### Phase 3 — security

- [ ] All routes mount `authenticate` (verified by listing).
- [ ] All `pool.execute` calls use parameter placeholders.
- [ ] JWT logout invalidation works (B001 closed).
- [ ] Rate limit on `/api/auth/login` (configured + exercised in test).
- [ ] CORS origin is not `*` in production config.
- [ ] `.env.example` does not contain real secrets; `.env*` is gitignored.
- [ ] Demo passwords are only in the demo seed.

---

## Changelog

_Newest first. Format: `<commit-sha> <id> <one-line summary>`._

- (this push)
  - F21 on-call (reperibilità) full backend (schema + service + routes + tests).
  - F22 vCard 4.0 import/export + configurable user_custom_fields.
  - F04++ aggregated department feed, colleagues in event description,
    ETag/304, X-PUBLISHED-TTL/REFRESH-INTERVAL.
  - STATUS.md created and kept current alongside PLAN/ROADMAP.
- `7727ad5` test: cover SkillService, DepartmentService, SystemSettingsService, UserService.
- `e8a3a37` feat(F20): mount ThemeToggle in app header.
- `a1580cd` test: cover legacy utils/index toolkit.
- `b8ecd85` feat(F11,F13): drag-drop primitive and multi-tenant scaffolding.
- `e67e438` feat(F20,F14,F05,F06): dark mode, i18n, PWA service worker, bar chart.
- `27dd534` feat(F09): wire auto-schedule wizard to the OR-Tools optimizer.
- `702b4b2` feat(F18): SSE event bus and /api/events/stream endpoint.
- `547f822` feat(F16): bulk CSV import for employees and shifts.
- `61c14c1` feat(F03): in-app notifications inbox.
- `eb018b6` feat(F08): reports module — hours, cost, fairness.
- `8f23c30` feat(F12): skill gap analysis per department and date window.
- `fd48be0` feat(F17): OpenAPI 3.1 spec + Swagger UI at /api/docs.
- `9b5620d` feat(F15): TOTP-based two-factor authentication.
- `ab3f7b4` feat(F04): per-user iCalendar feed with rotatable opaque token.
- `2c9b4e1` feat(F10): audit log viewer API.
- `422455c` feat(F07): self-service preferences.
- `67f1907` feat(F01): shift swap requests with manager approval and compliance gate.
- `9a0b6a1` feat(F02): time-off / leave management API with approval workflow.
- `5804d8b` feat(F19): compliance hours engine (rest, consecutive, weekly).
- `8cc3ff3` ci: drop minimum permissions to read-only.
- `709d532` chore(ci): track npm lockfiles for reproducible installs.
- `29d3111` test: cover auth login state machine and shared frontend utilities.
