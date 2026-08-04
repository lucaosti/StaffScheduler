/**
 * Staff Schedule Optimization Engine - OR-Tools Integration
 *
 * Wrapper for Python OR-Tools CP-SAT solver with a TypeScript greedy fallback.
 *
 * Architecture:
 * - TypeScript prepares problem data (shifts, employees, preferences, constraints)
 * - Calls Python script with OR-Tools CP-SAT solver via child_process
 * - Python script returns optimal/feasible solution
 * - On Python failure (not installed, timeout, non-zero exit), optimize() falls
 *   back to the TypeScript greedy solver automatically
 *
 * Greedy algorithm complexity: O(shifts × employees) per run.
 *
 * Constraints enforced by the greedy fallback (see evaluateCandidate, in
 * evaluation order — the numbering matches that method's inline comments):
 *   1. Staff cap — assignments per shift are capped at max_staff
 *   2. No double-booking — time-overlap detection within a calendar day
 *   2b. Minimum rest between shifts — same rule as ComplianceEngine's
 *       checkMinRest, including across different (typically adjacent) days
 *   3. Declared unavailability — date-level blocks from user_unavailability
 *   4. Skill requirements — employee must hold every skill the shift demands
 *   5. Daily hours cap — total hours already assigned on that date must not
 *      exceed the employee's daily budget (max_hours_per_week / 5)
 *   6. Weekly hours cap — rolling 7-day window, matching
 *      ComplianceEngine.checkMaxWeeklyHours
 *   7. Max consecutive working days
 *
 * To add a new constraint:
 *   1. Add any needed state tracking in generateGreedySchedule (e.g. a new Map).
 *   2. Add the check inside evaluateCandidate() so it is unit-testable without
 *      touching the database.
 *   3. Update the tracking map after each successful assignment in
 *      generateGreedySchedule.
 *   4. Write a unit test in scheduleOptimizer.test.ts.
 *
 * @author Luca Ostinelli
 * @inspiration PoliTO_Timetable_Allocator constraint programming with docplex
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { config } from '../config';
import logger from '../config/logger';
import { coverageShortfalls, findOverCommitments } from './constraintValidator';
// The overnight-aware time arithmetic these engines share. It used to be four
// private helpers here and equivalent copies in constraintValidator, kept in
// step by a comment — see ./shiftTime for why that was not good enough.
import { dateToMs, shiftBoundsMs, shiftHours, timeToMinutes } from './shiftTime';
import type { OverCommitment } from './constraintValidator';

// Re-exported so every existing import site keeps working unchanged; the
// declarations moved to ./types to break the validator -> optimizer cycle.
export type {
  ScheduleAssignment,
  Employee,
  Shift,
  OptimizationConfig,
  OptimizationProblem,
} from './types';
import type {
  ScheduleAssignment,
  Shift,
  Employee,
  OptimizationConfig,
  OptimizationProblem,
} from './types';

interface OptimizationResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'ERROR' | 'GREEDY_FALLBACK';
  objectiveValue?: number;
  solveTimeSeconds: number;
  assignments: ScheduleAssignment[];
  statistics: {
    numBranches?: number;
    numConflicts?: number;
    isOptimal: boolean;
    totalAssignedShifts: number;
    coverageStats: {
      totalShifts: number;
      fullyCoveredShifts: number;
      coveragePercentage: number;
      /**
       * Shifts left below `min_staff`, and by how many people in total.
       *
       * Present because coverage is no longer a hard constraint: the solver
       * answers under insufficient staff instead of refusing, so the answer
       * has to say where it fell short. Without this a caller cannot tell a
       * fully staffed schedule from the best available one, which is how a
       * draft gets published.
       */
      understaffedShifts: Array<{
        shiftId: string;
        date?: string;
        required: number;
        assigned: number;
        missing: number;
      }>;
      totalMissingStaff: number;
    };
  };
  /**
   * Employees left out because their work on OTHER schedules already breaches
   * a limit before this one starts. Reported on every run, not only failures:
   * an employee excluded for that reason is something the planner must see,
   * not a detail of how the solve went.
   */
  overCommittedEmployees: OverCommitment[];
  error?: string;
}

