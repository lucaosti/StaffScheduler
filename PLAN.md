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

1. **X001** — demo seed and reset scripts.
2. **T001** — coverage gate in CI.
3. **F19** — compliance hours engine.

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

- [ ] **F01** | feat | P1 | M — Shift swap requests (employee → employee, manager approval).
- [ ] **F02** | feat | P1 | M — Time-off / leave management (vacation, sick, custom unavailability).
- [ ] **F03** | feat | P1 | M — Notifications on assignment / change.
- [ ] **F04** | feat | P1 | S — Calendar export (iCal feed per user).
- [ ] **F05** | feat | P1 | M — Mobile-first responsive layout, installable PWA.
- [ ] **F06** | feat | P2 | M — Dashboard KPI charts.
- [ ] **F07** | feat | P2 | S — Self-service preferences. Depends on: F19.
- [ ] **F08** | feat | P2 | M — Reports module.
- [ ] **F09** | feat | P2 | L — Auto-schedule wizard via OR-Tools. Depends on: F19, F02.
- [ ] **F10** | feat | P2 | S — Audit log viewer UI.
- [ ] **F11** | feat | P2 | M — Drag-and-drop schedule editor.
- [ ] **F12** | feat | P2 | M — Skill gap analysis per department.
- [ ] **F13** | feat | P3 | L — Multi-tenant / multi-location.
- [ ] **F14** | feat | P2 | M — Internationalization.
- [ ] **F15** | feat | P2 | S — Two-factor authentication (TOTP).
- [ ] **F16** | feat | P2 | M — Bulk import CSV / XLSX.
- [ ] **F17** | feat | P2 | S — OpenAPI / Swagger UI.
- [ ] **F18** | feat | P3 | M — Real-time updates over WebSocket / SSE.
- [ ] **F19** | feat | P1 | M — Compliance hours engine. _Up next._
- [ ] **F20** | feat | P2 | S — Dark mode + WCAG 2.1 AA pass.

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

- `8cc3ff3` S001 ci: drop minimum permissions to read-only.
- `709d532` S001 chore(ci): track npm lockfiles for reproducible installs.
- `d96aacf` ci: initial GitHub Actions workflow (failed on first run, fixed by 709d532).
- `29d3111` test: cover auth login state machine and shared frontend utilities.
