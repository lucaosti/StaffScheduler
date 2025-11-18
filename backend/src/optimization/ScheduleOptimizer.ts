/**
 * Staff Schedule Optimization Engine
 * 
 * Advanced constraint satisfaction and optimization algorithm for generating
 * optimal workforce schedules while respecting business constraints and 
 * employee preferences.
 * 
 * Uses a hybrid approach inspired by PoliTO Timetable Allocator:
 * 1. Constraint satisfaction (CSP) for feasibility
 * 2. Simulated annealing for optimization
 * 3. Greedy initialization for quick feasible solutions
 * 4. Weighted constraint system with configurable priorities
 * 5. Objective function balancing multiple soft constraints
 * 
 * @author Luca Ostinelli
 * @inspiration PoliTO_Timetable_Allocator constraint programming approach
 */

interface Constraint {
  type: 'hard' | 'soft';
  name: string;
  priority: number;
  weight: number; // Weight in objective function (0-100)
  enabled: boolean; // Can be disabled dynamically
  validate: (schedule: ScheduleAssignment[]) => boolean;
  penalty: (schedule: ScheduleAssignment[]) => number;
}

interface ScheduleAssignment {
  employeeId: string;
  shiftId: string;
  date: Date;
  startTime: string;
  endTime: string;
  departmentId: string;
}

interface OptimizationConfig {
  startDate: Date;
  endDate: Date;
  temperature: number;
  coolingRate: number;
  maxIterations: number;
  timeoutMs: number;
  
  // Constraint weight configuration (inspired by PoliTO Parameters.py)
  weights: {
    // Hard constraints (violations must be avoided)
    shiftCoverageWeight: number;           // Default: 100 (critical)
    noDoubleBookingWeight: number;         // Default: 90
    skillRequirementsWeight: number;       // Default: 85
    availabilityWeight: number;            // Default: 80
    maxHoursPerWeekWeight: number;         // Default: 75
    minHoursPerWeekWeight: number;         // Default: 70
    restPeriodsWeight: number;             // Default: 65
    
    // Soft constraints (for optimization)
    employeePreferencesWeight: number;     // Default: 55 (similar to teaching_overlaps_penalty)
    workloadFairnessWeight: number;        // Default: 40
    consecutiveDaysWeight: number;         // Default: 30
    lectureDispersionWeight: number;       // Default: 25 (from PoliTO lecture_dispersion_penalty)
    shiftContinuityWeight: number;         // Default: 20
    skillDiversityWeight: number;          // Default: 15
    departmentBalanceWeight: number;       // Default: 10
  };
  
  // Operational parameters
  parameters: {
    maxConsecutiveWorkDays: number;        // Default: 5 (similar to max_consecutive_slots_teaching)
    minRestHoursBetweenShifts: number;     // Default: 11 (EU Working Time Directive)
    maxHoursPerDay: number;                // Default: 12
    targetHoursPerWeek: number;            // Default: 40
    maxOvertimePerMonth: number;           // Default: 20
    preferredDoubleShifts: boolean;        // Default: true (from PoliTO double slot preferences)
  };
}

interface EmployeeProfile {
  id: string;
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  skills: string[];
  availableDays: boolean[];
  preferences: {
    preferredShifts: string[];
    avoidShifts: string[];
    maxConsecutiveDays: number;
    minDaysBetweenShifts: number;
  };
  restrictions: {
    unavailableDates: Date[];
    maxOvertimePerMonth: number;
    certifications: string[];
  };
}

interface ShiftRequirement {
  shiftId: string;
  date: Date;
  requiredStaff: number;
  minSkillLevel: number;
  allowedSkills: string[];
  department: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
}

export class ScheduleOptimizer {
  private config: OptimizationConfig;
  private employees: EmployeeProfile[] = [];
  private shifts: ShiftRequirement[] = [];
  private constraints: Constraint[] = [];
  private currentSchedule: ScheduleAssignment[] = [];
  private bestSchedule: ScheduleAssignment[] = [];
  private currentScore: number = Infinity;
  private bestScore: number = Infinity;