/**
 * Context passed to evaluateCandidate so the check is pure (no DB access).
 * Add new tracking fields here when introducing new greedy constraints.
 */
export interface CandidateContext {
  /** Shift being evaluated. */
  shift: Shift;
  /** IDs of shifts already assigned to this employee. */
  assignedShiftIds: Set<string>;
  /** All shifts in the problem (needed for overlap detection). */
  allShifts: Shift[];
  /** Hours already scheduled per employee per date key "empId|date". */
  dailyHoursMap: Map<string, number>;
  /** Assignments already committed to this shift (for max_staff check). */
  currentShiftAssignmentCount: number;
  /**
   * WHO is already on this shift.
   *
   * Pairing rules need identities, not a count: whether a candidate may join
   * depends on who else is there. This is the first constraint that cannot be
   * decided from the candidate alone.
   */
  currentShiftAssignees: Set<string>;
  /** Pairing rules in force, if any. */
  pairings?: OptimizationProblem['pairings'];
  /** Minimum rest hours required between two shifts (mirrors ComplianceEngine's policy). */
  minRestHoursBetweenShifts: number;
}

/**
 * Translates the Python solver's snake_case JSON into the camelCase shape the
 * rest of the backend consumes.
 *
 * WHY THIS EXISTS RATHER THAN `JSON.parse` STRAIGHT INTO THE TYPE. It used to
 * be exactly that, and the two spellings never met: Python emits
 * `statistics.coverage_stats`, the type declares `statistics.coverageStats`,
 * so the field was ALWAYS undefined. The guard `if (result.statistics
 * .coverageStats)` silently skipped and the coverage log line never printed
 * once — while the type asserted a field that could not arrive. A parsed JSON
 * blob cast to an interface is an unchecked claim; naming the translation
 * makes the boundary a place where a mismatch is visible.
 *
 * Defensive defaults rather than throwing: an older solver build that predates
 * the shortfall fields should degrade to "nothing reported", not take down a
 * run that otherwise produced a usable schedule.
 */
const mapPythonResult = (raw: Record<string, unknown>): OptimizationResult => {
  const stats = (raw.statistics ?? {}) as Record<string, unknown>;
  const coverage = (stats.coverage_stats ?? {}) as Record<string, unknown>;
  const understaffed = (coverage.understaffed_shifts ?? []) as Array<Record<string, unknown>>;

  return {
    ...(raw as unknown as OptimizationResult),
    overCommittedEmployees: ((raw.over_committed_employees ?? []) as Array<Record<string, unknown>>).map(
      (o) => ({
        employeeId: String(o.employee_id),
        rule: o.rule as OverCommitment['rule'],
        detail: String(o.detail),
      })
    ),
    statistics: {
      numBranches: stats.num_branches as number | undefined,
      numConflicts: stats.num_conflicts as number | undefined,
      isOptimal: Boolean(stats.is_optimal),
      totalAssignedShifts: (stats.total_assigned_shifts as number) ?? 0,
      coverageStats: {
        totalShifts: (coverage.total_shifts as number) ?? 0,
        fullyCoveredShifts: (coverage.fully_covered_shifts as number) ?? 0,
        coveragePercentage: (coverage.coverage_percentage as number) ?? 0,
        understaffedShifts: understaffed.map((u) => ({
          shiftId: String(u.shift_id),
          date: u.date as string | undefined,
          required: (u.required as number) ?? 0,
          assigned: (u.assigned as number) ?? 0,
          missing: (u.missing as number) ?? 0,
        })),
        totalMissingStaff: (coverage.total_missing_staff as number) ?? 0,
      },
    },
  };
};

export class ScheduleOptimizer {
  private pythonScriptPath: string;

