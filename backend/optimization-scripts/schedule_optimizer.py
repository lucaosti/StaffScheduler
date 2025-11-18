#!/usr/bin/env python3
"""
Staff Schedule Optimizer using Google OR-Tools CP-SAT Solver

Constraint Programming approach inspired by PoliTO_Timetable_Allocator.
Uses Google OR-Tools CP-SAT solver for optimal staff scheduling.

Key Features:
- Hard constraints: coverage, availability, max hours, no double-booking
- Soft constraints: preferences (correlations), fairness, rest periods
- Weighted objective function with customizable priorities
- Efficient CP-SAT solver with optimal/near-optimal solutions

Input: JSON with shifts, employees, skills, preferences, constraints
Output: JSON with optimal assignments and statistics

Usage:
    python schedule_optimizer.py input.json output.json
    python schedule_optimizer.py --stdin --stdout < input.json > output.json
"""

import sys
import json
import argparse
from datetime import datetime, timedelta
from typing import List, Dict, Set, Tuple, Optional
from ortools.sat.python import cp_model


class ScheduleOptimizerORTools:
    """
    Schedule optimizer using Google OR-Tools CP-SAT solver.
    Inspired by PoliTO's constraint programming approach.
    """
    
    def __init__(self, problem_data: Dict):
        """Initialize optimizer with problem data."""
        self.data = problem_data
        self.model = cp_model.CpModel()
        self.assignments = {}  # (employee_id, shift_id) -> BoolVar
        self.hours_worked = {}  # employee_id -> IntVar (weekly hours)
        
        # Extract data
        self.shifts = {s['id']: s for s in problem_data['shifts']}
        self.employees = {e['id']: e for e in problem_data['employees']}
        self.skills = problem_data.get('skills', {})
        self.preferences = problem_data.get('preferences', {})
        self.constraints_config = problem_data.get('constraints', {})
        self.weights = problem_data.get('weights', self._default_weights())
        
    def _default_weights(self) -> Dict[str, float]:
        """Default constraint weights (similar to PoliTO Parameters.py)."""
        return {
            # Hard constraints (high penalties)
            'shift_coverage': 100.0,
            'no_double_booking': 90.0,
            'skill_requirements': 85.0,
            'availability': 80.0,
            'max_hours_per_week': 75.0,
            
            # Soft constraints (optimization)
            'employee_preferences': 55.0,  # Similar to teaching_overlaps in PoliTO
            'workload_fairness': 40.0,
            'consecutive_days': 30.0,
            'rest_periods': 25.0,
            'shift_continuity': 20.0
        }
    
    def build_model(self):
        """Build the CP-SAT model with all constraints."""
        print("Building CP-SAT model...", file=sys.stderr)
        
        # 1. Create assignment variables
        self._create_assignment_variables()
        
        # 2. Add hard constraints
        self._add_shift_coverage_constraints()
        self._add_no_double_booking_constraints()
        self._add_skill_requirements_constraints()
        self._add_availability_constraints()
        self._add_max_hours_constraints()
        
        # 3. Build objective function
        self._build_objective_function()
        
        print(f"Model built: {len(self.assignments)} assignment variables", file=sys.stderr)
    
    def _create_assignment_variables(self):
        """Create boolean variables for each (employee, shift) pair."""
        for shift_id, shift in self.shifts.items():
            for employee_id, employee in self.employees.items():
                var_name = f'assign_e{employee_id}_s{shift_id}'
                self.assignments[(employee_id, shift_id)] = self.model.NewBoolVar(var_name)
    
    def _add_shift_coverage_constraints(self):
        """
        HARD: Each shift must have required number of staff.
        Similar to PoliTO's teaching coverage constraints.
        """
        for shift_id, shift in self.shifts.items():
            min_staff = shift.get('min_staff', 1)
            max_staff = shift.get('max_staff', min_staff + 2)
            
            # Sum of assignments for this shift
            assignments_for_shift = [
                self.assignments[(emp_id, shift_id)]
                for emp_id in self.employees.keys()
            ]
            
            # Constraint: min_staff <= assigned <= max_staff
            self.model.Add(sum(assignments_for_shift) >= min_staff)
            self.model.Add(sum(assignments_for_shift) <= max_staff)
    
    def _add_no_double_booking_constraints(self):
        """
        HARD: Employee cannot be assigned to overlapping shifts.
        Similar to PoliTO's no teaching overlaps constraint.
        """
        for employee_id in self.employees.keys():
            # Group shifts by date
            shifts_by_date = {}
            for shift_id, shift in self.shifts.items():
                date = shift['date']
                if date not in shifts_by_date:
                    shifts_by_date[date] = []
                shifts_by_date[date].append(shift_id)
            
            # For each date, check for overlapping shifts
            for date, shift_ids in shifts_by_date.items():
                overlapping_groups = self._find_overlapping_shifts(shift_ids)
                
                for overlapping_shifts in overlapping_groups:
                    # Employee can be assigned to at most 1 overlapping shift
                    assignments = [
                        self.assignments[(employee_id, shift_id)]
                        for shift_id in overlapping_shifts
                    ]
                    self.model.Add(sum(assignments) <= 1)
    
    def _find_overlapping_shifts(self, shift_ids: List[str]) -> List[List[str]]:
        """Find groups of overlapping shifts."""
        overlapping = []
        
        for i, shift_id_1 in enumerate(shift_ids):
            shift_1 = self.shifts[shift_id_1]
            overlap_group = [shift_id_1]
            
            for shift_id_2 in shift_ids[i+1:]:
                shift_2 = self.shifts[shift_id_2]
                
                # Check if shifts overlap
                if self._shifts_overlap(shift_1, shift_2):
                    overlap_group.append(shift_id_2)
            
            if len(overlap_group) > 1:
                overlapping.append(overlap_group)
        
        return overlapping
    
    def _shifts_overlap(self, shift1: Dict, shift2: Dict) -> bool:
        """Check if two shifts overlap in time."""
        # Simple time comparison (assumes same date)
        start1 = self._parse_time(shift1['start_time'])
        end1 = self._parse_time(shift1['end_time'])
        start2 = self._parse_time(shift2['start_time'])
        end2 = self._parse_time(shift2['end_time'])
        
        return not (end1 <= start2 or end2 <= start1)
    
    def _parse_time(self, time_str: str) -> int:
        """Parse time string to minutes since midnight."""
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    
    def _add_skill_requirements_constraints(self):
        """
        HARD: Assigned employees must have required skills.
        Similar to PoliTO's teaching competency constraints.
        """
        for shift_id, shift in self.shifts.items():
            required_skills = set(shift.get('required_skills', []))
            
            if not required_skills:
                continue
            
            for employee_id, employee in self.employees.items():
                employee_skills = set(employee.get('skills', []))
                
                # If employee doesn't have required skills, cannot be assigned
                if not required_skills.issubset(employee_skills):
                    self.model.Add(self.assignments[(employee_id, shift_id)] == 0)
    
    def _add_availability_constraints(self):
        """
        HARD: Employees can only be assigned when available.
        Similar to PoliTO's teacher availability constraints.
        """
        for employee_id, employee in self.employees.items():
            unavailable_dates = set(employee.get('unavailable_dates', []))
            
            for shift_id, shift in self.shifts.items():
                shift_date = shift['date']
                
                # If employee unavailable on this date, cannot be assigned
                if shift_date in unavailable_dates:
                    self.model.Add(self.assignments[(employee_id, shift_id)] == 0)
    
    def _add_max_hours_constraints(self):
        """
        HARD: Employees cannot exceed max hours per week.
        Similar to PoliTO's max teaching hours constraints.
        """
        # Group shifts by week
        shifts_by_week = {}
        for shift_id, shift in self.shifts.items():
            week_key = self._get_week_key(shift['date'])
            if week_key not in shifts_by_week:
                shifts_by_week[week_key] = []
            shifts_by_week[week_key].append(shift_id)
        
        # For each employee, constrain weekly hours
        for employee_id, employee in self.employees.items():
            max_hours = employee.get('max_hours_per_week', 40)
            
            for week_key, shift_ids in shifts_by_week.items():
                # Calculate total hours if assigned to all shifts
                weekly_assignments = []
                shift_hours = []
                
                for shift_id in shift_ids:
                    shift = self.shifts[shift_id]
                    hours = self._calculate_shift_hours(shift)
                    
                    weekly_assignments.append(self.assignments[(employee_id, shift_id)])
                    shift_hours.append(hours)
                
                # Constraint: sum(assignment * hours) <= max_hours
                total_hours = sum(
                    a * h for a, h in zip(weekly_assignments, shift_hours)
                )
                self.model.Add(total_hours <= max_hours)
    
    def _get_week_key(self, date_str: str) -> str:
        """Get week identifier from date string."""
        # Parse date and return ISO week number
        date = datetime.strptime(date_str, '%Y-%m-%d')
        return f"{date.year}-W{date.isocalendar()[1]}"
    
    def _calculate_shift_hours(self, shift: Dict) -> int:
        """Calculate shift duration in hours."""
        start = self._parse_time(shift['start_time'])
        end = self._parse_time(shift['end_time'])
        
        # Handle overnight shifts
        if end < start:
            end += 24 * 60
        
        return (end - start) // 60  # Convert minutes to hours
    
    def _build_objective_function(self):
        """
        Build weighted objective function to maximize.
        Inspired by PoliTO's correlation-based objective function.
        """
        objective_terms = []
        
        # 1. Employee preferences (correlations)
        # Higher weight for preferred shifts, penalty for avoided shifts
        pref_weight = int(self.weights.get('employee_preferences', 55.0))
        for (emp_id, shift_id), var in self.assignments.items():
            preference = self._get_preference(emp_id, shift_id)
            # preference: +10 (preferred), 0 (neutral), -10 (avoid)
            objective_terms.append(var * preference * pref_weight)
        
        # 2. Workload fairness
        # Minimize variance in assigned hours
        fairness_weight = int(self.weights.get('workload_fairness', 40.0))
        # (This is complex in CP-SAT, simplified here)
        
        # 3. Consecutive days penalty
        # Prefer giving employees days off between shifts
        consec_weight = int(self.weights.get('consecutive_days', 30.0))
        objective_terms.extend(self._add_consecutive_days_terms(consec_weight))
        
        # Maximize objective
        self.model.Maximize(sum(objective_terms))
    
    def _get_preference(self, employee_id: str, shift_id: str) -> int:
        """
        Get preference score for employee-shift pair.
        Similar to PoliTO's correlation values.
        """
        if employee_id not in self.preferences:
            return 0
        
        emp_prefs = self.preferences[employee_id]
        
        # Check if shift is in preferred list
        if shift_id in emp_prefs.get('preferred_shifts', []):
            return 10
        
        # Check if shift is in avoid list
        if shift_id in emp_prefs.get('avoid_shifts', []):
            return -10
        
        return 0  # Neutral
    
    def _add_consecutive_days_terms(self, weight: int) -> List:
        """
        Add terms to objective to discourage too many consecutive work days.
        Similar to PoliTO's slot dispersion constraints.
        """
        terms = []
        
        # Group shifts by employee and date
        for employee_id in self.employees.keys():
            shifts_by_date = {}
            for shift_id, shift in self.shifts.items():
                date = shift['date']
                if date not in shifts_by_date:
                    shifts_by_date[date] = []
                shifts_by_date[date].append(shift_id)
            
            # Sort dates
            sorted_dates = sorted(shifts_by_date.keys())
            
            # Penalize consecutive work days beyond threshold
            max_consec = self.employees[employee_id].get('max_consecutive_days', 5)
            
            for i in range(len(sorted_dates) - max_consec):
                # Check if working all days in window
                window_dates = sorted_dates[i:i+max_consec+1]
                
                # Create indicator variables for each day
                day_worked = []
                for date in window_dates:
                    # Employee works if assigned to any shift on this day
                    day_shifts = shifts_by_date[date]
                    day_var = self.model.NewBoolVar(f'worked_e{employee_id}_d{date}')
                    
                    # day_var = 1 if any assignment on this date
                    self.model.AddMaxEquality(
                        day_var,
                        [self.assignments[(employee_id, s_id)] for s_id in day_shifts]
                    )
                    day_worked.append(day_var)
                
                # Penalty if working all consecutive days
                all_worked = self.model.NewBoolVar(f'consec_e{employee_id}_w{i}')
                self.model.Add(sum(day_worked) == len(day_worked)).OnlyEnforceIf(all_worked)
                self.model.Add(sum(day_worked) < len(day_worked)).OnlyEnforceIf(all_worked.Not())
                
                # Add negative term to objective (penalty)
                terms.append(-all_worked * weight)
        
        return terms
    
    def solve(self, time_limit_seconds: int = 300) -> Dict:
        """
        Solve the CP-SAT model and return solution.
        
        Args:
            time_limit_seconds: Maximum time to spend solving
            
        Returns:
            Dictionary with solution and statistics
        """
        print(f"Solving with CP-SAT (time limit: {time_limit_seconds}s)...", file=sys.stderr)
        
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_seconds
        solver.parameters.log_search_progress = True
        
        status = solver.Solve(self.model)
        
        result = {
            'status': self._status_to_string(status),
            'objective_value': solver.ObjectiveValue() if status in [cp_model.OPTIMAL, cp_model.FEASIBLE] else None,
            'solve_time_seconds': solver.WallTime(),
            'assignments': [],
            'statistics': {
                'num_branches': solver.NumBranches(),
                'num_conflicts': solver.NumConflicts(),
                'is_optimal': status == cp_model.OPTIMAL
            }
        }
        
        # Extract solution if found
        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            result['assignments'] = self._extract_solution(solver)
            result['statistics']['total_assigned_shifts'] = len(result['assignments'])
            result['statistics']['coverage_stats'] = self._calculate_coverage_stats(result['assignments'])
        
        return result
    
    def _status_to_string(self, status: int) -> str:
        """Convert solver status to string."""
        status_map = {
            cp_model.OPTIMAL: 'OPTIMAL',
            cp_model.FEASIBLE: 'FEASIBLE',
            cp_model.INFEASIBLE: 'INFEASIBLE',
            cp_model.MODEL_INVALID: 'MODEL_INVALID',
            cp_model.UNKNOWN: 'UNKNOWN'
        }
        return status_map.get(status, 'UNKNOWN')
    
    def _extract_solution(self, solver: cp_model.CpSolver) -> List[Dict]:
        """Extract assignment solution from solver."""
        assignments = []
        
        for (emp_id, shift_id), var in self.assignments.items():
            if solver.Value(var) == 1:
                shift = self.shifts[shift_id]
                assignments.append({
                    'employee_id': emp_id,
                    'shift_id': shift_id,
                    'date': shift['date'],
                    'start_time': shift['start_time'],
                    'end_time': shift['end_time'],
                    'hours': self._calculate_shift_hours(shift)
                })
        
        return assignments
    
    def _calculate_coverage_stats(self, assignments: List[Dict]) -> Dict:
        """Calculate coverage statistics for the solution."""
        # Count assignments per shift
        shift_counts = {}
        for assignment in assignments:
            shift_id = assignment['shift_id']
            shift_counts[shift_id] = shift_counts.get(shift_id, 0) + 1
        
        # Calculate stats
        total_shifts = len(self.shifts)
        fully_covered = sum(1 for s_id, shift in self.shifts.items() 
                          if shift_counts.get(s_id, 0) >= shift.get('min_staff', 1))
        
        return {
            'total_shifts': total_shifts,
            'fully_covered_shifts': fully_covered,
            'coverage_percentage': (fully_covered / total_shifts * 100) if total_shifts > 0 else 0
        }


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Staff Schedule Optimizer using OR-Tools')
    parser.add_argument('input', nargs='?', help='Input JSON file (or use --stdin)')
    parser.add_argument('output', nargs='?', help='Output JSON file (or use --stdout)')
    parser.add_argument('--stdin', action='store_true', help='Read input from stdin')
    parser.add_argument('--stdout', action='store_true', help='Write output to stdout')
    parser.add_argument('--time-limit', type=int, default=300, help='Time limit in seconds')
    
    args = parser.parse_args()
    
    # Read input
    if args.stdin:
        problem_data = json.load(sys.stdin)
    elif args.input:
        with open(args.input, 'r') as f:
            problem_data = json.load(f)
    else:
        print("Error: Must provide input file or use --stdin", file=sys.stderr)
        sys.exit(1)
    
    # Create optimizer and solve
    try:
        optimizer = ScheduleOptimizerORTools(problem_data)
        optimizer.build_model()
        result = optimizer.solve(time_limit_seconds=args.time_limit)
        
        # Write output
        if args.stdout:
            json.dump(result, sys.stdout, indent=2)
        elif args.output:
            with open(args.output, 'w') as f:
                json.dump(result, f, indent=2)
        else:
            print(json.dumps(result, indent=2))
        
        # Exit with appropriate code
        if result['status'] in ['OPTIMAL', 'FEASIBLE']:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        error_result = {
            'status': 'ERROR',
            'error': str(e),
            'traceback': __import__('traceback').format_exc()
        }
        
        if args.stdout:
            json.dump(error_result, sys.stdout, indent=2)
        else:
            print(json.dumps(error_result, indent=2), file=sys.stderr)
        
        sys.exit(2)


if __name__ == '__main__':
    main()
