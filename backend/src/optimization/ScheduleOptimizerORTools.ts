/**
 * Staff Schedule Optimization Engine - OR-Tools Integration
 *
 * Wrapper for Python OR-Tools CP-SAT solver with a TypeScript greedy fallback.
 *
 * Architecture:
 * - TypeScript prepares problem data (shifts, employees, preferences, constraints)
 * - Calls Python script with OR-Tools CP-SAT solver via child_process
 * - Python script returns optimal/feasible solution
 * - On Python failure (not installed, timeout, non-zero exit) or a solver
 *   status that carries no schedule (anything but OPTIMAL/FEASIBLE), optimize()
 *   falls back to the TypeScript greedy solver automatically
 *
 * Greedy algorithm complexity: O(shifts × employees) per run.
 *
 * Constraints enforced by the greedy fallback (see evaluateCandidate, in
 * evaluation order — the numbering matches that method's inline comments):
 *   1. Staff cap — assignments per shift are capped at max_staff
 *   2. No double-booking — absolute-time overlap, across midnight and against
 *      external assignments
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
import { coverageShortfalls, findOverCommitments, minRestHoursFor } from './constraintValidator';
// The overnight-aware time arithmetic these engines share. It used to be four
// private helpers here and equivalent copies in constraintValidator, kept in
// step by a comment — see ./shiftTime for why that was not good enough.
import { dateToMs, exceedsHours, shiftBoundsMs, shiftHours, shiftMinutes } from './shiftTime';
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

/**
 * Every status schedule_optimizer.py can report with a parsed result (exit 0
 * or 1). Only the first two carry a schedule; the rest come back with no
 * assignments at all.
 */
type SolverStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'MODEL_INVALID' | 'UNKNOWN';

interface SolverResult extends Omit<OptimizationResult, 'status'> {
  status: SolverStatus;
}

/**
 * What optimize() returns. Deliberately NOT a superset of SolverStatus: a
 * solver status without a schedule is turned into GREEDY_FALLBACK inside
 * optimize(), so no caller can mistake an empty answer for the optimum (#811).
 */