  // Memoizes the id → shift index per problem instance so overlap checks are
  // O(1) per lookup instead of scanning the full shift list every time.
  private _shiftsByIdCache = new WeakMap<Shift[], Map<string, Shift>>();

  constructor() {
    // Path to Python optimizer script
    this.pythonScriptPath = join(__dirname, '../../optimization-scripts/schedule_optimizer.py');
  }

  /**
   * Optimize schedule using OR-Tools CP-SAT solver.
   *
   * Falls back to the greedy TypeScript solver when Python is unavailable,
   * the process times out, or the process exits with a non-zero code.
   *
   * @param problem - Problem data with shifts, employees, preferences
   * @param optimizationConfig - Optimization configuration
   * @returns Promise with optimization result
   */
  async optimize(
    problem: OptimizationProblem,
    optimizationConfig: OptimizationConfig = {}
  ): Promise<OptimizationResult> {
    logger.info('Starting schedule optimization with OR-Tools CP-SAT');
    logger.info(`Problem size: ${problem.shifts.length} shifts, ${problem.employees.length} employees`);

    const startTime = Date.now();

    try {
      // Validate input
      this._validateProblem(problem);

      // Prepare problem data with config
      const problemData = {
        ...problem,
        weights: optimizationConfig.weights || this._getDefaultWeights(),
      };

      // Call Python optimizer
      const result = await this._callPythonOptimizer(
        problemData,
        optimizationConfig.timeLimitSeconds || 300
      );

      const elapsedTime = (Date.now() - startTime) / 1000;

      logger.info(`Optimization completed in ${elapsedTime.toFixed(2)}s`);
      logger.info(`Status: ${result.status}, Assignments: ${result.assignments.length}`);

      if (result.statistics.coverageStats) {
        logger.info(`Coverage: ${result.statistics.coverageStats.coveragePercentage.toFixed(1)}%`);
      }

      return result;
    } catch (error) {
      // Python not installed, process timed out, or non-zero exit — fall back
      // to the TypeScript greedy solver so callers always get a usable result.
      const reason = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Python optimizer unavailable (${reason}); falling back to greedy solver`);

      try {
        const greedy = await this.generateGreedySchedule(problem);
        const elapsedTime = (Date.now() - startTime) / 1000;
        const totalShifts = problem.shifts.length;
        const covered = problem.shifts.filter(
          (s) => greedy.filter((a) => a.shiftId === s.id).length >= s.min_staff
        ).length;
        // Reported through the SAME canonical helper the parity suite uses, so
        // the two engines cannot disagree about what "understaffed" means. The
        // greedy is best-effort and leaves shifts short routinely, which makes
        // this the path where the shortfall matters most: a degraded run that
        // is ALSO short-staffed must say both things, not just the first.
        const shortfalls = coverageShortfalls(
          problem,
          greedy.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId }))
        );

        return {
          status: 'GREEDY_FALLBACK',
          solveTimeSeconds: elapsedTime,
          assignments: greedy,
          overCommittedEmployees: findOverCommitments(problem),
          statistics: {
            isOptimal: false,
            totalAssignedShifts: greedy.length,
            coverageStats: {
              totalShifts,
              fullyCoveredShifts: covered,
              coveragePercentage: totalShifts > 0 ? Math.round((covered / totalShifts) * 100) : 0,
              understaffedShifts: shortfalls.map((s) => ({
                shiftId: s.shiftId,
                date: problem.shifts.find((sh) => sh.id === s.shiftId)?.date,
                required: s.required,
                assigned: s.assigned,
                missing: s.required - s.assigned,
              })),
              totalMissingStaff: shortfalls.reduce((sum, s) => sum + (s.required - s.assigned), 0),
            },
          },
          error: reason,
        };
      } catch (greedyError) {
        logger.error('Greedy fallback also failed:', greedyError);
        return {
          status: 'ERROR',
          solveTimeSeconds: (Date.now() - startTime) / 1000,
          assignments: [],
          overCommittedEmployees: findOverCommitments(problem),
          statistics: {
            isOptimal: false,
            totalAssignedShifts: 0,
            coverageStats: {
              totalShifts: problem.shifts.length,
              fullyCoveredShifts: 0,
              coveragePercentage: 0,
              // Nothing was produced, so every shift is short by its full
              // requirement. Stated rather than left empty: an empty list here
              // would read as "no shortfalls", the opposite of the truth.
              understaffedShifts: problem.shifts.map((sh) => ({
                shiftId: sh.id,
                date: sh.date,
                required: sh.min_staff,
                assigned: 0,
                missing: sh.min_staff,
              })),
              totalMissingStaff: problem.shifts.reduce((sum, sh) => sum + sh.min_staff, 0),
            },
          },
          error: greedyError instanceof Error ? greedyError.message : 'Unknown error',
        };
      }
    }
  }

  /**
   * Call Python optimizer script via child_process.
   */
  private async _callPythonOptimizer(
    problem: OptimizationProblem,
    timeLimitSeconds: number
  ): Promise<OptimizationResult> {
    return new Promise((resolve, reject) => {
      // Spawn Python process
      const pythonProcess = spawn('python3', [
        this.pythonScriptPath,
        '--stdin',
        '--stdout',
        '--time-limit',
        timeLimitSeconds.toString(),
      ]);

      let stdoutData = '';
      let stderrData = '';
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      // Ensure the Promise settles exactly once and the watchdog timer is
      // always cleared, so it can never fire after the process has finished.
      const finalize = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        action();
      };

      // Watchdog: kill the process and reject if it never settles, so a
      // hanging Python optimizer cannot leak the child process forever.
      const timeoutMs = config.optimization.timeout;
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        logger.error(`Python optimizer timed out after ${timeoutMs}ms; killing process`);
        // Request graceful termination, then force-kill if it ignores SIGTERM.
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!pythonProcess.killed) {
            pythonProcess.kill('SIGKILL');
          }
        }, 5000).unref?.();
        finalize(() => reject(new Error(`Python optimizer timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      timeoutHandle.unref?.();

      // Collect stdout (JSON result)
      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      // Collect stderr (logs)
      pythonProcess.stderr.on('data', (data) => {
        const message = data.toString();
        stderrData += message;
        // Log Python script output
        logger.debug(`[Python Optimizer] ${message.trim()}`);
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        finalize(() => {
          if (code === 0 || code === 1) {
            // Success (0) or infeasible (1)
            try {
              resolve(mapPythonResult(JSON.parse(stdoutData)));
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse optimizer output: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
                )
              );
            }
          } else {
            // Non-zero exit — treat as hard error so optimize() can fall back
            reject(new Error(`Optimizer failed with code ${code}: ${stderrData}`));
          }
        });
      });

