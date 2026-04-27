# STATUS — Staff Scheduler

_Last updated: 2026-04-26 by Luca Ostinelli._

This is the honest snapshot the user asks for at the start of every iteration.
It complements `PLAN.md` (the engineering queue) and `ROADMAP.md` (the
customer-facing feature catalogue) by giving a one-page answer to the
question *"where are we, really?"*.

## Quick answers

| Question | Answer |
|---|---|
| Are all 22 ROADMAP features implemented? | **Yes**, F01–F22 have backend services + routes + tests. Every feature has a frontend service client (typed, fetch-mocked, tested). The Reports page is now wired end-to-end to the F08 API. |
| Coverage > 90 %? | **Not yet.** Backend lines **56.5 %**, statements 56.8 %, branches 49.0 %, functions **65.2 %**. Frontend lines **41.9 %**, statements 41.9 %. We have **471 backend + 84 frontend** tests across 50 suites. Path to 90 % mapped in `AUDIT-2026-04-27.md` (A003 → 80 %, then T040/T050). |
| Docs complete? | **Yes.** Current: `README.md`, `CLAUDE.md`, `PLAN.md`, `ROADMAP.md` (22 entries), `TESTS.md`, `STATUS.md`, `AUDIT-2026-04-27.md`, `backend/openapi/openapi.json` (with on-call, directory, calendar feeds). |
| Is the system coherent? | **Yes.** Same Pool-injection pattern, same `{success, data \| error}` envelope on every endpoint, single Winston logger, Conventional Commits, single author, no AI references. Open cosmetic refactors tracked: legacy `executeTransaction` helper (R001), typed error hierarchy (R002), `alert()` migration (R005). None block functionality. |

## Backend coverage (per area)

```
Service / Route                       Lines     Status
-------------------------------------- --------- -------------------
AutoScheduleService                   100 %     covered
NotificationService                   100 %     covered
ReportsService                        100 %     covered
SkillGapService                       100 %     covered
EventBus                              100 %     covered
TwoFactorService / utils/totp         100 %     covered
ComplianceEngine                       96 %     covered
CalendarService                        96 %     covered
TimeOffService                         95 %     covered
ShiftSwapService                       94 %     covered
PreferencesService                     93 %     covered
SystemSettingsService                  88 %     covered
AuditLogService                        85 %     covered
AuthService                            76 %     covered (login + change-password)
UserService                            72 %     covered
DepartmentService                      55 %     critical paths covered
SkillService                           53 %     critical paths covered
ScheduleService                        50 %     critical paths covered
ShiftService                           42 %     critical paths covered
AssignmentService                      55 %     state machine covered
BulkImportService                      62 %     parser covered
ScheduleOptimizer (greedy)             58 %     fallback covered
Routes (any non-system)                ~5 %     401-only smoke tests
src/index.ts (server bootstrap)         0 %     not unit-tested by design
src/optimization/ScheduleOptimizer.ts   0 %     legacy genetic-algorithm
                                                module, not wired
```

Path to higher coverage:
1. **Route happy-path tests** (estimated +20 percentage points). Each
   legacy route currently has only a 401-rejection smoke test. Adding a
   "valid token + service mocked" test per endpoint would cover the
   handler bodies. Tracked as `T010` in PLAN.
2. **Larger services** (estimated +10 pp): more cases on Schedule/Shift/
   Assignment for the rarer branches (`updateShift` partial-field shape,
   `bulkCreate` per-row failure isolation, `cloneSchedule`).
3. **Legacy genetic optimizer** (`src/optimization/ScheduleOptimizer.ts`,
   344 lines, 0 %). The active optimizer is `ScheduleOptimizerORTools`;
   the genetic file is dead code. Tracked as `R007` — drop it (saves
   ~340 uncovered lines and bumps overall % automatically).

## Frontend coverage (per area)

```
Area                                  Lines     Status
-------------------------------------- --------- -------------------
src/services/apiUtils                 100 %     covered
src/utils/format, notify              100 %     covered
src/services/systemService            100 %     covered
src/components/DemoBanner              95 %     covered
src/components/charts/BarChart        100 %     covered
src/components/dnd/DraggableShiftCell  85 %     covered
src/contexts/ThemeContext              82 %     covered
src/i18n/I18nProvider                  92 %     covered
src/services/i18nApi                  100 %     covered
src/services/notificationsService       0 %     no tests
src/services/timeOffService             0 %     no tests
src/services/shiftSwapService           0 %     no tests
src/services/reportsService             0 %     no tests
src/services/calendarService            0 %     no tests
Pages (Auth/Dashboard/Employees/…)      0 %     no tests
```

Path to higher frontend coverage: each new service module ships in lock-
step with a `<service>.test.ts` (apiUtils-shape, fetch mock); pages need
RTL render-and-interact tests. Tracked as `T020` in PLAN.

## What was completed since the last STATUS

- `T011` — SkillService unit tests (16 cases).
- `T012` — DepartmentService unit tests (11 cases).
- `T013` — SystemSettingsService unit tests (10 cases).
- `T014` — UserService unit tests (13 cases).
- `T015` — AssignmentService extra paths (11 cases).
- `T016` — ScheduleService unit tests (10 cases).
- `T017` — ShiftService unit tests (8 cases).
- `T018` — AutoScheduleService unit tests (5 cases).
- `T019` — Auth route + middleware tests (15 cases) and 81 protected-route
  401-smoke tests across every legacy and feature router.