interface OptimizationResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'ERROR' | 'GREEDY_FALLBACK';
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
  /**
   * Minutes already scheduled per employee per date key "empId|date".
   * Minutes, not hours: rounded hours drift when summed (see shiftMinutes).
   */
  dailyMinutesMap: Map<string, number>;
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
  /**
   * Minimum rest hours this employee needs between two shifts — their own
   * requirement (see `minRestHoursFor`), as ComplianceEngine resolves it.
   */
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
 *
 * EVERY FIELD IS MAPPED; NOTHING IS SPREAD. The result used to start with
 * `...raw`, which carried the script's snake_case `assignments`
 * (`employee_id`, `shift_id`, `start_time`, …), `objective_value` and
 * `solve_time_seconds` through under a type promising camelCase. Every CP-SAT
 * plan therefore reached AutoScheduleService with undefined ids and was
 * persisted as NaN (#919); the greedy path builds camelCase itself, which is
 * why nothing noticed while production ran greedy only. With no spread, a key
 * the solver adds later is absent until it is mapped here, rather than present
 * under the wrong name.
 */
const mapPythonResult = (raw: Record<string, unknown>): SolverResult => {
  const stats = (raw.statistics ?? {}) as Record<string, unknown>;
  const coverage = (stats.coverage_stats ?? {}) as Record<string, unknown>;
  const understaffed = (coverage.understaffed_shifts ?? []) as Array<Record<string, unknown>>;

  return {
    status: raw.status as SolverStatus,
    objectiveValue: typeof raw.objective_value === 'number' ? raw.objective_value : undefined,
    solveTimeSeconds: typeof raw.solve_time_seconds === 'number' ? raw.solve_time_seconds : 0,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    assignments: ((raw.assignments ?? []) as Array<Record<string, unknown>>).map((a) => ({
      employeeId: String(a.employee_id),
      shiftId: String(a.shift_id),
      date: String(a.date),
      startTime: String(a.start_time),
      endTime: String(a.end_time),
      hours: Number(a.hours),
    })),
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

/** How long a child that was sent SIGTERM gets to exit before SIGKILL. */
export const KILL_GRACE_MS = 5000;

/**
 * Ceiling on the solver's stdout. Its result is one JSON document whose size
 * grows with the assignments: a 100-employee, 336-shift month is well under
 * 2 MB. Sixty-four is far beyond any legitimate result and far below what
 * would threaten the backend's heap.
 */
export const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/**
 * How long after a failed write to the solver's stdin the run waits for the
 * child's own exit before giving up on it: long enough for a crashing python
 * to flush its traceback and exit.
 */
export const STDIN_ERROR_GRACE_MS = 2000;

/** How much of the solver's stderr is kept, from the end, as a crash reason. */
export const MAX_STDERR_TAIL_CHARS = 64 * 1024;

/** The least of the watchdog kept back from the solver's budget, in ms. */
const MIN_SOLVER_MARGIN_MS = 5000;

/** The share of the watchdog kept back from the solver's budget. */
const SOLVER_MARGIN_SHARE = 0.1;

/**
 * The `--time-limit` handed to the solver: the watchdog minus a margin, in
 * whole seconds, and never more than a caller asked for.
 *
 * WHY IT IS NOT THE WATCHDOG ITSELF. The limit used to be 300 s against a
 * 300 000 ms watchdog, while the script spent part of that building its model
 * before searching at all — so a run that searched to its limit was always
 * killed first and degraded to greedy, throwing away the feasible solution it
 * was about to return (#837).
 *
 * The limit is the script's TOTAL budget. The model build, whose length
 * depends on the instance and cannot be estimated from here, is the script's
 * to subtract: it measures its own build time and searches only for what is
 * left (`solve_time_budget` in schedule_optimizer.py). What this margin covers
 * is what happens outside that budget — the interpreter and ortools import
 * before the clock starts, CP-SAT stopping slightly after its limit, and the
 * result's serialisation, transfer and parse. A tenth of the watchdog, and at
 * least five seconds, leaves room for all of it at every size this runs at.
 */
export const solverTimeLimitSeconds = (watchdogMs: number, requestedSeconds?: number): number => {
  const margin = Math.max(MIN_SOLVER_MARGIN_MS, watchdogMs * SOLVER_MARGIN_SHARE);
  const available = Math.floor((watchdogMs - margin) / 1000);
  const limit = requestedSeconds === undefined ? available : Math.min(requestedSeconds, available);
  return Math.max(1, limit);
};

/** The `error` of the script's ERROR JSON, or undefined when stdout is not one. */
const errorReason = (stdout: string): string | undefined => {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
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
   * the process times out, the process exits with a code other than 0 or 1,
   * or the solver finishes with a status that carries no schedule.
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
        solverTimeLimitSeconds(config.optimization.timeout, optimizationConfig.timeLimitSeconds)
      );

      const elapsedTime = (Date.now() - startTime) / 1000;

      logger.info(`Optimization completed in ${elapsedTime.toFixed(2)}s`);
      logger.info(`Status: ${result.status}, Assignments: ${result.assignments.length}`);

      // Only these two statuses come with a schedule. INFEASIBLE, UNKNOWN (time
      // limit hit before any solution) and MODEL_INVALID all arrive with zero
      // assignments, and passing them through handed the planner an empty
      // schedule as an or-tools success (#811). Thrown so they take the SAME
      // signalled fallback as a missing python3, rather than a second path
      // every caller would have to know to check for.
      if (result.status !== 'OPTIMAL' && result.status !== 'FEASIBLE') {
        throw new Error(
          `OR-Tools solver finished with status ${result.status} and no schedule` +
            (result.error ? `: ${result.error}` : '')
        );
      }

      if (result.statistics.coverageStats) {
        logger.info(`Coverage: ${result.statistics.coverageStats.coveragePercentage.toFixed(1)}%`);
      }

      return { ...result, status: result.status };
    } catch (error) {
      // Python not installed, process timed out, non-zero exit, or a solver
      // status without a schedule — fall back to the TypeScript greedy solver
      // so callers always get a usable result.
      const reason = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`OR-Tools optimizer produced no schedule (${reason}); falling back to greedy solver`);

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
  ): Promise<SolverResult> {
    return new Promise((resolve, reject) => {
      // Spawn Python process
      const pythonProcess = spawn('python3', [
        this.pythonScriptPath,
        '--stdin',
        '--stdout',
        '--time-limit',
        timeLimitSeconds.toString(),
      ]);

      // stdout is collected as raw chunks and decoded once: decoding each
      // chunk on its own splits a multi-byte character that straddles two
      // chunks, and string concatenation copies the whole buffer per chunk.
      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrTail = '';
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let stdinError: Error | undefined;
      let stdinErrorHandle: ReturnType<typeof setTimeout> | undefined;

      // Ensure the Promise settles exactly once and the timers are always
      // cleared, so neither can fire after the process has finished.
      const finalize = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        if (stdinErrorHandle) clearTimeout(stdinErrorHandle);
        action();
      };

      // Whether the child is still running. NOT `pythonProcess.killed`: that
      // flag turns true as soon as kill() has DELIVERED a signal, not when the
      // process exits, so the old `if (!killed) kill('SIGKILL')` after a
      // SIGTERM could never fire — a solver ignoring SIGTERM ran on unbounded
      // (#836). exitCode/signalCode stay null until the process has gone.
      const stillRunning = (): boolean =>
        pythonProcess.exitCode === null && pythonProcess.signalCode === null;

      // Request graceful termination, then force-kill if it ignores SIGTERM.
      const terminate = (): void => {
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (stillRunning()) pythonProcess.kill('SIGKILL');
        }, KILL_GRACE_MS).unref?.();
      };

      // Watchdog: kill the process and reject if it never settles, so a
      // hanging Python optimizer cannot leak the child process forever.
      const timeoutMs = config.optimization.timeout;
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        logger.error(`Python optimizer timed out after ${timeoutMs}ms; killing process`);
        terminate();
        finalize(() => reject(new Error(`Python optimizer timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      timeoutHandle.unref?.();

      // Collect stdout (JSON result), bounded. A runaway or corrupted child
      // printing without end would otherwise grow this buffer until the
      // backend itself ran out of memory; past the cap the output cannot be a
      // result anyone should parse, so the run is abandoned to the fallback.
      pythonProcess.stdout.on('data', (data: Buffer) => {
        if (settled) return;
        stdoutBytes += data.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          logger.error(`Python optimizer output exceeded ${MAX_STDOUT_BYTES} bytes; killing process`);
          terminate();
          finalize(() =>
            reject(new Error(`Python optimizer output exceeded ${MAX_STDOUT_BYTES} bytes`))
          );
          return;
        }
        stdoutChunks.push(data);
      });

      // Collect stderr (logs). Only the tail is kept: stderr is a progress
      // log, read solely as the reason for a crash that wrote no JSON, and a
      // crash's reason (a traceback) is at its end.
      pythonProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        stderrTail = (stderrTail + message).slice(-MAX_STDERR_TAIL_CHARS);
        // Log Python script output
        logger.debug(`[Python Optimizer] ${message.trim()}`);
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
        const stderrData = stderrTail;
        finalize(() => {
          if (code === 0 || code === 1) {
            // A parsed result: a schedule (0) or a status without one (1),
            // which optimize() turns into the greedy fallback.
            try {
              resolve(mapPythonResult(JSON.parse(stdoutData)));
            } catch (parseError) {
              // No JSON: the child died before answering (python exits 1 on
              // an import error), so its stderr is the reason, not the parse.
              const parseReason = parseError instanceof Error ? parseError.message : 'Unknown error';
              reject(
                new Error(
                  `Failed to parse optimizer output (exit ${code}): ${stderrData.trim() || stdinError?.message || parseReason}`
                )
              );
            }
          } else {
            // Non-zero exit — treat as hard error so optimize() can fall back.
            // With --stdout the script writes its ERROR JSON (and so the
            // actual reason, e.g. an objective overflow) to stdout; stderr is
            // only its progress log. Rejecting with stderr alone handed the
            // planner "Building CP-SAT model..." as the reason for a degraded
            // run. stderr stays the fallback for a crash that wrote no JSON.
            reject(
              new Error(
                `Optimizer failed with code ${code}: ${errorReason(stdoutData) ?? (stderrData || stdinError?.message)}`
              )
            );
          }
        });
      });

      // Handle process errors (e.g. python3 not found / ENOENT)
      pythonProcess.on('error', (err) => {
        finalize(() => reject(new Error(`Failed to start Python optimizer: ${err.message}`)));
      });

      // A child that exits before reading all of its input (python3 without
      // ortools fails on import) closes the pipe while a problem larger than
      // the pipe buffer is still being written, and the write fails with
      // EPIPE. With no listener, a stream 'error' is THROWN by the emitter —
      // as an uncaught exception that took the whole backend down rather than
      // this one run (#836). Handled here, it is one more reason to fall back.
      //
      // RECORDED, NOT SETTLED ON. The EPIPE almost always arrives before the
      // child's 'close', and settling on it made every such run's degraded
      // reason "write EPIPE" — true, and useless — while the reason the child
      // gave on stderr ("ModuleNotFoundError: No module named 'ortools'") was
      // dropped. 'close' settles with that stderr; the timer only covers a
      // child that keeps running after closing its stdin.
      pythonProcess.stdin.on('error', (err) => {
        stdinError = err;
        stdinErrorHandle = setTimeout(
          () => finalize(() => reject(new Error(`Failed to send the problem to the Python optimizer: ${err.message}`))),
          STDIN_ERROR_GRACE_MS
        );
        stdinErrorHandle.unref?.();
      });

      // Send problem data to stdin
      pythonProcess.stdin.end(JSON.stringify(problem));
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
    const { shift, assignedShiftIds, allShifts, dailyMinutesMap, currentShiftAssignmentCount } = ctx;

    // 1. Staff cap — never exceed max_staff for this shift
    if (shift.max_staff !== undefined && currentShiftAssignmentCount >= shift.max_staff) {
      return false;
    }

    // 2. No double-booking — reject if already on an overlapping shift, whatever
    //    date either starts on
    if (this._hasOverlappingShift(shift, assignedShiftIds, allShifts)) {
      return false;
    }

    // 2b. Minimum rest between shifts — same rule as ComplianceEngine's
    //     checkMinRest, e.g. an overnight shift ending 07:00 followed
    //     immediately by a 07:00 shift the next day does not overlap
    //     but is a real rest-hours violation.
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
    // Exact minutes: three 2h40 shifts are 8h, which per-shift rounded hours
    // read as 8.1h and refused (#834).
    const dailyKey = `${emp.id}|${shift.date}`;
    const minutesAlreadyToday = dailyMinutesMap.get(dailyKey) ?? 0;
    if (exceedsHours(minutesAlreadyToday + shiftMinutes(shift), dailyBudget)) {
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
      let totalMinutes = shiftMinutes(anchor);
      for (const other of assigned) {
        if (other !== anchor && withinWeek(anchor, other)) totalMinutes += shiftMinutes(other);
      }
      if (anchor !== shift && withinWeek(anchor, shift)) totalMinutes += shiftMinutes(shift);
      if (exceedsHours(totalMinutes, emp.max_hours_per_week)) return true;
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
      // Overlapping: no rest at all. This used to `continue`, on the
      // assumption that the overlap check had already refused the pair — but
      // that check only compared same-date shifts, so a cross-midnight
      // overlap passed both and was assigned (#835). Refusing here too means
      // this rule no longer depends on the other one being complete.
      else return true;
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

    // Track minutes already assigned per employee per date ("empId|date" -> minutes)
    const dailyMinutesMap = new Map<string, number>();
    for (const emp of problem.employees) {
      for (const stub of externalShiftsByEmployee.get(emp.id) ?? []) {
        const key = `${emp.id}|${stub.date}`;
        dailyMinutesMap.set(key, (dailyMinutesMap.get(key) ?? 0) + shiftMinutes(stub));
      }
    }

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
          dailyMinutesMap,
          // The employee's own rest requirement, by the validator's rule.
          minRestHoursBetweenShifts: minRestHoursFor(problem, emp),
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
        // while dailyMinutesMap (cumulative minutes per employee per day) feeds
        // the max-daily-hours check elsewhere in this loop — neither can be
        // derived from the other without re-scanning `assignments`.
        employeeAssignments.get(emp.id)!.add(shift.id);
        const dailyKey = `${emp.id}|${shift.date}`;
        dailyMinutesMap.set(dailyKey, (dailyMinutesMap.get(dailyKey) ?? 0) + shiftMinutes(shift));
      }
    }

    logger.info(`Greedy schedule generated: ${assignments.length} assignments`);
    return assignments;
  }

  /**
   * Whether the candidate overlaps anything the employee already holds,
   * external assignments included, compared on absolute bounds.
   *
   * It used to compare only shifts sharing a start DATE, on times of day. A
   * 22:00–06:00 night shift and the next day's 05:00–13:00 start on different
   * dates, so the pair was never compared and both went to one person — and
   * the same for a night shift held on another schedule (#835). Absolute
   * bounds are what the validator and CP-SAT already compare, so this is the
   * same rule rather than a closer approximation of it; there is no "same
   * day" left to get wrong.
   */
  private _hasOverlappingShift(
    shift: Shift,
    assignedShiftIds: Set<string>,
    allShifts: Shift[]
  ): boolean {
    const shiftsById = this._getShiftsById(allShifts);
    const [start, end] = shiftBoundsMs(shift);
    for (const shiftId of assignedShiftIds) {
      const other = shiftsById.get(shiftId);
      if (!other) continue;
      const [otherStart, otherEnd] = shiftBoundsMs(other);
      if (start < otherEnd && otherStart < end) return true;
    }
    return false;
  }


}
