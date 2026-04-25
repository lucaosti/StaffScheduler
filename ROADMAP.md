# Roadmap

This document tracks proposed features and deferred technical work for Staff
Scheduler. Items here have been intentionally scoped out of the current
audit-and-cleanup pass so that each can be designed, reviewed, and tested in
isolation.

## Conventions

- **Priority** &mdash; `P1` high impact / low-to-medium effort, `P2` medium impact
  or medium effort, `P3` strategic but expensive.
- **Effort** &mdash; `S` &le; 1 day, `M` 2&ndash;4 days, `L` &gt; 1 week.
- Items are **not in execution order**; pick by business priority.

---

## Proposed features

| ID  | Feature                                                                 | User benefit                                       | Priority | Effort |
|-----|-------------------------------------------------------------------------|----------------------------------------------------|----------|--------|
| F01 | Shift swap requests (employee &harr; employee, manager approval)        | Less manager load, more employee autonomy          | P1       | M      |
| F02 | Time-off / leave management (vacation, sick leave, custom unavailability) | Realistic planning, fewer last-minute conflicts | P1       | M      |
| F03 | Notifications on assignment / change (email + in-app)                   | Reduce no-shows, improve communication             | P1       | M      |
| F04 | Calendar export (iCal feed per user, Google Calendar subscription)      | Integration with personal calendars                | P1       | S      |
| F05 | Mobile-first responsive layout, installable PWA                         | Use on phones, offline last-known schedule         | P1       | M      |
| F06 | Dashboard KPI charts (coverage, fairness, cost trends)                  | Manager-level visibility at a glance               | P2       | M      |
| F07 | Self-service preferences (preferred shifts, max weekly hours, avoid list) | Better morale, leverages `user_preferences` table | P2       | S      |
| F08 | Reports module (hours worked, cost by department, fairness, exports)    | Compliance and payroll inputs                      | P2       | M      |
| F09 | Auto-schedule wizard via OR-Tools (wire `optimization-scripts/`)        | Massive time saver for managers                    | P2       | L      |
| F10 | Audit log viewer UI (the `audit_logs` table already exists)             | Accountability and incident review                 | P2       | S      |
| F11 | Drag-and-drop schedule editor                                           | Modern UX for manual edits                         | P2       | M      |
| F12 | Skill gap analysis per department                                       | Identifies training and hiring needs               | P2       | M      |
| F13 | Multi-tenant / multi-location support                                   | Commercial scalability                             | P3       | L      |
| F14 | Internationalization (English + Italian, extensible)                    | Wider adoption                                     | P2       | M      |
| F15 | Two-factor authentication (TOTP)                                        | Enterprise-grade security                          | P2       | S      |
| F16 | Bulk import CSV / XLSX for employees and shifts                         | Faster onboarding                                  | P2       | M      |
| F17 | OpenAPI spec + Swagger UI auto-generated from routes                    | Easier integrations                                | P2       | S      |
| F18 | Real-time updates over WebSocket / SSE                                  | Live collaboration on edits                        | P3       | M      |
| F19 | Compliance hours engine (max consecutive shifts, minimum rest, custom rules) | Labour-law compliance                         | P1       | M      |
| F20 | Dark mode + WCAG 2.1 AA pass                                            | Accessibility and ergonomics                       | P2       | S      |

---

## Deferred technical work

These items were identified during the audit but require enough surface-area
churn that they should ship as standalone, well-tested PRs rather than as part
of a sweep.

### Backend

- **`executeTransaction(pool, fn)` helper** &mdash; replace ~15 hand-rolled
  `beginTransaction / commit / rollback / release` blocks. Mechanical refactor;
  blast radius is every service.
- **Typed error hierarchy** &mdash; `NotFoundError`, `ConflictError`,
  `ValidationError` exposed by services. Routes would map them via
  `instanceof` instead of `error.message.toLowerCase().includes('not found')`.
- **Row mappers** &mdash; centralize `User`, `Schedule`, `Shift`, `Assignment`
  row-to-DTO mapping currently duplicated across services.
- **Pagination** &mdash; `?page=` / `?pageSize=` (default 50, max 200) on
  `getAllUsers`, `getAllShifts`, `getAllSchedules`, with totals exposed via
  response headers or envelope.
- **JWT logout blacklist** &mdash; current logout is purely client-side.
  Introduce a `revoked_tokens` table or short-TTL cache keyed by `jti`.
- **Skill-compatibility check on assignment creation** &mdash; `AssignmentService`
  should reject assigning a user to a shift whose required skills are not in
  the user&rsquo;s `user_skills` set.
- **Atomic publish &harr; archive transitions** &mdash; only `archived` should
  be terminal; tighten state-transition validation.
- **Composite index** on `shift_assignments(user_id, status)` for the common
  &ldquo;my upcoming shifts&rdquo; query pattern.

### Frontend

- **Fetch interceptor for 401 / refresh** &mdash; today every service surfaces
  a raw 401. Wrap `fetch` once in `apiUtils` to attempt `refreshToken()` and
  retry once before bubbling.
- **`<EntityFormModal>`** &mdash; the modals in `Employees.tsx` and
  `Shifts.tsx` are ~95% identical; extract a single component.
- **Migrate `alert(...)` &rarr; `notify*`** &mdash; the helpers exist in
  `src/utils/notify.ts`; sweep the pages.
- **Audit unused dependencies** &mdash; `react-table`, `recharts`,
  `react-toastify`, `react-dnd`, `react-dnd-html5-backend`, `html2canvas`,
  `jspdf`, `xlsx`, `yup`, `react-hook-form` are listed in `package.json` but
  not imported. Each one removed reduces bundle size and supply-chain surface.
  Verify per-dependency before removing &mdash; some may be earmarked for
  upcoming features in this roadmap.
- **Canonicalize `minStaff` / `minimumStaff`** and `userId` / `employeeId`
  field names in `types/index.ts`; remove the alias forms.
- **Move `JWTPayload` and `AuthState`** into `src/types/index.ts` and stop
  redefining them in `AuthContext.tsx` and `AuthService.ts`.

### Testing

- **Backend** &mdash; smoke and critical-path Jest tests targeting ~25&ndash;30%
  line coverage:
  - `auth.service.test.ts` &mdash; correct vs. wrong password, inactive user.
  - `assignment.service.test.ts` &mdash; skill compatibility, double-assignment.
  - `schedule.service.test.ts` &mdash; overlap atomicity under simulated
    concurrency, archived &harr; draft transitions.
  - `routes/error-mapping.test.ts` &mdash; typed errors &rarr; HTTP statuses.
- **Frontend** &mdash; `apiUtils.test.ts` (`handleResponse` happy / sad paths),
  `AuthContext.test.tsx` (login / logout / refresh).

### Tooling

- **GitHub Actions CI** &mdash; matrix install, lint, typecheck, test, build
  for both `backend/` and `frontend/`.
- **Prettier config** + `prettier --check` in CI.
- **Husky + lint-staged** pre-commit hooks (the contributing guide mentions
  them but the config is missing).