  constructor(config?: Partial<OptimizationConfig>) {
    // Default configuration with values inspired by PoliTO Parameters.py
    const defaultWeights = {
      shiftCoverageWeight: 100,
      noDoubleBookingWeight: 90,
      skillRequirementsWeight: 85,
      availabilityWeight: 80,
      maxHoursPerWeekWeight: 75,
      minHoursPerWeekWeight: 70,
      restPeriodsWeight: 65,
      employeePreferencesWeight: 55,
      workloadFairnessWeight: 40,
      consecutiveDaysWeight: 30,
      lectureDispersionWeight: 25,
      shiftContinuityWeight: 20,
      skillDiversityWeight: 15,
      departmentBalanceWeight: 10,
    };

    const defaultParameters = {
      maxConsecutiveWorkDays: 5,
      minRestHoursBetweenShifts: 11,
      maxHoursPerDay: 12,
      targetHoursPerWeek: 40,
      maxOvertimePerMonth: 20,
      preferredDoubleShifts: true,
    };

    this.config = {
      startDate: config?.startDate || new Date(),
      endDate: config?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      temperature: config?.temperature || 100,
      coolingRate: config?.coolingRate || 0.95,
      maxIterations: config?.maxIterations || 10000,
      timeoutMs: config?.timeoutMs || 300000, // 5 minutes
      weights: { ...defaultWeights, ...config?.weights },
      parameters: { ...defaultParameters, ...config?.parameters },
    };

    this.initializeConstraints();
  }

