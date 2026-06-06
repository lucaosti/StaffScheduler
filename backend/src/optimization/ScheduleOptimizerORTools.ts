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
 * Constraints enforced by the greedy fallback (in priority order):
 *   1. Skill requirements — employee must hold every skill the shift demands
 *   2. Declared unavailability — date-level blocks from user_unavailability
 *   3. No double-booking — time-overlap detection within a calendar day
 *   4. Daily hours cap — total hours already assigned on that date must not
 *      exceed the employee's daily budget (max_hours_per_week / 5)
 *   5. Staff cap — assignments per shift are capped at max_staff
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

interface ScheduleAssignment {
  employeeId: string;
  shiftId: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
}

interface OptimizationConfig {
  timeLimitSeconds?: number;

  // Constraint weights (inspired by PoliTO Parameters.py)
  weights?: {
    shiftCoverage?: number;       // Default: 100
    noDoubleBooking?: number;     // Default: 90
    skillRequirements?: number;   // Default: 85
    availability?: number;        // Default: 80
    maxHoursPerWeek?: number;     // Default: 75
    employeePreferences?: number; // Default: 55 (like teaching_overlaps_penalty)
    workloadFairness?: number;    // Default: 40
    consecutiveDays?: number;     // Default: 30
    restPeriods?: number;         // Default: 25
    shiftContinuity?: number;     // Default: 20
  };
}

interface Employee {
  id: string;
  max_hours_per_week: number;
  min_hours_per_week?: number;
  skills: string[];
  unavailable_dates: string[];
  max_consecutive_days?: number;
}

interface Shift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  min_staff: number;
  max_staff?: number;
  required_skills?: string[];
}

interface Preference {
  employee_id: string;
  preferred_shifts: string[];
  avoid_shifts: string[];
}

export interface OptimizationProblem {
  shifts: Shift[];
  employees: Employee[];
  preferences?: Record<string, Preference>;
  skills?: Record<string, string[]>;
  constraints?: Record<string, any>;
  weights?: Record<string, number>;
}

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
    };
  };
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
}

export class ScheduleOptimizer {
  private pythonScriptPath: string;

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

        return {
          status: 'GREEDY_FALLBACK',
          solveTimeSeconds: elapsedTime,
          assignments: greedy,
          statistics: {
            isOptimal: false,
            totalAssignedShifts: greedy.length,
            coverageStats: {
              totalShifts,
              fullyCoveredShifts: covered,
              coveragePercentage: totalShifts > 0 ? Math.round((covered / totalShifts) * 100) : 0,
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
          statistics: {
            isOptimal: false,
            totalAssignedShifts: 0,
            coverageStats: {
              totalShifts: problem.shifts.length,
              fullyCoveredShifts: 0,
              coveragePercentage: 0,
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
              const result = JSON.parse(stdoutData);
              resolve(result);
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

    // 3. Declared unavailability
    if (emp.unavailable_dates.includes(shift.date)) {
      return false;
    }

    // 4. Skill requirements
    const requiredSkills = shift.required_skills || [];
    const empSkills = new Set(emp.skills);
    for (const skill of requiredSkills) {
      if (!empSkills.has(skill)) {
        return false;
      }
    }

    // 5. Daily hours cap — guard against assigning more hours than a single
    //    workday budget (max_hours_per_week / 5, floored at 8h).
    const dailyBudget = Math.max(8, emp.max_hours_per_week / 5);
    const shiftHours = this._calculateShiftHours(shift);
    const dailyKey = `${emp.id}|${shift.date}`;
    const hoursAlreadyToday = dailyHoursMap.get(dailyKey) ?? 0;
    if (hoursAlreadyToday + shiftHours > dailyBudget) {
      return false;
    }

    return true;
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
   * - Weekly hours are not tracked across the full schedule period; only the
   *   per-day budget is enforced here.
   */
  async generateGreedySchedule(problem: OptimizationProblem): Promise<ScheduleAssignment[]> {
    logger.info('Generating greedy schedule as fallback');

    const assignments: ScheduleAssignment[] = [];

    // Sort shifts by date and time so earlier shifts are filled first
    const sortedShifts = [...problem.shifts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start_time.localeCompare(b.start_time);
    });

    // Track which shift IDs each employee has been assigned to (for overlap detection)
    const employeeAssignments = new Map<string, Set<string>>();
    problem.employees.forEach((emp) => employeeAssignments.set(emp.id, new Set()));

    // Track hours already assigned per employee per date ("empId|date" -> hours)
    const dailyHoursMap = new Map<string, number>();

    // Assign employees to shifts greedily
    for (const shift of sortedShifts) {
      // Candidate filtering: exclude employees that violate any constraint
      // independent of assignment order (unavailability, skills, overlap,
      // daily budget). The max_staff check is enforced per-assignment below.
      const candidates = problem.employees.filter((emp) =>
        this.evaluateCandidate(emp, {
          shift,
          assignedShiftIds: employeeAssignments.get(emp.id)!,
          allShifts: sortedShifts,
          dailyHoursMap,
          // Pass 0 here — max_staff is re-enforced in the assignment loop below
          // so we collect all eligible candidates first.
          currentShiftAssignmentCount: 0,
        })
      );

      // Assign up to min_staff employees, never exceeding max_staff
      const staffCap = shift.max_staff !== undefined ? shift.max_staff : shift.min_staff;
      const toAssign = Math.min(candidates.length, shift.min_staff, staffCap);
      for (let i = 0; i < toAssign; i++) {
        const emp = candidates[i];
        const shiftHours = this._calculateShiftHours(shift);

        assignments.push({
          employeeId: emp.id,
          shiftId: shift.id,
          date: shift.date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          hours: shiftHours,
        });

        // Update tracking state
        employeeAssignments.get(emp.id)!.add(shift.id);
        const dailyKey = `${emp.id}|${shift.date}`;
        dailyHoursMap.set(dailyKey, (dailyHoursMap.get(dailyKey) ?? 0) + shiftHours);
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
    for (const shiftId of assignedShiftIds) {
      const assignedShift = allShifts.find((s) => s.id === shiftId);
      if (assignedShift && assignedShift.date === shift.date) {
        // Check time overlap
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
    const s1 = this._timeToMinutes(start1);
    const e1 = this._timeToMinutes(end1);
    const s2 = this._timeToMinutes(start2);
    const e2 = this._timeToMinutes(end2);

    return !(e1 <= s2 || e2 <= s1);
  }

  private _timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private _calculateShiftHours(shift: Shift): number {
    const start = this._timeToMinutes(shift.start_time);
    let end = this._timeToMinutes(shift.end_time);

    // Handle overnight shifts
    if (end < start) end += 24 * 60;

    return Math.round(((end - start) / 60) * 10) / 10; // Round to 1 decimal
  }
}
