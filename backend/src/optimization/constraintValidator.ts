/**
 * Canonical schedule-constraint validator — the single source of truth for
 * what a "valid" staff schedule is.
 *
 * WHY THIS EXISTS
 * ---------------
 * The scheduling constraints used to live in two independent implementations:
 * the Python CP-SAT model (optimization-scripts/schedule_optimizer.py) and the
 * TypeScript greedy fallback (ScheduleOptimizerORTools.evaluateCandidate). Each
 * decided for itself what "legal" meant, and the two drifted — the greedy
 * enforced minimum rest, a daily-hours cap, a rolling weekly-hours window and a
 * hard consecutive-days limit that the CP-SAT model simply did not have. A
 * schedule the greedy path rejected could be produced by the OR-Tools path and
 * vice-versa, silently, with no test able to see it.
 *
 * The fix is to stop expressing the constraint set as solver logic and express
 * it once, declaratively, as a *checker over a finished solution*. A checker is
 * the right shape here because it is engine-agnostic: it takes a problem and a
 * flat list of assignments and reports every rule the solution breaks, no
 * matter which engine produced them. Both engines are now measured against this
 * one definition (see optimizer.parity.test.ts), so any future divergence
 * becomes a red test instead of a production surprise.
 *
 * WHY A VALIDATOR AND NOT A SHARED SOLVER
 * ---------------------------------------
 * The two engines legitimately differ in *how* they search: CP-SAT is a global
 * optimizer that treats coverage as a hard constraint (and can therefore report
 * a problem INFEASIBLE), while the greedy is a deterministic best-effort pass
 * that fills what it can. Forcing them to share search logic would erase that
 * intended difference. What must NOT differ is the set of hard rules a produced
 * solution obeys. So parity is asserted on *validity of the output*, never on
 * identical assignments or identical coverage.
 *
 * The rules mirror, one-for-one and in the same order, the hard constraints in
 * ScheduleOptimizerORTools.evaluateCandidate. Any change to the constraint
 * model must be made here first; the engines are then aligned to keep the
 * parity suite green.
 *
 * WHY THIS FILE IS NOW A FACADE
 * ------------------------------
 * The rules used to live in one ~1150-line file. That was auditable at first
 * and stopped being so once it held seven genuinely independent families —
 * hard constraints, coverage, rest/time-off, weekend/night equity, per-employee
 * shift patterns, and per-skill staffing counts — each with its own doc
 * comments explaining why it exists and why it's soft or hard. Splitting them
 * into `optimization/constraints/*` keeps each family reviewable on its own
 * while this file stays the one import surface both engines and their tests
 * already depend on — re-exporting everything under its original name, so no
 * caller needed to change.
 *
 * @author Luca Ostinelli
 */

export type { ValidatedAssignment } from './constraints/hardConstraints';
export { findConstraintViolations } from './constraints/hardConstraints';

export type { OverCommitment } from './constraints/coverage';
export { coverageShortfalls, findOverCommitments } from './constraints/coverage';

export { restShortfalls, timeOffAdjacencies, daysOffShortfalls } from './constraints/restAndTimeOff';

export { startTimeSpreads, illegalTurnarounds, DEFAULT_NIGHT_TURNAROUND_HOURS } from './constraints/shiftPatterns';

export {
  isWeekendDay,
  isNightWork,
  weekendLoads,
  nightLoads,
  weekendSpread,
  nightSpread,
  DEFAULT_MAX_CONSECUTIVE_CATEGORY_PERIODS,
  shiftRotationViolations,
} from './constraints/equity';

export { qualifiedStaffShortfalls } from './constraints/qualifiedStaff';

/*
 * Not re-exported here, deliberately: the per-family result-shape types
 * (ConstraintViolation, RestShortfall, TimeOffAdjacency, DaysOffShortfall,
 * StartTimeSpread, IllegalTurnaround, CategoryLoad, ShiftRotationViolation,
 * QualifiedStaffShortfall, IdentifiedShift) and equity's DEFAULT_WEEKEND_DAYS/
 * DEFAULT_NIGHT_WINDOW/categoryLoads. Every current caller only needs the
 * functions and ValidatedAssignment/OverCommitment above — TypeScript infers
 * a function's return shape without an explicit type import, and knip's
 * dead-export check (which only ignores same-file usage) would otherwise
 * flag a re-export nothing outside `optimization/constraints/*` imports.
 * Import a specific family's own module directly if a future caller needs
 * one of these by name.
 */
