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
from datetime import datetime
from typing import List, Dict, Tuple
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
        """Build the CP-SAT model with all constraints.

        The hard-constraint set below is kept in lock-step with the canonical
        definition in backend/src/optimization/constraintValidator.ts and with
        the TypeScript greedy engine (ScheduleOptimizer.evaluateCandidate). The
        optimizer.parity.test.ts suite runs both engines against that one
        validator, so any rule added here without a matching rule there (or
        vice-versa) turns the parity suite red. Rest, daily-cap,
        consecutive-days and cross-schedule ("external") load used to be missing
        from this model — they are now enforced as hard constraints so a CP-SAT
        solution can never be one the greedy path would have rejected.
        """
        print("Building CP-SAT model...", file=sys.stderr)

        # External assignments = shifts the employee already holds on *other*
        # schedules. They are fixed facts (never decision variables) but must
        # count toward this employee's rest, daily, weekly and consecutive-day
        # limits, otherwise back-to-back schedule periods are optimized in
        # isolation and can jointly bust a limit each satisfies alone.
        self.external_by_employee = {
            emp_id: emp.get('existing_assignments', []) or []
            for emp_id, emp in self.employees.items()
        }

        # 1. Create assignment variables
        self._create_assignment_variables()

        # 2. Add hard constraints (order mirrors evaluateCandidate)
        self._add_shift_coverage_constraints()
        self._add_no_double_booking_constraints()
        self._add_min_rest_constraints()
        self._add_skill_requirements_constraints()
        self._add_availability_constraints()
        self._add_daily_hours_constraints()
        self._add_max_hours_constraints()
        self._add_max_consecutive_days_constraints()

        # 3. Build objective function
        self._build_objective_function()

        print(f"Model built: {len(self.assignments)} assignment variables", file=sys.stderr)

    def _abs_bounds(self, shift: Dict) -> Tuple[int, int]:
        """Absolute [start, end] minutes for a shift on the global calendar,
        rolling an overnight shift's end into the next day. Mirrors
        ScheduleOptimizer._shiftBoundsMs so cross-day overlap and rest match."""
        day = datetime.strptime(shift['date'], '%Y-%m-%d').toordinal() * 1440
        start = day + self._parse_time(shift['start_time'])
        end = day + self._parse_time(shift['end_time'])
        if end <= start:
            end += 1440
        return start, end
    
    def _create_assignment_variables(self):
        """Create boolean variables for each (employee, shift) pair."""
        # Only the ids matter here: the variable is created for every pair, and
        # the entities themselves are read by the constraint builders.
        for shift_id in self.shifts:
            for employee_id in self.employees:
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
        HARD: an employee cannot hold two time-overlapping shifts. Uses absolute
        (date + time) bounds so an overnight shift is compared against the next
        day's shifts too, not just same-date ones — matching the validator and
        the greedy's _shiftBoundsMs. External assignments force the conflicting
        decision shift off entirely.
        """
        shift_items = list(self.shifts.items())
        for employee_id in self.employees.keys():
            externals = self.external_by_employee[employee_id]
            for i, (sid1, s1) in enumerate(shift_items):
                # Decision shift vs the employee's fixed external shifts.
                for ext in externals:
                    if self._shifts_overlap_abs(s1, ext):
                        self.model.Add(self.assignments[(employee_id, sid1)] == 0)
                # Decision shift vs decision shift.
                for sid2, s2 in shift_items[i + 1:]:
                    if self._shifts_overlap_abs(s1, s2):
                        self.model.Add(
                            self.assignments[(employee_id, sid1)]
                            + self.assignments[(employee_id, sid2)] <= 1
                        )

    def _add_min_rest_constraints(self):
        """
        HARD: consecutive (non-overlapping) shifts for one employee must leave at
        least `min_hours_between_shifts` of rest, across day boundaries. Same
        rule as ComplianceEngine.checkMinRest and the validator's min-rest check.
        External assignments are included as fixed neighbours.
        """
        min_rest_minutes = int(self.constraints_config.get('min_hours_between_shifts', 8)) * 60
        shift_items = list(self.shifts.items())
        for employee_id in self.employees.keys():
            externals = self.external_by_employee[employee_id]
            for i, (sid1, s1) in enumerate(shift_items):
                for ext in externals:
                    if not self._shifts_overlap_abs(s1, ext) and \
                            self._rest_conflict(s1, ext, min_rest_minutes):
                        self.model.Add(self.assignments[(employee_id, sid1)] == 0)
                for sid2, s2 in shift_items[i + 1:]:
                    if not self._shifts_overlap_abs(s1, s2) and \
                            self._rest_conflict(s1, s2, min_rest_minutes):
                        self.model.Add(
                            self.assignments[(employee_id, sid1)]
                            + self.assignments[(employee_id, sid2)] <= 1
                        )

    def _shifts_overlap_abs(self, shift1: Dict, shift2: Dict) -> bool:
        """Absolute-time overlap check (date + time, overnight-aware)."""
        a_start, a_end = self._abs_bounds(shift1)
        b_start, b_end = self._abs_bounds(shift2)
        return a_start < b_end and b_start < a_end

    def _rest_conflict(self, a: Dict, b: Dict, min_rest_minutes: int) -> bool:
        """True if the rest gap between two non-overlapping shifts is too short."""
        a_start, a_end = self._abs_bounds(a)
        b_start, b_end = self._abs_bounds(b)
        gap = (b_start - a_end) if a_end <= b_start else (a_start - b_end)
        return gap < min_rest_minutes

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
    
    def _add_daily_hours_constraints(self):
        """
        HARD: an employee's assigned hours on any single date must stay within a
        one-day budget of max(8, max_hours_per_week / 5). Mirrors the validator's
        daily-hours rule and evaluateCandidate step 5. External hours on the date
        are pre-charged against the budget.
        """
        for employee_id, employee in self.employees.items():
            daily_budget = max(8, employee.get('max_hours_per_week', 40) // 5)

            # Pre-existing external hours per date.
            external_hours_by_date: Dict[str, int] = {}
            for ext in self.external_by_employee[employee_id]:
                external_hours_by_date[ext['date']] = (
                    external_hours_by_date.get(ext['date'], 0) + self._calculate_shift_hours(ext)
                )

            # Decision-shift hours per date.
            shifts_by_date: Dict[str, List[str]] = {}
            for shift_id, shift in self.shifts.items():
                shifts_by_date.setdefault(shift['date'], []).append(shift_id)

            dates = set(shifts_by_date) | set(external_hours_by_date)
            for date in dates:
                terms = [
                    self.assignments[(employee_id, sid)] * self._calculate_shift_hours(self.shifts[sid])
                    for sid in shifts_by_date.get(date, [])
                ]
                self.model.Add(
                    sum(terms) + external_hours_by_date.get(date, 0) <= daily_budget
                )

    def _add_max_hours_constraints(self):
        """
        HARD: rolling 7-day hours cap. For every worked date `d` (decision or
        external), the hours assigned in the window [d, d+7) must not exceed
        max_hours_per_week. This replaces the old ISO-calendar-week grouping,
        which let an employee work e.g. Thu–Sun of one week and Mon–Wed of the
        next (11 days) without either "week" tripping. The forward-window form
        matches the validator exactly. External hours in the window count too.
        """
        for employee_id, employee in self.employees.items():
            max_hours = employee.get('max_hours_per_week')
            if not max_hours:
                continue

            externals = self.external_by_employee[employee_id]
            external_ord = [
                (datetime.strptime(ext['date'], '%Y-%m-%d').toordinal(),
                 self._calculate_shift_hours(ext))
                for ext in externals
            ]
            decision_ord = [
                (datetime.strptime(shift['date'], '%Y-%m-%d').toordinal(), shift_id)
                for shift_id, shift in self.shifts.items()
            ]

            anchor_days = {o for o, _ in external_ord} | {o for o, _ in decision_ord}
            for anchor in anchor_days:
                window = range(anchor, anchor + 7)
                terms = [
                    self.assignments[(employee_id, sid)] * self._calculate_shift_hours(self.shifts[sid])
                    for o, sid in decision_ord if o in window
                ]
                fixed = sum(h for o, h in external_ord if o in window)
                self.model.Add(sum(terms) + fixed <= max_hours)

    def _add_max_consecutive_days_constraints(self):
        """
        HARD: cap the longest run of consecutive worked calendar days at
        max_consecutive_days. A day counts as worked if the employee is assigned
        any decision shift that day or already holds an external shift that day.
        Mirrors the validator's consecutive-days rule (evaluateCandidate step 7),
        which the old model only expressed as a soft objective penalty.
        """
        for employee_id, employee in self.employees.items():
            max_consec = employee.get('max_consecutive_days')
            if not max_consec:
                continue

            shifts_by_ord: Dict[int, List[str]] = {}
            for shift_id, shift in self.shifts.items():
                o = datetime.strptime(shift['date'], '%Y-%m-%d').toordinal()
                shifts_by_ord.setdefault(o, []).append(shift_id)

            external_ords = {
                datetime.strptime(ext['date'], '%Y-%m-%d').toordinal()
                for ext in self.external_by_employee[employee_id]
            }

            all_ords = set(shifts_by_ord) | external_ords
            if not all_ords:
                continue

            # Per-day "worked" indicator over the full span so windows can span
            # dates that have no shifts (a gap day breaks the run → worked=0).
            day_worked: Dict[int, object] = {}
            for o in range(min(all_ords), max(all_ords) + 1):
                if o in external_ords:
                    day_worked[o] = 1  # fixed external work
                elif o in shifts_by_ord:
                    var = self.model.NewBoolVar(f'worked_e{employee_id}_o{o}')
                    self.model.AddMaxEquality(
                        var, [self.assignments[(employee_id, sid)] for sid in shifts_by_ord[o]]
                    )
                    day_worked[o] = var
                else:
                    day_worked[o] = 0  # no shift, no external → not worked

            span_start, span_end = min(all_ords), max(all_ords)
            for start in range(span_start, span_end - max_consec + 1):
                window = [day_worked[o] for o in range(start, start + max_consec + 1)]
                self.model.Add(sum(window) <= max_consec)

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

        # Coverage first: reward every filled seat so the solver prefers fully
        # staffing shifts over leaving them empty. Weighted well above
        # preferences so a covered shift is never sacrificed for a preference.
        coverage_weight = int(self.weights.get('shift_coverage', 100.0))
        for var in self.assignments.values():
            objective_terms.append(var * coverage_weight)

        # Employee preferences (correlations): nudge toward preferred shifts and
        # away from avoided ones. +10 / 0 / -10 scaled by the preference weight.
        pref_weight = int(self.weights.get('employee_preferences', 55.0))
        for (emp_id, shift_id), var in self.assignments.items():
            preference = self._get_preference(emp_id, shift_id)
            objective_terms.append(var * preference * pref_weight)

        # Note: consecutive-days is now a HARD constraint
        # (_add_max_consecutive_days_constraints), so it is no longer expressed
        # as a soft objective penalty here — that would be redundant and could
        # only ever discourage solutions the hard constraint already forbids.

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
        # Must stay False: the --stdout contract is a single pure-JSON document
        # on stdout, and CP-SAT's search log would otherwise interleave with it
        # and break the caller's JSON.parse (both the Node wrapper and the
        # parity suite). Diagnostic prints in this script all target stderr.
        solver.parameters.log_search_progress = False
        
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
