/**
 * The problem shape both scheduling engines speak, extracted so the canonical
 * constraint definition does not depend on a consumer of it.
 *
 * WHY THIS MODULE EXISTS. `constraintValidator.ts` is the single source of
 * truth for what a legal schedule is, and it needs `OptimizationProblem` to
 * express that. That type used to live in `ScheduleOptimizerORTools.ts`, so the
 * validator imported from the optimizer — harmless while the arrow pointed one
 * way, but it made the reverse impossible: the optimizer could not use the
 * validator's own `coverageShortfalls` to report understaffing without closing
 * a circular dependency, and would have had to restate what "understaffed"
 * means. A second definition of a rule the validator exists to own is exactly
 * the drift this file prevents.
 *
 * Shapes here are snake_case because they are the JSON wire format handed to
 * the Python CP-SAT solver. `ScheduleAssignment` is camelCase because it is the
 * TypeScript-side result. That asymmetry is deliberate rather than an
 * oversight: renaming either side would mean translating at a boundary that
 * currently needs none.
 *
 * @author Luca Ostinelli
 */

export interface ScheduleAssignment {
  employeeId: string;
  shiftId: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
}

export interface OptimizationConfig {
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

export interface Employee {
  id: string;
  max_hours_per_week: number;
  min_hours_per_week?: number;
  /**
   * Daily hours cap, from the employee's contract.
   *
   * Optional only for the transition: every engine used to DERIVE this as
   * `max(8, max_hours_per_week / 5)` — a formula that appeared in no contract,
   * no policy table and no documentation as a decision, yet was enforced as a
   * hard constraint against real people. When absent the old formula is still
   * applied, so a caller that has not been migrated behaves exactly as before;
   * when present the contract's stored value wins.
   */
  max_hours_per_day?: number;
  skills: string[];
  unavailable_dates: string[];
  max_consecutive_days?: number;
  /**
   * Shifts this employee already holds on *other* schedules, within reach of
   * this problem's rolling-window checks. Without these, back-to-back
   * schedule periods get optimized in total isolation — each can look
   * individually compliant while an employee assigned late in one period and
   * early in the next quietly busts max-consecutive-days/max-weekly-hours
   * across the boundary. Counted toward those checks but never themselves
   * reassignable (they aren't part of `problem.shifts`).
   */
  existing_assignments?: Array<{ date: string; start_time: string; end_time: string }>;
}

export interface Shift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  min_staff: number;
  max_staff?: number;
  required_skills?: string[];
}

export interface Preference {
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
