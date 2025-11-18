/**
 * Staff Schedule Optimization Engine - OR-Tools Integration
 * 
 * Wrapper for Python OR-Tools CP-SAT solver.
 * Uses Google OR-Tools constraint programming inspired by PoliTO Timetable Allocator.
 * 
 * Architecture:
 * - TypeScript prepares problem data (shifts, employees, preferences, constraints)
 * - Calls Python script with OR-Tools CP-SAT solver via child_process
 * - Python script returns optimal/feasible solution
 * - TypeScript processes and stores results in database
 * 
 * @author Luca Ostinelli
 * @inspiration PoliTO_Timetable_Allocator constraint programming with docplex
 */

import { spawn } from 'child_process';
import { join } from 'path';
import logger from '../config/logger';

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
    shiftCoverage?: number;           // Default: 100
    noDoubleBooking?: number;         // Default: 90
    skillRequirements?: number;       // Default: 85
    availability?: number;            // Default: 80
    maxHoursPerWeek?: number;         // Default: 75
    employeePreferences?: number;     // Default: 55 (like teaching_overlaps_penalty)
    workloadFairness?: number;        // Default: 40
    consecutiveDays?: number;         // Default: 30
    restPeriods?: number;             // Default: 25
    shiftContinuity?: number;         // Default: 20
  };
}

export interface Employee {
  id: string;
  max_hours_per_week: number;
  min_hours_per_week?: number;
  skills: string[];
  unavailable_dates: string[];
  max_consecutive_days?: number;
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

export interface OptimizationResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'ERROR';
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

export class ScheduleOptimizer {
  private pythonScriptPath: string;
  
  constructor() {
    // Path to Python optimizer script
    this.pythonScriptPath = join(__dirname, '../../optimization-scripts/schedule_optimizer.py');
  }
  
  /**
   * Optimize schedule using OR-Tools CP-SAT solver.
   * 
   * @param problem - Problem data with shifts, employees, preferences
   * @param config - Optimization configuration
   * @returns Promise with optimization result
   */
  async optimize(
    problem: OptimizationProblem,
    config: OptimizationConfig = {}
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
        weights: config.weights || this._getDefaultWeights()
      };
      
      // Call Python optimizer
      const result = await this._callPythonOptimizer(
        problemData,
        config.timeLimitSeconds || 300
      );
      
      const elapsedTime = (Date.now() - startTime) / 1000;
      
      logger.info(`Optimization completed in ${elapsedTime.toFixed(2)}s`);
      logger.info(`Status: ${result.status}, Assignments: ${result.assignments.length}`);
      
      if (result.statistics.coverageStats) {
        logger.info(`Coverage: ${result.statistics.coverageStats.coveragePercentage.toFixed(1)}%`);
      }
      
      return result;
      
    } catch (error) {
      logger.error('Optimization error:', error);
      
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
            coveragePercentage: 0
          }
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
        timeLimitSeconds.toString()
      ]);
      
      let stdoutData = '';
      let stderrData = '';
      
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
        if (code === 0 || code === 1) {
          // Success (0) or infeasible (1)
          try {
            const result = JSON.parse(stdoutData);
            resolve(result);
          } catch (error) {
            reject(new Error(`Failed to parse optimizer output: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
        } else {
          // Error
          reject(new Error(`Optimizer failed with code ${code}: ${stderrData}`));
        }
      });
      
      // Handle process errors
      pythonProcess.on('error', (error) => {
        reject(new Error(`Failed to start Python optimizer: ${error.message}`));
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
      employee_preferences: 55,  // Similar to teaching_overlaps_penalty in PoliTO
      workload_fairness: 40,
      consecutive_days: 30,
      rest_periods: 25,
      shift_continuity: 20
    };
  }
  
  /**
   * Generate a simple greedy schedule (fallback if optimizer fails).
   * Assigns employees to shifts based on availability and skills.
   */
  async generateGreedySchedule(problem: OptimizationProblem): Promise<ScheduleAssignment[]> {
    logger.info('Generating greedy schedule as fallback');
    
    const assignments: ScheduleAssignment[] = [];
    
    // Sort shifts by date and time
    const sortedShifts = [...problem.shifts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start_time.localeCompare(b.start_time);
    });
    
    // Track employee assignments
    const employeeAssignments = new Map<string, Set<string>>();
    problem.employees.forEach(emp => employeeAssignments.set(emp.id, new Set()));
    
    // Assign employees to shifts greedily
    for (const shift of sortedShifts) {
      const requiredSkills = new Set(shift.required_skills || []);
      const assignedCount = 0;
      
      // Find available employees with required skills
      const candidates = problem.employees.filter(emp => {
        // Check if already assigned to overlapping shift
        const empShifts = employeeAssignments.get(emp.id)!;
        if (this._hasOverlappingShift(shift, empShifts, sortedShifts)) {
          return false;
        }
        
        // Check availability
        if (emp.unavailable_dates.includes(shift.date)) {
          return false;
        }
        
        // Check skills
        const empSkills = new Set(emp.skills);
        for (const skill of requiredSkills) {
          if (!empSkills.has(skill)) return false;
        }
        
        return true;
      });
      
      // Assign up to min_staff employees
      const toAssign = Math.min(candidates.length, shift.min_staff);
      for (let i = 0; i < toAssign; i++) {
        const emp = candidates[i];
        
        assignments.push({
          employeeId: emp.id,
          shiftId: shift.id,
          date: shift.date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          hours: this._calculateShiftHours(shift)
        });
        
        employeeAssignments.get(emp.id)!.add(shift.id);
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
      const assignedShift = allShifts.find(s => s.id === shiftId);
      if (assignedShift && assignedShift.date === shift.date) {
        // Check time overlap
        if (this._timesOverlap(shift.start_time, shift.end_time, assignedShift.start_time, assignedShift.end_time)) {
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
    
    return Math.round((end - start) / 60 * 10) / 10; // Round to 1 decimal
  }
}

export default new ScheduleOptimizer();