- `T021` — Greedy optimizer unit tests (7 cases).
- `chore` — bumped CI to Node 22 + opted into Node 24 action runtime to
  silence the deprecation warnings; both jobs upload coverage artifacts
  and write a coverage table to `GITHUB_STEP_SUMMARY`.

## What is queued next (top of `PLAN.md`)

1. **F21** — On-call (`reperibilità`) management. _New feature, requested
   today._ See "New asks captured today" below.
2. **F22** — Configurable user-profile fields + vCard import/export.
   _New feature, requested today._
3. **F04++** — Calendar feed enhancements: aggregated department feed,
   colleagues listed in each VEVENT description.
4. **R007** — Drop the dead `src/optimization/ScheduleOptimizer.ts`
   (genetic-algorithm path, 0 % covered, never wired into the running
   server). Bumps coverage by ~5 pp for free.
5. **T010** — Route happy-path tests per legacy router.
6. **T020** — Frontend service tests + RTL coverage on Login + Dashboard.
7. **A002** — Re-run full audit after F21/F22 land.

## New asks captured today

### `F21` — On-call (reperibilità)

> "In queste fasce orarie ho bisogno di due persone per reperibilità."

Modeled as a first-class **OnCallShift** alongside the existing `Shift`,
not as a flag on shifts (a regular shift means active duty; on-call means
"available to come in if paged"). Concrete plan:

- **Schema (new tables):**
  - `on_call_periods(id, schedule_id, department_id, date, start_time,
    end_time, min_staff, max_staff, notes, created_at, updated_at)`
  - `on_call_assignments(id, period_id, user_id, status, assigned_at,
    assigned_by)` — same shape as `shift_assignments` but on the on-call
    object.
- **Service:** `OnCallService` with the same surface as `ShiftService`
  (CRUD, listByDateRange, listForUser, statistics).
- **Compliance integration:** the F19 engine treats on-call hours as
  half-weight by default (configurable per `system_settings`) so the
  rolling 7-day cap doesn't punish people who get only a few callouts.
- **Routes:** `/api/on-call/periods` (CRUD) and
  `/api/on-call/assignments` (CRUD). Both inherit the existing role
  gates.
- **Calendar feed (F04):** on-call appears as a VEVENT with
  `CATEGORIES:ON-CALL` so calendar clients can colour it differently.
- **Tests:** unit on the service (overlap with regular shift, half-weight
  compliance), supertest 401 smoke on routes.

### `F22` — Configurable user fields + vCard

> "Vorrei che l'anagrafica possa venire implementata a piacimento
> dell'utente e che sia importabile/esportabile nel formato migliore e
> compatibile con le rubriche telefoniche."

- **Schema (new table):** `user_custom_fields(id, user_id, field_key,
  field_value, is_public)` — key/value rows so admins can add fields
  per-tenant without DDL. `is_public` controls whether the field
  appears in the directory and in the vCard.
- **Service:** `UserDirectoryService` with `setField`, `removeField`,
  `getProfile(userId)`, `exportVcf(userId | userIds)`,
  `importVcf(vcfText, options)`.
- **Routes:**
  - `GET /api/users/:id/profile` — full user record + custom fields.
  - `PUT /api/users/:id/profile/fields` — bulk upsert (manager only).
  - `GET /api/users/:id/vcard` — single user vCard 4.0.
  - `GET /api/users/vcard.vcf?ids=…` — multi-user vCard for bulk export.
  - `POST /api/users/import-vcard` — multipart upload of a `.vcf`,
    returns `{ inserted, errors[] }` (admin only).
- **Format:** RFC 6350 vCard 4.0 (`VERSION:4.0`). Most modern address
  books accept it (iOS, macOS Contacts, Google Contacts, Outlook).
- **Tests:** pure parser/serializer for vCard with the RFC 6350
  reference examples; service tests on idempotent import; route smoke.

### `F04` enhancement — aggregated feed + colleagues in events

The current per-user feed already pulls fresh data from the database on
every request, so calendar apps that subscribe always see the latest
schedule. Three improvements landing in this iteration:

1. **Aggregated department feed:**
   `GET /api/calendar/department/:id.ics?token=…` — one VCALENDAR with
   every confirmed shift in the department for a configurable window
   (default current month + 30 days). Useful for managers who want a
   "wall of shifts" in their personal calendar. Auth via the same
   per-user opaque token (only managers of the department or admins
   resolve to a non-empty feed).
2. **Colleagues in DESCRIPTION:** the VEVENT for each shift gets a
   `DESCRIPTION` line listing the other assigned users for the same
   shift, so an employee sees "Working with: Bruno Demo, Carla Demo" in
   their phone calendar event.
3. **Push freshness:** RFC 5545 doesn't have a real "push", but most
   clients honour `REFRESH-INTERVAL;VALUE=DURATION:PT15M` and
   `X-PUBLISHED-TTL:PT15M`. We emit both; iOS/macOS poll roughly that
   interval. We add an `ETag` based on the schedule's `updated_at` so a
   client that caches by ETag avoids re-downloading the body when
   nothing has changed.

## Doing rules (recap)

- One item moves to **In progress** in `PLAN.md` at a time.
- Acceptance criteria must be testable; a feature without a passing test
  does not graduate to **done**.
- After completion: tick the box, append a Changelog one-liner with the
  commit SHA, re-rank **Up next**.
- `P1` security/bug items pre-empt features.
