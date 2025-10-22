/**
 * Staff Schedule Optimization Engine
 * 
 * Advanced constraint satisfaction and optimization algorithm for generating
 * optimal workforce schedules while respecting business constraints and 
 * employee preferences.
 * 
 * Uses a hybrid approach:
 * 1. Constraint satisfaction (CSP) for feasibility
 * 2. Simulated annealing for optimization
 * 3. Greedy initialization for quick feasible solutions
 * 
 * @author Luca Ostinelli
 */

interface Constraint {
  type: 'hard' | 'soft';
  name: string;
  priority: number;
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
    this.config = {
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      temperature: 100,
      coolingRate: 0.95,
      maxIterations: 10000,
      timeoutMs: 300000, // 5 minutes
      ...config,
    };

    this.initializeConstraints();
  }

  /**
   * Initialize all constraint rules for schedule validation and optimization
   */
  private initializeConstraints(): void {
    this.constraints = [
      // Hard Constraints (must satisfy)
      {
        type: 'hard',
        name: 'shift_coverage',
        priority: 100,
        validate: (schedule: ScheduleAssignment[]) => this.validateShiftCoverage(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeShiftCoverage(schedule),
      },
      {
        type: 'hard',
        name: 'no_double_booking',
        priority: 90,
        validate: (schedule: ScheduleAssignment[]) => this.validateNoDoubleBooking(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeDoubleBooking(schedule),
      },
      {
        type: 'hard',
        name: 'skill_requirements',
        priority: 85,
        validate: (schedule: ScheduleAssignment[]) => this.validateSkillRequirements(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeSkillRequirements(schedule),
      },
      {
        type: 'hard',
        name: 'availability_constraints',
        priority: 80,
        validate: (schedule: ScheduleAssignment[]) => this.validateAvailability(schedule),
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeAvailability(schedule),
      },
      // Soft Constraints (optimize for)
      {
        type: 'soft',
        name: 'employee_preferences',
        priority: 50,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizePreferences(schedule),
      },
      {
        type: 'soft',
        name: 'workload_fairness',
        priority: 40,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeWorkloadImbalance(schedule),
      },
      {
        type: 'soft',
        name: 'consecutive_days',
        priority: 30,
        validate: () => true,
        penalty: (schedule: ScheduleAssignment[]) => this.penalizeConsecutiveDays(schedule),
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
   */
  private calculateObjectiveScore(schedule: ScheduleAssignment[]): number {
    let totalScore = 0;

    for (const constraint of this.constraints) {
      const isValid = constraint.validate(schedule);
      const penalty = constraint.penalty(schedule);

      if (!isValid && constraint.type === 'hard') {
        // Hard constraint violation: high penalty
        totalScore += 10000 * constraint.priority;
      } else {
        // Soft constraint penalty
        totalScore += penalty * constraint.priority;
      }
    }

    return totalScore;
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

  // ============ UTILITY METHODS ============

  private shiftsOverlap(startTime1: string, endTime1: string, shiftId2: string): boolean {
    // Simplified: would need actual shift times from shiftId2
    // For now, assuming different shift IDs = no overlap
    return false;
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