      // Handle process errors (e.g. python3 not found / ENOENT)
      pythonProcess.on('error', (err) => {
        finalize(() => reject(new Error(`Failed to start Python optimizer: ${err.message}`)));
      });

      // Send problem data to stdin
      pythonProcess.stdin.write(JSON.stringify(problem));
      pythonProcess.stdin.end();
    });
  }

  /**
   * Validate problem data before optimization.
   */
  private _validateProblem(problem: OptimizationProblem): void {
    if (!problem.shifts || problem.shifts.length === 0) {
      throw new Error('No shifts provided for optimization');
    }

    if (!problem.employees || problem.employees.length === 0) {
      throw new Error('No employees provided for optimization');
    }

    // Validate shifts
    for (const shift of problem.shifts) {
      if (!shift.id || !shift.date || !shift.start_time || !shift.end_time) {
        throw new Error(`Invalid shift data: ${JSON.stringify(shift)}`);
      }
    }

    // Validate employees
    for (const employee of problem.employees) {
      if (!employee.id) {
        throw new Error(`Invalid employee data: ${JSON.stringify(employee)}`);
      }
    }
  }

  /**
   * Get default constraint weights (inspired by PoliTO Parameters.py).
   */
  private _getDefaultWeights(): Record<string, number> {
    return {
      shift_coverage: 100,
      no_double_booking: 90,
      skill_requirements: 85,
      availability: 80,
      max_hours_per_week: 75,
      employee_preferences: 55, // Similar to teaching_overlaps_penalty in PoliTO
      workload_fairness: 40,
      consecutive_days: 30,
      rest_periods: 25,
      shift_continuity: 20,
    };
  }

  /**
   * Evaluate whether an employee is a valid candidate for a shift.
   *
   * This is a pure function — it receives all required context as arguments
   * so it can be unit-tested without any database interaction. Add new
   * constraint checks here (see module-level comment for the full recipe).
   *
   * @param emp     - Employee being evaluated
   * @param ctx     - Immutable snapshot of current scheduling state
   * @returns true if the employee can be assigned to ctx.shift
   */
  evaluateCandidate(emp: Employee, ctx: CandidateContext): boolean {
    const { shift, assignedShiftIds, allShifts, dailyHoursMap, currentShiftAssignmentCount } = ctx;

    // 1. Staff cap — never exceed max_staff for this shift
    if (shift.max_staff !== undefined && currentShiftAssignmentCount >= shift.max_staff) {
      return false;
    }

    // 2. No double-booking — reject if already on an overlapping shift today
    if (this._hasOverlappingShift(shift, assignedShiftIds, allShifts)) {
      return false;
    }

    // 2b. Minimum rest between shifts — same rule as ComplianceEngine's
    //     checkMinRest, e.g. an overnight shift ending 07:00 followed
    //     immediately by a 07:00 shift the next day is a same-day-overlap
    //     miss (different dates) but a real rest-hours violation.
    if (this._wouldViolateMinRest(shift, ctx)) {
      return false;
    }

    // 3. Declared unavailability
    if (emp.unavailable_dates.includes(shift.date)) {
      return false;
    }

    // 4. Skill requirements, including proficiency.
    //    An absent requirement means any level will do, and an absent level on
    //    the employee means "unknown" rather than "novice", so a problem that
    //    carries no levels behaves exactly as before. Kept in lock-step with
    //    constraintValidator, which is the authority.
    const requiredSkills = shift.required_skills || [];
    const empSkills = new Set(emp.skills);
    for (const skill of requiredSkills) {
      if (!empSkills.has(skill)) return false;
      const required = shift.required_skill_levels?.[skill];
      const held = emp.skill_levels?.[skill];
      if (required !== undefined && held !== undefined && held < required) return false;
    }

    // 5. Daily hours cap — guard against assigning more hours than a single
    //    workday budget (max_hours_per_week / 5, floored at 8h).
    // Contract cap when present; otherwise the historical derived formula.
    // Kept in lock-step with constraintValidator, which is the authority.
    const dailyBudget = emp.max_hours_per_day ?? Math.max(8, emp.max_hours_per_week / 5);
    const hours = shiftHours(shift);
    const dailyKey = `${emp.id}|${shift.date}`;
    const hoursAlreadyToday = dailyHoursMap.get(dailyKey) ?? 0;
    if (hoursAlreadyToday + hours > dailyBudget) {
      return false;
    }

    // 6. Weekly hours cap — sum hours already assigned to this employee in
    //    the trailing 7-day window ending on this shift's date, matching
    //    ComplianceEngine.checkMaxWeeklyHours (the same rule enforced
    //    elsewhere, e.g. ShiftSwapService.approve) so a greedily-generated
    //    schedule can't violate the constraint the rest of the app assumes
    //    every assignment respects.
    if (this._wouldExceedWeeklyHours(emp, shift, ctx)) {
      return false;
    }

    // 7. Max consecutive working days — reject if taking this shift would
    //    extend an unbroken run of worked days past emp.max_consecutive_days.
    if (this._wouldExceedConsecutiveDays(emp, shift, ctx)) {
      return false;
    }

    return true;
  }

  private _getShiftsById(allShifts: Shift[]): Map<string, Shift> {
    let shiftsById = this._shiftsByIdCache.get(allShifts);
    if (!shiftsById) {
      shiftsById = new Map(allShifts.map((s) => [s.id, s]));
      this._shiftsByIdCache.set(allShifts, shiftsById);
    }
    return shiftsById;
  }

  /**
   * The rolling window this mirrors (ComplianceEngine.checkMaxWeeklyHours) is
   * *centered* on whichever assignment is being evaluated (±6 days), not
   * trailing-only. A single forward greedy pass only knows about shifts
   * already assigned *before* the candidate in date order — checking just
   * the candidate's own backward-looking window lets a later assignment
   * retroactively push an earlier one over the limit (e.g. day 26 and day 27
   * each look fine 6 days back, but day 19..28 combined isn't).
   *
   * Fix: whenever a candidate is added, re-verify every already-assigned
   * shift within reach of it too — not just the candidate's own window.
   * Each such shift already passed its own check without this candidate; the
   * only thing that changed is this candidate now also falls inside it.
   * Checking all of them here, every time, maintains the invariant
   * inductively: by the time a later shift is being added, every earlier
   * shift's window was already re-verified against everything before it.
   */
  private _wouldExceedWeeklyHours(emp: Employee, shift: Shift, ctx: CandidateContext): boolean {
    if (!emp.max_hours_per_week) return false;
    const shiftsById = this._getShiftsById(ctx.allShifts);
    const assigned = [...ctx.assignedShiftIds]
      .map((id) => shiftsById.get(id))
      .filter((s): s is Shift => s !== undefined);

    const withinWeek = (a: Shift, b: Shift): boolean =>
      Math.abs(dateToMs(a.date) - dateToMs(b.date)) / 86_400_000 < 7;

    const anchors = [shift, ...assigned.filter((s) => withinWeek(s, shift))];
    for (const anchor of anchors) {
      let total = shiftHours(anchor);
      for (const other of assigned) {
        if (other !== anchor && withinWeek(anchor, other)) total += shiftHours(other);
      }
      if (anchor !== shift && withinWeek(anchor, shift)) total += shiftHours(shift);
      if (total > emp.max_hours_per_week) return true;
    }
    return false;
  }

  /**
   * Whether pairing rules permit this employee to join a shift.
   *
   * `apart` is checkable incrementally: if the other person is already on the
   * shift, refuse.
   *
   * `requires` has a LIMITATION WORTH STATING. The greedy assigns in order and
   * cannot look ahead, so a dependent is only placed if the person they depend
   * on is ALREADY on the shift. Where CP-SAT would pair them by choosing both
   * together, the greedy may leave the dependent unassigned and the shift
   * short. That is conservative — it never produces an illegal schedule — and
   * it is the same class of limitation as the greedy's inability to balance
   * workload: a consequence of having no global view, which is why a greedy
   * result is always signalled as such.
   */
  private _pairingAllows(
    employeeId: string,
    onThisShift: Set<string>,
    pairings: OptimizationProblem['pairings']
  ): boolean {
    for (const rule of pairings ?? []) {
      if (rule.kind === 'apart') {
        if (rule.employee_id === employeeId && onThisShift.has(rule.other_id)) return false;
        if (rule.other_id === employeeId && onThisShift.has(rule.employee_id)) return false;
      } else if (rule.employee_id === employeeId && !onThisShift.has(rule.other_id)) {
        return false;
      }
    }
    return true;
  }

  private _wouldExceedConsecutiveDays(emp: Employee, shift: Shift, ctx: CandidateContext): boolean {
    if (!emp.max_consecutive_days) return false;
    const shiftsById = this._getShiftsById(ctx.allShifts);
    const workedDates = new Set<string>([shift.date]);
    for (const shiftId of ctx.assignedShiftIds) {
      const assigned = shiftsById.get(shiftId);
      if (assigned) workedDates.add(assigned.date);
    }
    const sortedMs = [...workedDates].map((d) => dateToMs(d)).sort((a, b) => a - b);

    let longestRun = 1;
    let currentRun = 1;
    for (let i = 1; i < sortedMs.length; i++) {
      const dayGap = (sortedMs[i] - sortedMs[i - 1]) / 86_400_000;
      currentRun = dayGap === 1 ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
    }
    return longestRun > emp.max_consecutive_days;
  }



  private _wouldViolateMinRest(shift: Shift, ctx: CandidateContext): boolean {
    const [candStart, candEnd] = shiftBoundsMs(shift);
    const shiftsById = this._getShiftsById(ctx.allShifts);
    for (const shiftId of ctx.assignedShiftIds) {
      const other = shiftsById.get(shiftId);
      if (!other) continue;
      const [otherStart, otherEnd] = shiftBoundsMs(other);
      let restMs: number;
      if (candEnd <= otherStart) restMs = otherStart - candEnd;
      else if (otherEnd <= candStart) restMs = candStart - otherEnd;
      else continue; // overlap is handled by _hasOverlappingShift, not double-flagged here
      if (restMs / 3_600_000 < ctx.minRestHoursBetweenShifts) return true;
    }
    return false;
  }

  /**
   * Generate a greedy schedule.
   *
   * Used directly by AutoScheduleService when OPTIMIZATION_ENGINE is not
   * 'or-tools', and as the automatic fallback inside optimize() when Python
   * is unavailable.
   *
   * Algorithm: O(shifts × employees). For each shift (earliest-first), pick
   * the first employees that pass evaluateCandidate(), up to min_staff. This
   * is deterministic and reproducible given the same input ordering.
   *
   * Known limitations:
   * - No backtracking — a locally greedy choice may block a later shift from
   *   being staffed. The CP-SAT path handles this globally.
   * - Same-day overlap detection (_hasOverlappingShift) only compares shifts
   *   sharing the same date, so an overnight shift is checked against
   *   same-date shifts but not a next-day shift it spills into. This is a
   *   separate concern from minimum rest between shifts, which
   *   _wouldViolateMinRest does check across day boundaries.
   */
  async generateGreedySchedule(problem: OptimizationProblem): Promise<ScheduleAssignment[]> {
    logger.info('Generating greedy schedule as fallback');

    const assignments: ScheduleAssignment[] = [];

    // Sort shifts by date and time so earlier shifts are filled first
    const sortedShifts = [...problem.shifts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start_time.localeCompare(b.start_time);
    });

    // Synthetic stubs for each employee's assignments on *other* schedules
    // (see Employee.existing_assignments) — included in the lookup table so
    // overlap/rest/weekly-hours/consecutive-days checks see them, but never
    // added to sortedShifts, so they're never themselves up for assignment.
    const externalShiftsByEmployee = new Map<string, Shift[]>();
    const externalShifts: Shift[] = [];
    for (const emp of problem.employees) {
      const stubs = (emp.existing_assignments ?? []).map((a, i) => ({
        id: `ext:${emp.id}:${i}`,
        date: a.date,
        start_time: a.start_time,
        end_time: a.end_time,
        min_staff: 0,
        max_staff: 0,
      }));
      externalShiftsByEmployee.set(emp.id, stubs);
      externalShifts.push(...stubs);
    }
    const allShiftsForLookup = [...sortedShifts, ...externalShifts];

    // Track which shift IDs each employee has been assigned to (for overlap detection)
    const employeeAssignments = new Map<string, Set<string>>();
    problem.employees.forEach((emp) =>
      employeeAssignments.set(emp.id, new Set(externalShiftsByEmployee.get(emp.id)!.map((s) => s.id)))
    );

    // Track hours already assigned per employee per date ("empId|date" -> hours)
    const dailyHoursMap = new Map<string, number>();
    for (const emp of problem.employees) {
      for (const stub of externalShiftsByEmployee.get(emp.id) ?? []) {
        const key = `${emp.id}|${stub.date}`;
        dailyHoursMap.set(key, (dailyHoursMap.get(key) ?? 0) + shiftHours(stub));
      }
    }

    const minRestHoursBetweenShifts: number =
      typeof problem.constraints?.min_hours_between_shifts === 'number'
        ? problem.constraints.min_hours_between_shifts
        : 8;

    // Assign employees to shifts greedily
    for (const shift of sortedShifts) {
      // Candidate filtering: exclude employees that violate any constraint
      // independent of assignment order (unavailability, skills, overlap,
      // daily budget). The max_staff check is enforced per-assignment below.
      const candidates = problem.employees.filter((emp) =>
        this.evaluateCandidate(emp, {
          shift,
          assignedShiftIds: employeeAssignments.get(emp.id)!,
          allShifts: allShiftsForLookup,
          dailyHoursMap,
          minRestHoursBetweenShifts,
          // Pass 0 here — max_staff is re-enforced in the assignment loop below
          // so we collect all eligible candidates first.
          currentShiftAssignmentCount: 0,
          // Empty for the same reason: this pass only decides eligibility that
          // is independent of who else is chosen. Pairing is not, so it is
          // checked in the assignment loop instead.
          currentShiftAssignees: new Set<string>(),
        })
      );

      // Assign up to min_staff employees, never exceeding max_staff
      const staffCap = shift.max_staff !== undefined ? shift.max_staff : shift.min_staff;
      const toAssign = Math.min(candidates.length, shift.min_staff, staffCap);
      // Who is on this shift so far. Pairing is the first rule that depends on
      // it, so it cannot be decided in the eligibility pass above.
      const onThisShift = new Set<string>();
      let placed = 0;
      for (let i = 0; i < candidates.length && placed < toAssign; i++) {
        const emp = candidates[i];
        if (!this._pairingAllows(emp.id, onThisShift, problem.pairings)) continue;
        onThisShift.add(emp.id);
        placed += 1;
        const hours = shiftHours(shift);

        assignments.push({
          employeeId: emp.id,
          shiftId: shift.id,
          date: shift.date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          hours,
        });

        // Two different constraints, so two different indexes: employeeAssignments
        // (which shifts this employee already holds) feeds the overlap check above,
        // while dailyHoursMap (cumulative hours per employee per day) feeds the
        // max-daily-hours check elsewhere in this loop — neither can be derived
        // from the other without re-scanning `assignments`.
        employeeAssignments.get(emp.id)!.add(shift.id);
        const dailyKey = `${emp.id}|${shift.date}`;
        dailyHoursMap.set(dailyKey, (dailyHoursMap.get(dailyKey) ?? 0) + hours);
      }
    }

    logger.info(`Greedy schedule generated: ${assignments.length} assignments`);
    return assignments;
  }

  private _hasOverlappingShift(
    shift: Shift,
    assignedShiftIds: Set<string>,
    allShifts: Shift[]
  ): boolean {
    const shiftsById = this._getShiftsById(allShifts);
    for (const shiftId of assignedShiftIds) {
      const assignedShift = shiftsById.get(shiftId);
      if (assignedShift && assignedShift.date === shift.date) {
        if (
          this._timesOverlap(
            shift.start_time,
            shift.end_time,
            assignedShift.start_time,
            assignedShift.end_time
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private _timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
    const s1 = timeToMinutes(start1);
    let e1 = timeToMinutes(end1);
    const s2 = timeToMinutes(start2);
    let e2 = timeToMinutes(end2);

    // Normalize overnight ranges (e.g. 22:00–06:00) so a shift crossing
    // midnight is still detected as overlapping same-date shifts.
    if (e1 <= s1) e1 += 24 * 60;
    if (e2 <= s2) e2 += 24 * 60;

    return !(e1 <= s2 || e2 <= s1);
  }


}
