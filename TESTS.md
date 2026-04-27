# TESTS

A static dashboard of the test suite: where the tests live, how they are
organized, what they cover, and how to read the artifacts published by CI.

_Numbers below are the freshest local run (2026-04-27)._
_Re-generate by running `cd backend && npm run test:coverage` and
`cd frontend && CI=true npm test -- --watchAll=false --coverage`._

## At a glance

| Package  | Test suites | Tests |   Lines |  Statements | Branches | Functions |
|----------|------------:|------:|--------:|------------:|---------:|----------:|
| backend  |          38 |   406 | 47.1 %  |   47.5 %    |  42.5 %  |   45.2 %  |
| frontend |           8 |    42 | 21.3 %  |   23.2 %    |  19.2 %  |   20.0 %  |

CI publishes the full HTML coverage tree as an artifact named
`backend-coverage` / `frontend-coverage` on every workflow run. Open the
run, scroll to **Artifacts**, download the zip, open
`coverage/lcov-report/index.html` in a browser. The CI summary tab also
prints a coverage table per package so you don't have to download
artifacts for the headline numbers.

## Layout

### Backend — `backend/src/__tests__/`

```
__tests__/
├── setup.ts                          global mocks + custom matchers
├── meta-jest-verification.test.ts    smoke (Jest works)
├── auth.service.test.ts              login state machine + password_hash regression
├── auth.middleware.test.ts           authenticate + requireRole/Admin/Manager
├── auth.route.test.ts                supertest /api/auth/login + /verify + /logout
├── compliance.engine.test.ts         pure rules: rest, consecutive, weekly
├── timeOff.service.test.ts           F02 state machine
├── shiftSwap.service.test.ts         F01 swap + compliance veto
├── preferences.service.test.ts       F07 upsert + JSON arrays
├── auditLog.service.test.ts          F10 filters + clamp
├── calendar.service.test.ts          F04: per-user feed + colleagues + ETag + dept feed
├── calendar.route.test.ts            F04 route: 401, 200, 304, 403, 200 dept
├── totp.test.ts                      RFC 4226 D vectors + helpers
├── twoFactor.service.test.ts         F15 setup + enable + recovery codes
├── openapi.route.test.ts             F17 spec served + Swagger UI HTML
├── reports.service.test.ts           F08 hours/cost/fairness
├── notification.service.test.ts      F03 inbox CRUD + clamp
├── bulkImport.service.test.ts        F16 CSV parse + import idempotency
├── eventBus.test.ts                  F18 SSE pub/sub
├── autoSchedule.service.test.ts      F09 orchestrator branches
├── skillGap.service.test.ts          F12 demand vs supply
├── tenant.middleware.test.ts         F13 tenant resolution
├── system.route.test.ts              demo banner / system info
├── employee.service.test.ts          legacy
├── department.service.test.ts        legacy
├── skill.service.test.ts             legacy
├── systemSettings.service.test.ts    legacy
├── user.service.test.ts              legacy critical paths
├── assignment.service.test.ts        legacy state machine
├── schedule.service.test.ts          legacy CRUD + atomic overlap
├── shift.service.test.ts             legacy CRUD
├── scheduleOptimizer.test.ts         greedy fallback path
├── onCall.service.test.ts            F21 service
├── userDirectory.service.test.ts     F22 service
├── vcard.test.ts                     RFC 6350 builder + parser
├── routes.auth.smoke.test.ts         every protected new route → 401 unauth
├── routes.legacy.smoke.test.ts       every protected legacy route → 401 unauth
├── routes.f21f22.smoke.test.ts       on-call + directory routes → 401 unauth
└── utils.index.test.ts               legacy utility toolkit
```

Backend Jest config is at `backend/jest.config.json`; coverage HTML is
written to `backend/coverage/lcov-report/`.

### Frontend — colocated `*.test.tsx`

```
frontend/src/
├── setupTests.ts                     pulls in @testing-library/jest-dom
├── components/
│   ├── DemoBanner.test.tsx
│   ├── ThemeToggle.test.tsx          (via colocated test)
│   └── charts/BarChart.test.tsx
├── services/
│   ├── apiUtils.test.ts
│   └── i18nApi.test.ts
└── utils/
    ├── format.test.ts
    └── notify.test.ts
```

Frontend tests run via `react-scripts test`; the underlying Jest config
is provided by CRA (we don't override it).

## Conventions

- One `describe(...)` block per public unit, one `it(...)` per behaviour.
- `it` titles state behaviour, not implementation. ✅ *"returns
  LOGIN_FAILED when the email is unknown"*. ❌ *"calls execute once"*.
- Negative paths are first-class: every service test file has at least
  one rejection / rollback case.
- Async assertions use `await expect(...).rejects.toMatchObject(...)`
  rather than `try`/`catch`.
- DB tests use a queueable `pool` fake whose `execute` is queued per call
  with `mockResolvedValueOnce`. No real DB is required by the test
  suite. Pattern shared by every service test in the tree.
- Route tests use `supertest` against a tiny Express app that mounts
  only the router under test.

## Running locally

```bash
# All backend tests with coverage
cd backend && npm run test:coverage

# Single backend test file
npx jest src/__tests__/onCall.service.test.ts

# Watch mode while iterating
npm run test:watch

# All frontend tests with coverage
cd frontend && CI=true npm test -- --watchAll=false --coverage

# Single frontend test
CI=true npm test -- --watchAll=false src/components/DemoBanner.test.tsx
```

## CI

`.github/workflows/ci.yml` runs two parallel jobs on every push to
`main` and every PR:

| Job                                       | Steps                                               |
|------------------------------------------|------------------------------------------------------|
| Backend (lint, typecheck, test, build)   | `npm ci` → `lint` → `tsc` → `test:coverage`         |
| Frontend (lint, test, build)             | `npm ci` → `lint` → `test --coverage` → `build`     |

Both jobs publish:
- a coverage table to `$GITHUB_STEP_SUMMARY` (visible on the run page);
- the full HTML coverage tree as an artifact (`backend-coverage` /
  `frontend-coverage`), retained 30 days.

Workflow runtime: Node 22; action runtime explicitly bumped to Node 24
via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so the deprecation
warning the user reported on 2026-04-26 is silenced.

## Path to higher coverage

Tracked items in `PLAN.md`:

1. **R007** — drop the dead `src/optimization/ScheduleOptimizer.ts`
   (344 lines, 0 % covered, never wired). Bumps overall coverage by
   ~5 percentage points without touching a test.
2. **T010** — happy-path tests on every legacy route (currently only
   401 smoke). Estimated +20 percentage points on lines.
3. **T020** — RTL render-and-interact tests on Login + Dashboard, plus
   service-level tests for the frontend modules currently at 0 %
   (notifications, timeOff, shiftSwap, reports, calendar). Estimated
   frontend lines +25 percentage points.

Reaching 90 % across both packages is realistic in two more iterations
following T010/T020. Reaching 100 % is theoretically possible but the
last 10 percentage points are concentrated in the server bootstrap,
process error handlers, and unreachable defensive branches that yield
near-zero defect detection per test added; we'll stop ratcheting the
gate when test churn outweighs regression-detection value.