  /**
   * Initialize all constraint rules for schedule validation and optimization
   * Uses configurable weights from the optimization config
   */
  private initializeConstraints(): void {
    this.constraints = [
      // Hard Constraints (must satisfy)
      {
        type: 'hard',
        name: 'shift_coverage',
        priority: 100,
        weight: this.config.weights.shiftCoverageWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateShiftCoverage(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeShiftCoverage(schedule),
      },
      {
        type: 'hard',
        name: 'no_double_booking',
        priority: 90,
        weight: this.config.weights.noDoubleBookingWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateNoDoubleBooking(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeDoubleBooking(schedule),
      },
      {
        type: 'hard',
        name: 'skill_requirements',
        priority: 85,
        weight: this.config.weights.skillRequirementsWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateSkillRequirements(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeSkillRequirements(schedule),
      },
      {
        type: 'hard',
        name: 'availability_constraints',
        priority: 80,
        weight: this.config.weights.availabilityWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateAvailability(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeAvailability(schedule),
      },
      {
        type: 'hard',
        name: 'max_hours_per_week',
        priority: 75,
        weight: this.config.weights.maxHoursPerWeekWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateMaxHoursPerWeek(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeMaxHoursPerWeek(schedule),
      },
      {
        type: 'hard',
        name: 'rest_periods',
        priority: 65,
        weight: this.config.weights.restPeriodsWeight,
        enabled: true,
        validate: (schedule: ScheduleAssignment[]) => this.validateRestPeriods(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeRestPeriods(schedule),
      },
      // Soft Constraints (optimize for)
      {
        type: 'soft',
        name: 'employee_preferences',
        priority: 55,
        weight: this.config.weights.employeePreferencesWeight,
        enabled: true,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizePreferences(schedule),
      },
      {
        type: 'soft',
        name: 'workload_fairness',
        priority: 40,
        weight: this.config.weights.workloadFairnessWeight,
        enabled: true,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeWorkloadImbalance(schedule),
      },
      {
        type: 'soft',
        name: 'consecutive_days',
        priority: 30,
        weight: this.config.weights.consecutiveDaysWeight,
        enabled: true,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeConsecutiveDays(schedule),
      },
      {
        type: 'soft',
        name: 'lecture_dispersion',
        priority: 25,
        weight: this.config.weights.lectureDispersionWeight,
        enabled: true,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeLectureDispersion(schedule),
      },
      {
        type: 'soft',
        name: 'shift_continuity',
        priority: 20,
        weight: this.config.weights.shiftContinuityWeight,
        enabled: true,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeShiftFragmentation(schedule),
      },
    ];
  }

  /**
   * Main optimization algorithm - generates optimal schedule
   */
  public optimize(
    employees: EmployeeProfile[],
    shifts: ShiftRequirement[]
  ): ScheduleAssignment[] {
    this.employees = employees;
    this.shifts = shifts;
    this.currentSchedule = [];
    this.bestSchedule = [];
    this.bestScore = Infinity;
    this.currentScore = Infinity;

    const startTime = Date.now();

    // Phase 1: Greedy initialization for quick feasible solution
    this.currentSchedule = this.greedyInitialization();
    this.currentScore = this.calculateObjectiveScore(this.currentSchedule);
    this.bestSchedule = [...this.currentSchedule];
    this.bestScore = this.currentScore;

    // Phase 2: Simulated annealing optimization
    let temperature = this.config.temperature;
    let iterations = 0;

    while (
      iterations < this.config.maxIterations &&
      Date.now() - startTime < this.config.timeoutMs &&
      temperature > 0.1
    ) {
      // Generate neighbor solution
      const neighborSchedule = this.generateNeighborSolution(this.currentSchedule);
      const neighborScore = this.calculateObjectiveScore(neighborSchedule);

      // Calculate acceptance probability
      const delta = neighborScore - this.currentScore;
      const acceptanceProbability = delta < 0 ? 1 : Math.exp(-delta / temperature);

      // Accept or reject solution
      if (Math.random() < acceptanceProbability) {
        this.currentSchedule = neighborSchedule;
        this.currentScore = neighborScore;

        // Update best solution if improved
        if (neighborScore < this.bestScore) {
          this.bestSchedule = [...neighborSchedule];
          this.bestScore = neighborScore;
        }
      }

      // Cool down temperature
      temperature *= this.config.coolingRate;
      iterations++;
    }

    return this.bestSchedule;
  }

  /**
   * Greedy algorithm for initial feasible solution
   */
  private greedyInitialization(): ScheduleAssignment[] {
    const schedule: ScheduleAssignment[] = [];
    const employeeHours: Map<string, number> = new Map();
    const employeeShiftsPerDay: Map<string, number> = new Map();

    // Initialize counters
    this.employees.forEach((emp) => {
      employeeHours.set(emp.id, 0);
      employeeShiftsPerDay.set(emp.id, 0);
    });

    // Sort shifts by priority and difficulty
    const sortedShifts = [...this.shifts].sort((a, b) => {
      const priorityMap = { critical: 0, high: 1, normal: 2, low: 3 };
      return priorityMap[a.priority] - priorityMap[b.priority];
    });

    // Assign shifts greedily
    for (const shift of sortedShifts) {
      const requiredStaff = shift.requiredStaff;
      let assigned = 0;

      // Find qualified employees not yet assigned to this shift
      const candidates = this.employees
        .filter((emp) => {
          const hasSkills = shift.allowedSkills.every((skill) => emp.skills.includes(skill));
          const available = !emp.restrictions.unavailableDates.some(
            (d) => d.getTime() === shift.date.getTime()
          );
          const notDoubleBooked = !schedule.some(
            (s) =>
              s.employeeId === emp.id &&
              s.date.getTime() === shift.date.getTime() &&
              this.shiftsOverlap(s.startTime, s.endTime, shift.shiftId)
          );
          const withinHoursLimit =
            (employeeHours.get(emp.id) || 0) + 8 <= emp.maxHoursPerWeek * 4;

          return hasSkills && available && notDoubleBooked && withinHoursLimit;
        })
        .sort((a, b) => {
          // Sort by current workload (least loaded first)
          return (employeeHours.get(a.id) || 0) - (employeeHours.get(b.id) || 0);
        });

      // Assign to qualified employees up to required staff
      for (let i = 0; i < Math.min(requiredStaff, candidates.length); i++) {
        const employee = candidates[i];
        const assignment: ScheduleAssignment = {
          employeeId: employee.id,
          shiftId: shift.shiftId,
          date: shift.date,
          startTime: '09:00', // Would come from shift configuration
          endTime: '17:00',
          departmentId: shift.department,
        };

        schedule.push(assignment);
        assigned++;

        // Update counters
        employeeHours.set(employee.id, (employeeHours.get(employee.id) || 0) + 8);
        employeeShiftsPerDay.set(employee.id, (employeeShiftsPerDay.get(employee.id) || 0) + 1);
      }

      // If not fully staffed, log warning
      if (assigned < requiredStaff) {
        // Shift understaffed - logging would be done at service level
      }
    }

    return schedule;
  }

  /**
   * Generate neighboring solution by random perturbation
   */
  private generateNeighborSolution(schedule: ScheduleAssignment[]): ScheduleAssignment[] {
    const neighbor = JSON.parse(JSON.stringify(schedule)) as ScheduleAssignment[]; // Deep clone
    const moveType = Math.random();

    if (moveType < 0.5 && neighbor.length > 0) {
      // Swap: swap two assignments
      const idx1 = Math.floor(Math.random() * neighbor.length);
      const idx2 = Math.floor(Math.random() * neighbor.length);
      if (idx1 !== idx2) {
        [neighbor[idx1].employeeId, neighbor[idx2].employeeId] = [
          neighbor[idx2].employeeId,
          neighbor[idx1].employeeId,
        ];
      }
    } else if (moveType < 0.75 && neighbor.length > 0) {
      // Shift: reassign one shift to different employee
      const idx = Math.floor(Math.random() * neighbor.length);
      const randomEmployee = this.employees[Math.floor(Math.random() * this.employees.length)];
      neighbor[idx].employeeId = randomEmployee.id;
    } else if (neighbor.length < this.shifts.length) {
      // Add: add unassigned shift if any
      const unassignedShift = this.shifts.find(
        (shift) =>
          !neighbor.some(
            (a) =>
              a.shiftId === shift.shiftId &&
              a.date.getTime() === shift.date.getTime()
          )
      );

      if (unassignedShift) {
        const randomEmployee = this.employees[Math.floor(Math.random() * this.employees.length)];
        neighbor.push({
          employeeId: randomEmployee.id,
          shiftId: unassignedShift.shiftId,
          date: unassignedShift.date,
          startTime: '09:00',
          endTime: '17:00',
          departmentId: unassignedShift.department,
        });
      }
    }

    return neighbor;
  }

  /**
   * Calculate total objective score (lower is better)
   * Uses configurable weights for each constraint inspired by PoliTO Parameters.py
   * 
   * Objective Function:
   * - Hard constraints: violation_penalty = 10000 * weight (must be avoided)
   * - Soft constraints: penalty * weight (optimization targets)
   * 
   * The total score combines all weighted penalties to balance multiple objectives
   */
  private calculateObjectiveScore(schedule: ScheduleAssignment[]): number {
    let totalScore = 0;

    for (const constraint of this.constraints) {
      // Skip disabled constraints
      if (!constraint.enabled) {
        continue;
      }

      const isValid = constraint.validate(schedule);
      const penalty = constraint.penalty(schedule);

      if (!isValid && constraint.type === 'hard') {
        // Hard constraint violation: very high penalty multiplied by weight
        // Weight allows different importance levels even for hard constraints
        totalScore += 10000 * constraint.weight;
      } else {
        // Soft constraint penalty multiplied by configured weight
        // This allows fine-tuning the balance between different optimization goals
        // (e.g., employee preferences vs workload fairness)
        totalScore += penalty * (constraint.weight / 10); // Normalize weight
      }
    }

    return totalScore;
  }

  /**
   * Enable or disable a constraint dynamically
   * Useful for adaptive optimization or progressive relaxation
   * 
   * @param constraintName - Name of the constraint to modify
   * @param enabled - Whether the constraint should be enabled
   */
  public setConstraintEnabled(constraintName: string, enabled: boolean): void {
    const constraint = this.constraints.find((c) => c.name === constraintName);
    if (constraint) {
      constraint.enabled = enabled;
    }
  }

  /**
   * Update the weight of a constraint dynamically
   * Allows adaptive optimization where priorities change based on progress
   * 
   * @param constraintName - Name of the constraint to modify
   * @param weight - New weight value (0-100)
   */
  public setConstraintWeight(constraintName: string, weight: number): void {
    const constraint = this.constraints.find((c) => c.name === constraintName);
    if (constraint) {
      constraint.weight = Math.max(0, Math.min(100, weight)); // Clamp to 0-100
    }
  }

  /**
   * Get current constraint configuration
   * Useful for debugging and reporting
   */
  public getConstraintConfig(): Array<{
    name: string;
    type: string;
    weight: number;
    enabled: boolean;
  }> {
    return this.constraints.map((c) => ({
      name: c.name,
      type: c.type,
      weight: c.weight,
      enabled: c.enabled,
    }));
  }

  // ============ HARD CONSTRAINT VALIDATORS ============

  private validateShiftCoverage(schedule: ScheduleAssignment[]): boolean {
    for (const shift of this.shifts) {
      const assigned = schedule.filter(
        (a) =>
          a.shiftId === shift.shiftId &&
          a.date.getTime() === shift.date.getTime()
      ).length;

      if (assigned < shift.requiredStaff) {
        return false;
      }
    }
    return true;
  }

  private penalizeShiftCoverage(schedule: ScheduleAssignment[]): number {
    let penalty = 0;
    for (const shift of this.shifts) {
      const assigned = schedule.filter(
        (a) =>
          a.shiftId === shift.shiftId &&
          a.date.getTime() === shift.date.getTime()
      ).length;

      const gap = Math.max(0, shift.requiredStaff - assigned);
      penalty += gap * (shift.priority === 'critical' ? 100 : 50);
    }
    return penalty;
  }

  private validateNoDoubleBooking(schedule: ScheduleAssignment[]): boolean {
    const employeeShifts = new Map<string, ScheduleAssignment[]>();

    for (const assignment of schedule) {
      if (!employeeShifts.has(assignment.employeeId)) {
        employeeShifts.set(assignment.employeeId, []);
      }
      employeeShifts.get(assignment.employeeId)!.push(assignment);
    }

    for (const [, assignments] of employeeShifts) {
      for (let i = 0; i < assignments.length; i++) {
        for (let j = i + 1; j < assignments.length; j++) {
          const a1 = assignments[i];
          const a2 = assignments[j];

          if (a1.date.getTime() === a2.date.getTime()) {
            if (this.shiftsOverlap(a1.startTime, a1.endTime, a2.shiftId)) {
              return false;
            }
          }
        }
      }
    }

    return true;
  }

  private penalizeDoubleBooking(schedule: ScheduleAssignment[]): number {
    let violations = 0;

    for (const emp of this.employees) {
      const empAssignments = schedule.filter((a) => a.employeeId === emp.id);

      for (let i = 0; i < empAssignments.length; i++) {
        for (let j = i + 1; j < empAssignments.length; j++) {
          const a1 = empAssignments[i];
          const a2 = empAssignments[j];

          if (a1.date.getTime() === a2.date.getTime()) {
            if (this.shiftsOverlap(a1.startTime, a1.endTime, a2.shiftId)) {
              violations++;
            }
          }
        }
      }
    }

    return violations * 500;
  }

  private validateSkillRequirements(schedule: ScheduleAssignment[]): boolean {
    for (const shift of this.shifts) {
      const assignedEmployees = schedule
        .filter(
          (a) =>
            a.shiftId === shift.shiftId &&
            a.date.getTime() === shift.date.getTime()
        )
        .map((a) => this.employees.find((e) => e.id === a.employeeId))
        .filter(Boolean) as EmployeeProfile[];

      const qualified = assignedEmployees.filter((emp) =>
        shift.allowedSkills.every((skill) => emp.skills.includes(skill))
      );

      if (qualified.length < shift.requiredStaff * 0.7) {
        return false; // At least 70% must be qualified
      }
    }

    return true;
  }

  private penalizeSkillRequirements(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const shift of this.shifts) {
      const assignedEmployees = schedule
        .filter(
          (a) =>
            a.shiftId === shift.shiftId &&
            a.date.getTime() === shift.date.getTime()
        )
        .map((a) => this.employees.find((e) => e.id === a.employeeId))
        .filter(Boolean) as EmployeeProfile[];

      for (const emp of assignedEmployees) {
        const missingSkills = shift.allowedSkills.filter((skill) => !emp.skills.includes(skill));
        penalty += missingSkills.length * 20;
      }
    }

    return penalty;
  }

  private validateAvailability(schedule: ScheduleAssignment[]): boolean {
    for (const assignment of schedule) {
      const emp = this.employees.find((e) => e.id === assignment.employeeId);
      if (!emp) continue;

      // Check unavailable dates
      if (
        emp.restrictions.unavailableDates.some(
          (d) => d.getTime() === assignment.date.getTime()
        )
      ) {
        return false;
      }

      // Check availability by day of week
      const dayOfWeek = assignment.date.getDay();
      if (!emp.availableDays[dayOfWeek]) {
        return false;
      }
    }

    return true;
  }

  private penalizeAvailability(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const assignment of schedule) {
      const emp = this.employees.find((e) => e.id === assignment.employeeId);
      if (!emp) continue;

      if (
        emp.restrictions.unavailableDates.some(
          (d) => d.getTime() === assignment.date.getTime()
        )
      ) {
        penalty += 1000;
      }

      const dayOfWeek = assignment.date.getDay();
      if (!emp.availableDays[dayOfWeek]) {
        penalty += 500;
      }
    }

    return penalty;
  }

  // ============ SOFT CONSTRAINT PENALTIES ============

  private penalizePreferences(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const assignment of schedule) {
      const emp = this.employees.find((e) => e.id === assignment.employeeId);
      if (!emp) continue;

      // Penalize avoided shifts
      if (emp.preferences.avoidShifts.includes(assignment.shiftId)) {
        penalty += 30;
      }

      // Reward preferred shifts
      if (emp.preferences.preferredShifts.includes(assignment.shiftId)) {
        penalty -= 20; // Negative penalty = reward
      }
    }

    return Math.max(0, penalty);
  }

  private penalizeWorkloadImbalance(schedule: ScheduleAssignment[]): number {
    const employeeHours: Map<string, number> = new Map();
    this.employees.forEach((emp) => employeeHours.set(emp.id, 0));

    for (const assignment of schedule) {
      const hours = 8; // Simplified: would parse from startTime/endTime
      employeeHours.set(assignment.employeeId, (employeeHours.get(assignment.employeeId) || 0) + hours);
    }

    // Calculate standard deviation
    const hours = Array.from(employeeHours.values());
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const variance =
      hours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / hours.length;
    const stdDev = Math.sqrt(variance);

    // Penalty proportional to variance (we want low variance = fair distribution)
    return stdDev * 5;
  }

  private penalizeConsecutiveDays(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const emp of this.employees) {
      const empDates = schedule
        .filter((a) => a.employeeId === emp.id)
        .map((a) => a.date)
        .sort((a, b) => a.getTime() - b.getTime());

      let consecutiveDays = 1;

      for (let i = 1; i < empDates.length; i++) {
        const dayDiff = (empDates[i].getTime() - empDates[i - 1].getTime()) / (24 * 60 * 60 * 1000);

        if (dayDiff === 1) {
          consecutiveDays++;
        } else {
          if (consecutiveDays > emp.preferences.maxConsecutiveDays) {
            penalty += (consecutiveDays - emp.preferences.maxConsecutiveDays) * 15;
          }
          consecutiveDays = 1;
        }
      }

      if (consecutiveDays > emp.preferences.maxConsecutiveDays) {
        penalty += (consecutiveDays - emp.preferences.maxConsecutiveDays) * 15;
      }
    }

    return penalty;
  }

  // ============ ADDITIONAL CONSTRAINT VALIDATORS (Enhanced from PoliTO approach) ============

  /**
   * Validate maximum hours per week constraint
   * Ensures no employee exceeds their maximum weekly hours
   */
  private validateMaxHoursPerWeek(schedule: ScheduleAssignment[]): boolean {
    for (const emp of this.employees) {
      const weeklyHours = this.calculateWeeklyHours(emp.id, schedule);
      for (const hours of weeklyHours.values()) {
        if (hours > emp.maxHoursPerWeek) {
          return false;
        }
      }
    }
    return true;
  }

  private penalizeMaxHoursPerWeek(schedule: ScheduleAssignment[]): number {
    let penalty = 0;
    for (const emp of this.employees) {
      const weeklyHours = this.calculateWeeklyHours(emp.id, schedule);
      for (const hours of weeklyHours.values()) {
        if (hours > emp.maxHoursPerWeek) {
          penalty += (hours - emp.maxHoursPerWeek) * 100; // High penalty for overtime violations
        }
      }
    }
    return penalty;
  }

  /**
   * Validate rest periods between shifts (inspired by EU Working Time Directive)
   * Ensures minimum rest hours between consecutive shifts
   */
  private validateRestPeriods(schedule: ScheduleAssignment[]): boolean {
    for (const emp of this.employees) {
      const empSchedule = schedule
        .filter((a) => a.employeeId === emp.id)
        .sort((a, b) => {
          const dateCompare = a.date.getTime() - b.date.getTime();
          if (dateCompare !== 0) return dateCompare;
          return a.startTime.localeCompare(b.startTime);
        });

      for (let i = 1; i < empSchedule.length; i++) {
        const prev = empSchedule[i - 1];
        const curr = empSchedule[i];

        // Calculate hours between shifts
        const prevEnd = this.parseTime(prev.date, prev.endTime);
        const currStart = this.parseTime(curr.date, curr.startTime);
        const restHours = (currStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60);

        if (restHours < this.config.parameters.minRestHoursBetweenShifts) {
          return false;
        }
      }
    }
    return true;
  }

  private penalizeRestPeriods(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const emp of this.employees) {
      const empSchedule = schedule
        .filter((a) => a.employeeId === emp.id)
        .sort((a, b) => {
          const dateCompare = a.date.getTime() - b.date.getTime();
          if (dateCompare !== 0) return dateCompare;
          return a.startTime.localeCompare(b.startTime);
        });

      for (let i = 1; i < empSchedule.length; i++) {
        const prev = empSchedule[i - 1];
        const curr = empSchedule[i];

        const prevEnd = this.parseTime(prev.date, prev.endTime);
        const currStart = this.parseTime(curr.date, curr.startTime);
        const restHours = (currStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60);

        if (restHours < this.config.parameters.minRestHoursBetweenShifts) {
          const violation = this.config.parameters.minRestHoursBetweenShifts - restHours;
          penalty += violation * 50; // Penalty proportional to rest period violation
        }
      }
    }

    return penalty;
  }

  /**
   * Penalize lecture/shift dispersion (inspired by PoliTO lecture_dispersion_penalty)
   * Prefers concentrated shifts over dispersed ones for better employee experience
   */
  private penalizeLectureDispersion(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    for (const emp of this.employees) {
      const empDates = schedule
        .filter((a) => a.employeeId === emp.id)
        .map((a) => a.date.getTime());

      if (empDates.length <= 1) continue;

      // Calculate date dispersion
      const uniqueDates = Array.from(new Set(empDates)).sort();
      const totalDays = (uniqueDates[uniqueDates.length - 1] - uniqueDates[0]) / (24 * 60 * 60 * 1000);
      const workDays = uniqueDates.length;

      // Dispersion ratio: higher = more dispersed
      const dispersionRatio = totalDays / Math.max(workDays, 1);

      // Penalty increases with dispersion (prefer concentrated schedules)
      penalty += dispersionRatio * 10;
    }

    return penalty;
  }

  /**
   * Penalize shift fragmentation (inspired by PoliTO double slot preferences)
   * Prefers continuous shift blocks over fragmented single shifts
   */
  private penalizeShiftFragmentation(schedule: ScheduleAssignment[]): number {
    let penalty = 0;

    if (!this.config.parameters.preferredDoubleShifts) {
      return 0; // Feature disabled
    }

    for (const emp of this.employees) {
      const dailyShifts: Map<string, number> = new Map();

      // Count shifts per day for each employee
      schedule
        .filter((a) => a.employeeId === emp.id)
        .forEach((assignment) => {
          const dateKey = assignment.date.toISOString().split('T')[0];
          dailyShifts.set(dateKey, (dailyShifts.get(dateKey) || 0) + 1);
        });

      // Penalize days with single shifts (prefer double shifts/continuous work)
      for (const [, count] of dailyShifts) {
        if (count === 1) {
          penalty += 15; // Single shift penalty
        } else if (count >= 2) {
          penalty -= 10; // Reward for continuous shifts (negative penalty)
        }
      }
    }

    return Math.max(0, penalty);
  }

  // ============ UTILITY METHODS ============

  private shiftsOverlap(startTime1: string, endTime1: string, shiftId2: string): boolean {
    // Simplified: would need actual shift times from shiftId2
    // For now, assuming different shift IDs = no overlap
    return false;
  }

  /**
   * Parse time string and combine with date to create DateTime object
   * @param date - Base date
   * @param timeStr - Time string in format "HH:MM"
   * @returns Combined DateTime object
   */
  private parseTime(date: Date, timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  /**
   * Calculate weekly hours for an employee across the schedule
   * Returns a map of week identifiers to total hours worked that week
   */
  private calculateWeeklyHours(
    employeeId: string,
    schedule: ScheduleAssignment[]
  ): Map<string, number> {
    const weeklyHours: Map<string, number> = new Map();

    schedule
      .filter((a) => a.employeeId === employeeId)
      .forEach((assignment) => {
        // Get week identifier (ISO week number)
        const weekKey = this.getWeekIdentifier(assignment.date);

        // Calculate shift duration (simplified to 8 hours per shift)
        const shiftHours = 8; // TODO: Calculate from startTime and endTime

        weeklyHours.set(weekKey, (weeklyHours.get(weekKey) || 0) + shiftHours);
      });

    return weeklyHours;
  }

  /**
   * Get week identifier for a date (format: "YYYY-W##")
   * Used for grouping shifts by week
   */
  private getWeekIdentifier(date: Date): string {
    const year = date.getFullYear();
    const firstDayOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    return `${year}-W${weekNumber.toString().padStart(2, '0')}`;
  }

  /**
   * Get schedule statistics for reporting
   */
  public getScheduleStats(schedule: ScheduleAssignment[]) {
    const stats = {
      totalAssignments: schedule.length,
      employeeCount: new Set(schedule.map((a) => a.employeeId)).size,
      shiftsToFill: this.shifts.length,
      coverageRate: 0,
      fairnessScore: 0,
      preferenceScore: 0,
    };

    // Calculate coverage rate
    const coveredShifts = new Set(
      schedule.map((a) => `${a.shiftId}-${a.date.getTime()}`)
    ).size;
    stats.coverageRate = (coveredShifts / this.shifts.length) * 100;

    // Calculate fairness score
    const employeeHours: Map<string, number> = new Map();
    this.employees.forEach((emp) => employeeHours.set(emp.id, 0));

    schedule.forEach((a) => {
      employeeHours.set(a.employeeId, (employeeHours.get(a.employeeId) || 0) + 8);
    });

    const hours = Array.from(employeeHours.values());
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const variance =
      hours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / hours.length;
    stats.fairnessScore = 100 - Math.min(100, Math.sqrt(variance) * 10);

    return stats;
  }
}
