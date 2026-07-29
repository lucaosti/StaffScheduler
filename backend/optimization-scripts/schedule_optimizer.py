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

import os
import sys
import json
import argparse
from datetime import datetime
from typing import List, Dict, Optional, Tuple
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
        self.coverage_shortfall = {}  # shift_id -> IntVar (staff missing below min_staff)
        self.coverage_surplus = {}  # shift_id -> IntVar (staff scheduled beyond min_staff)
        self.qualified_shortfall = {}  # (shift_id, skill) -> IntVar (qualified people missing)
        self.over_committed = []  # employees whose fixed external work already breaches a cap
        self._day_worked_cache: Dict[str, Dict[int, object]] = {}
        
        # Extract data
        self.shifts = {s['id']: s for s in problem_data['shifts']}
        self.employees = {e['id']: e for e in problem_data['employees']}
        self.skills = problem_data.get('skills', {})
        self.preferences = problem_data.get('preferences', {})
        self.constraints_config = problem_data.get('constraints', {})
        # Commitments on THIS schedule: pairings a previous run published and
        # people have been told about. Distinct from existing_assignments,
        # which are other schedules' shifts and merely consume capacity.
        self.pairings = problem_data.get('pairings', []) or []
        self.pinned = {
            (str(p['employee_id']), str(p['shift_id']))
            for p in problem_data.get('pinned_assignments', []) or []
        }
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

        # An employee whose fixed external work ALREADY breaches a cap makes the
        # model infeasible on its own — no decision here can repair a fact from
        # another schedule. They are diagnosed and excluded rather than allowed
        # to fail the whole run: they cannot legally take more work in any case,
        # so removing them changes no legal outcome, and the engine keeps
        # answering for everyone else. Same principle that made coverage a
        # target rather than a hard constraint.
        self.over_committed = self._diagnose_over_commitment()
        excluded = {f['employee_id'] for f in self.over_committed}
        if excluded:
            for emp_id in excluded:
                self.employees.pop(emp_id, None)
            print(
                f'Excluded {len(excluded)} over-committed employee(s) from assignment',
                file=sys.stderr,
            )

        # 1. Create assignment variables
        self._create_assignment_variables()

        # 2. Add hard constraints (order mirrors evaluateCandidate)
        self._add_shift_coverage_constraints()
        self._add_qualified_staff_constraints()
        self._add_pairing_constraints()
        self._add_no_double_booking_constraints()
        self._add_min_rest_constraints()
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
    
    def _is_eligible(self, employee: Dict, shift: Dict) -> bool:
        """
        Whether this pairing is possible at all, from facts known before search.

        Skills and declared unavailability are STATIC: nothing the solver
        decides can change whether someone holds a qualification or booked that
        day off. So a pairing failing either can be excluded from the model
        rather than represented and then forbidden.
        """
        required_skills = set(shift.get('required_skills', []))
        held = set(employee.get('skills', []))
        if required_skills and not required_skills.issubset(held):
            return False

        # Proficiency. An absent requirement means any level will do, and an
        # absent level on the employee means "unknown" rather than "novice", so
        # a problem carrying no levels behaves exactly as before. Kept in
        # lock-step with constraintValidator, which is the authority.
        required_levels = shift.get('required_skill_levels') or {}
        emp_levels = employee.get('skill_levels') or {}
        for skill, needed in required_levels.items():
            level = emp_levels.get(skill)
            if level is not None and level < needed:
                return False
        if shift['date'] in set(employee.get('unavailable_dates', [])):
            return False
        return True

    def _var(self, employee_id: str, shift_id: str):
        """The decision variable for a pairing, or None when it was excluded."""
        return self.assignments.get((employee_id, shift_id))

    def _diagnose_over_commitment(self) -> List[Dict]:
        """
        Employees whose FIXED external work already breaches a cap.

        WHY THIS IS THE ONLY DIAGNOSIS THE MODEL STILL NEEDS. Before coverage
        became a minimised shortfall (rather than a hard constraint), INFEASIBLE
        could mean almost anything, and the issue asking for explainability
        assumed a general unsat-core mechanism was required. Measuring after the
        change showed otherwise: assigning NOTHING now satisfies every remaining
        hard constraint — max_staff, double-booking, minimum rest, the hours
        caps and consecutive days are all upper bounds that an empty schedule
        meets — and skills and availability no longer produce constraints at
        all, since ineligible pairings simply get no variable.

        So exactly one thing can still make the model infeasible: an employee's
        `existing_assignments` — shifts they already hold on OTHER schedules,
        which are fixed facts here — already exceeding a daily, weekly or
        consecutive-day limit on their own. No decision this solver makes can
        repair that.

        That makes an unsat core the wrong tool. The condition is checkable
        deterministically before solving, in one pass over data we already
        have, and yields the employee, the rule and the numbers rather than a
        set of opaque literals. It is also cheaper: assumption literals disable
        parts of CP-SAT's presolve for every run, to explain a case that should
        be rare.

        The over-committed employee is then EXCLUDED from assignment rather
        than making the whole run fail. They cannot legally take more work in
        any case, so removing them changes no legal outcome — and it keeps the
        engine answering for everyone else, which is the same principle that
        made coverage a target instead of a constraint.
        """
        findings: List[Dict] = []
        for employee_id, employee in self.employees.items():
            external = self.external_by_employee.get(employee_id, [])
            if not external:
                continue

            # Daily.
            daily_budget = employee.get('max_hours_per_day') or max(
                8, employee.get('max_hours_per_week', 40) // 5
            )
            hours_by_date: Dict[str, int] = {}
            for ext in external:
                hours_by_date[ext['date']] = (
                    hours_by_date.get(ext['date'], 0) + self._calculate_shift_hours(ext)
                )
            for date, hours in sorted(hours_by_date.items()):
                if hours > daily_budget:
                    findings.append({
                        'employee_id': employee_id,
                        'rule': 'daily-hours',
                        'detail': (
                            f'already holds {hours}h on {date} from other schedules, '
                            f'exceeding the {daily_budget}h daily limit'
                        ),
                    })

            # Rolling weekly.
            weekly_cap = employee.get('max_hours_per_week')
            if weekly_cap:
                ords = [
                    (datetime.strptime(ext['date'], '%Y-%m-%d').toordinal(),
                     self._calculate_shift_hours(ext))
                    for ext in external
                ]
                for anchor, _ in ords:
                    window = sum(h for o, h in ords if anchor <= o < anchor + 7)
                    if window > weekly_cap:
                        findings.append({
                            'employee_id': employee_id,
                            'rule': 'weekly-hours',
                            'detail': (
                                f'already holds {window}h in the 7 days from '
                                f'{datetime.fromordinal(anchor).date()} on other schedules, '
                                f'exceeding the {weekly_cap}h weekly limit'
                            ),
                        })
                        break

            # Consecutive days.
            max_consec = employee.get('max_consecutive_days')
            if max_consec:
                days = sorted({
                    datetime.strptime(ext['date'], '%Y-%m-%d').toordinal() for ext in external
                })
                run = 1
                # Indexed rather than `zip(days, days[1:])`: ruff requires an
                # explicit `strict=` on zip (B905), and that keyword is Python
                # 3.10+ while requirements.txt supports 3.8+. Indexing sidesteps
                # both without a version guard.
                for i in range(1, len(days)):
                    run = run + 1 if days[i] == days[i - 1] + 1 else 1
                    if run > max_consec:
                        findings.append({
                            'employee_id': employee_id,
                            'rule': 'consecutive-days',
                            'detail': (
                                f'already works {run} consecutive days on other schedules, '
                                f'exceeding the limit of {max_consec}'
                            ),
                        })
                        break

        return findings

    def _create_assignment_variables(self):
        """
        One boolean per FEASIBLE (employee, shift) pairing.

        WHY NOT EVERY PAIR. It used to be every pair unconditionally, and the
        skill and availability builders then pinned the impossible ones to 0 —
        so the model carried a variable, a constraint and the propagation cost
        for pairings that could never be anything but zero. With 2,000 shifts
        and 100 employees that is 200,000 variables before any structural
        filtering, and the excluded fraction is large in exactly the cases that
        matter: specialised skills and heavy leave periods.

        The model is not made smaller in meaning, only in size: the solution
        space is identical, because the omitted variables were fixed at 0.

        Everything downstream reads pairings through `_var`, which returns None
        for an excluded pairing. Sums simply skip it — omitting a term that was
        pinned to 0 changes nothing — and pairwise constraints skip when either
        side is absent, since a constraint on an impossible assignment is
        vacuous.
        """
        for shift_id, shift in self.shifts.items():
            for employee_id, employee in self.employees.items():
                if not self._is_eligible(employee, shift):
                    continue
                var_name = f'assign_e{employee_id}_s{shift_id}'
                self.assignments[(employee_id, shift_id)] = self.model.NewBoolVar(var_name)

        print(
            f'Eligible pairings: {len(self.assignments)} of '
            f'{len(self.shifts) * len(self.employees)}',
            file=sys.stderr,
        )
    
    def _add_shift_coverage_constraints(self):
        """
        max_staff is HARD; min_staff is a TARGET whose shortfall is minimised.

        WHY min_staff IS NOT HARD. It used to be, and the consequence was
        backwards: when the available staff could not cover even one shift,
        CP-SAT proved the whole model INFEASIBLE and returned nothing, so the
        run degraded to the greedy engine. The harder the problem, the worse
        the engine you got — and understaffing is the normal condition in
        workforce management, not an exceptional one. A single uncoverable
        shift discarded the optimum for all the others.

        It also made the degradation signal misleading. `degraded: true` is
        meant to say "the optimal engine was unavailable"; there the engine ran
        fine and correctly proved the model as stated had no solution. The
        model was wrong, not the run.

        Shortfall is therefore a variable per shift, minimised at the MEDIUM
        objective level (see _build_objective_function), so it outranks every
        soft preference but can never make the problem infeasible. INFEASIBLE
        now means what it should: a genuine conflict among rest, skill,
        availability or hours rules.

        WHY max_staff STAYS HARD. It is a real physical ceiling — only so many
        people fit behind a counter or on a ward round — not a preference.

        WHY NOTHING REWARDS STAFFING BETWEEN min AND max. The objective used to
        add a flat reward for EVERY assignment, which combined with the hard
        bounds meant the solver always filled every shift to max_staff: more
        people was always worth more, and nothing charged for them. So
        min_staff never functioned as a target at all, and the greedy engine
        (which fills only to min_staff) produced systematically different
        staffing from the same input, invisibly — the parity suite asserts
        hard-constraint validity, never staffing level. Coverage is now
        expressed solely as shortfall BELOW min_staff, so the two engines aim
        at the same thing.
        """
        for shift_id, shift in self.shifts.items():
            min_staff = shift.get('min_staff', 1)
            max_staff = shift.get('max_staff', min_staff + 2)

            assignments_for_shift = [
                var for emp_id in self.employees
                if (var := self._var(emp_id, shift_id)) is not None
            ]

            # Hard ceiling.
            self.model.Add(sum(assignments_for_shift) <= max_staff)

            # shortfall = max(0, min_staff - assigned), expressed with the
            # standard CP-SAT idiom: bound it below by both 0 and the deficit,
            # and let the objective (which minimises it) push it down to the
            # true maximum. An equality would need an auxiliary boolean per
            # shift for no benefit, since nothing rewards a LARGER shortfall.
            shortfall = self.model.NewIntVar(0, min_staff, f'shortfall_s{shift_id}')
            self.model.Add(shortfall >= min_staff - sum(assignments_for_shift))
            self.coverage_shortfall[shift_id] = shortfall

            # surplus = max(0, assigned - min_staff): people scheduled beyond
            # what the shift requires. Tracked so the objective can charge for
            # them; see _build_objective_function for why that is necessary
            # once workload fairness enters the model.
            surplus_cap = max(0, max_staff - min_staff)
            surplus = self.model.NewIntVar(0, surplus_cap, f'surplus_s{shift_id}')
            self.model.Add(surplus >= sum(assignments_for_shift) - min_staff)
            # The cap is kept alongside the variable rather than read back from
            # the solver's proto: `var.Proto().domain` is an internal detail
            # whose shape is not part of the OR-Tools public API and differs
            # between versions. Storing what we already know avoids depending
            # on it at all.
            self.coverage_surplus[shift_id] = (surplus, surplus_cap)
    
    def _add_qualified_staff_constraints(self):
        """
        "At least N people on this shift at proficiency L or above."

        WHY THIS IS NOT THE PROFICIENCY FILTER. `required_skill_levels` says
        EVERYONE assigned must be at least this good, and is enforced by
        excluding under-qualified pairings from the model entirely. This is a
        COUNT over the shift: one senior per night shift does not mean everyone
        must be senior, and requiring that would make most rotas unstaffable.
        The two are independent requirements over the same shift.

        WHY A MINIMISED SHORTFALL RATHER THAN A HARD CONSTRAINT. Exactly the
        reasoning that made coverage a target: made hard, a period with no
        available senior yields no schedule at all, and the harder the problem
        the worse the answer. The deficit joins the coverage shortfall at
        MEDIUM, so it outranks every preference but can never make the model
        infeasible.

        An unknown proficiency does NOT count toward the requirement — the
        reverse of the eligibility filter, where unknown means "no reason to
        exclude". Here it would mean asserting a competence nobody recorded, on
        the one rule that exists to guarantee it.
        """
        for shift_id, shift in self.shifts.items():
            requirements = shift.get('qualified_staff') or {}
            for skill, spec in requirements.items():
                level = spec.get('level')
                needed = spec.get('count')
                if not level or not needed:
                    continue

                qualifying = [
                    var for emp_id, employee in self.employees.items()
                    if skill in set(employee.get('skills', []))
                    and (employee.get('skill_levels') or {}).get(skill, 0) >= level
                    and (var := self._var(emp_id, shift_id)) is not None
                ]

                shortfall = self.model.NewIntVar(
                    0, needed, f'qual_short_s{shift_id}_{skill}'
                )
                # max(0, needed - qualified), the same idiom as coverage: bound
                # below by the deficit and let the objective push it down.
                self.model.Add(shortfall >= needed - sum(qualifying))
                self.qualified_shortfall[(shift_id, skill)] = shortfall

    def _add_pairing_constraints(self):
        """
        Who may share a shift.

        `apart`: the two must not both be on a shift — `a + b <= 1`.
        `requires`: the dependent may only work a shift the other also works —
        `a <= b`. DIRECTIONAL on purpose: a trainee must not work
        unsupervised, but the supervisor works fine alone, and a symmetric rule
        would forbid the supervisor from taking any shift the trainee is not
        on.

        WHY THESE CAN BE HARD, WHICH THEY COULD NOT HAVE BEEN BEFORE. While
        coverage was a hard constraint, "the trainee may only work with their
        supervisor" could make a period INFEASIBLE — no supervisor available,
        no schedule at all. Now that coverage is a minimised shortfall an
        unsatisfiable pairing simply leaves that person unassigned and the
        shift short, which is reported. So the rule is enforced exactly rather
        than approximated, and its cost surfaces in a number the planner
        already reads.

        Unlike skills and availability these cannot be folded into variable
        existence: whether a pairing is legal depends on who ELSE is assigned,
        so they are genuine constraints rather than an eligibility filter.
        """
        for rule in self.pairings:
            emp = str(rule.get('employee_id'))
            other = str(rule.get('other_id'))
            kind = rule.get('kind')
            for shift_id in self.shifts:
                a = self._var(emp, shift_id)
                b = self._var(other, shift_id)
                if a is None:
                    continue  # This person cannot take the shift anyway.
                if kind == 'apart':
                    if b is not None:
                        self.model.Add(a + b <= 1)
                elif kind == 'requires':
                    if b is None:
                        # The other person cannot work this shift at all, so
                        # the dependent must not either.
                        self.model.Add(a == 0)
                    else:
                        self.model.Add(a <= b)

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
                        if (v := self._var(employee_id, sid1)) is not None:
                            self.model.Add(v == 0)
                # Decision shift vs decision shift.
                for sid2, s2 in shift_items[i + 1:]:
                    if self._shifts_overlap_abs(s1, s2):
                        v1 = self._var(employee_id, sid1)
                        v2 = self._var(employee_id, sid2)
                        if v1 is None or v2 is None:
                            continue
                        self.model.Add(
                            v1 + v2 <= 1
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
                        if (v := self._var(employee_id, sid1)) is not None:
                            self.model.Add(v == 0)
                for sid2, s2 in shift_items[i + 1:]:
                    if not self._shifts_overlap_abs(s1, s2) and \
                            self._rest_conflict(s1, s2, min_rest_minutes):
                        v1 = self._var(employee_id, sid1)
                        v2 = self._var(employee_id, sid2)
                        if v1 is None or v2 is None:
                            continue
                        self.model.Add(
                            v1 + v2 <= 1
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
    
    # Skill requirements and declared availability are enforced by
    # _create_assignment_variables: a pairing failing either is never given a
    # variable, so there is nothing left to constrain. The builders that used
    # to pin those variables to 0 are gone rather than kept as no-ops —
    # a constraint that can never bind is a claim the reader has to verify.

    def _add_daily_hours_constraints(self):
        """
        HARD: an employee's assigned hours on any single date must stay within a
        one-day budget of max(8, max_hours_per_week / 5). Mirrors the validator's
        daily-hours rule and evaluateCandidate step 5. External hours on the date
        are pre-charged against the budget.
        """
        for employee_id, employee in self.employees.items():
            # Contract cap when present; otherwise the historical derived
            # formula. Mirrors constraintValidator, which is the authority.
            daily_budget = employee.get('max_hours_per_day') or max(
                8, employee.get('max_hours_per_week', 40) // 5
            )

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
                    v * self._calculate_shift_hours(self.shifts[sid])
                    for sid in shifts_by_date.get(date, [])
                    if (v := self._var(employee_id, sid)) is not None
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
                    v * self._calculate_shift_hours(self.shifts[sid])
                    for o, sid in decision_ord
                    if o in window and (v := self._var(employee_id, sid)) is not None
                ]
                fixed = sum(h for o, h in external_ord if o in window)
                self.model.Add(sum(terms) + fixed <= max_hours)

    def _day_worked_indicators(self, employee_id: str) -> Dict[int, object]:
        """
        Per-day "is this person working" indicator, over the whole span.

        Built over every ordinal in the span rather than only days that have
        shifts, because a gap day is meaningful: it breaks a run of worked days
        and contributes to a rest block. A `1` is fixed external work, a `0` is
        a day this employee cannot be working, and a BoolVar is a day the
        solver decides.

        Cached per employee: the consecutive-days cap and the rest-block goal
        both need exactly this, and building it twice would create two
        independent sets of variables describing the same fact — which CP-SAT
        would then have to reconcile through the assignment variables rather
        than knowing they are the same thing.
        """
        cached = self._day_worked_cache.get(employee_id)
        if cached is not None:
            return cached

        shifts_by_ord: Dict[int, List[str]] = {}
        for shift_id, shift in self.shifts.items():
            o = datetime.strptime(shift['date'], '%Y-%m-%d').toordinal()
            shifts_by_ord.setdefault(o, []).append(shift_id)

        external_ords = {
            datetime.strptime(ext['date'], '%Y-%m-%d').toordinal()
            for ext in self.external_by_employee.get(employee_id, [])
        }

        all_ords = set(shifts_by_ord) | external_ords
        if not all_ords:
            self._day_worked_cache[employee_id] = {}
            return {}

        day_worked: Dict[int, object] = {}
        for o in range(min(all_ords), max(all_ords) + 1):
            if o in external_ords:
                day_worked[o] = 1  # fixed external work
            elif o in shifts_by_ord and (
                day_vars := [
                    v for sid in shifts_by_ord[o]
                    if (v := self._var(employee_id, sid)) is not None
                ]
            ):
                var = self.model.NewBoolVar(f'worked_e{employee_id}_o{o}')
                self.model.AddMaxEquality(var, day_vars)
                day_worked[o] = var
            else:
                # No shift that day, no external work, OR every shift that day
                # is one this employee cannot take (lacks the skill, or booked
                # off). All three mean the same thing here: not worked. The
                # `day_vars` guard is load-bearing — `AddMaxEquality` over an
                # EMPTY list is unsatisfiable, so without it an employee
                # ineligible for every shift on one day made the whole model
                # INFEASIBLE. That could not happen while a variable existed
                # for every pairing.
                day_worked[o] = 0

        self._day_worked_cache[employee_id] = day_worked
        return day_worked

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

            day_worked = self._day_worked_indicators(employee_id)
            span_start, span_end = min(all_ords), max(all_ords)
            for start in range(span_start, span_end - max_consec + 1):
                window = [day_worked[o] for o in range(start, start + max_consec + 1)]
                self.model.Add(sum(window) <= max_consec)

    def _calculate_shift_hours(self, shift: Dict) -> int:
        """Calculate shift duration in hours."""
        start = self._parse_time(shift['start_time'])
        end = self._parse_time(shift['end_time'])
        
        # `<=` and not `<`: a shift whose end equals its start spans a full
        # day, matching _abs_bounds and the TypeScript shiftHours. The two
        # disagreed until this was reconciled, and this is the safe direction —
        # for a cap, over-counting refuses work that might have been allowed,
        # while a zero-hour shift is invisible to every limit.
        if end <= start:
            end += 24 * 60

        return (end - start) // 60  # Convert minutes to hours
    
    def _shift_minutes(self, shift: Dict) -> int:
        """
        Shift duration in MINUTES, overnight-aware.

        Fairness balances on minutes rather than the integer hours used by the
        cap constraints, because `_calculate_shift_hours` truncates: a 7.5-hour
        shift counts as 7. For a cap that under-counts is merely conservative,
        but for BALANCING it introduces a systematic bias — half-hour shifts
        become invisible, so someone holding many of them looks under-loaded
        and keeps being given more.
        """
        start = self._parse_time(shift['start_time'])
        end = self._parse_time(shift['end_time'])
        if end <= start:
            end += 24 * 60
        return end - start

    def _fairness_terms(self, scale: int) -> Tuple[List, int]:
        """
        SOFT: balance total workload across employees.

        WHY THIS DID NOT EXIST. The objective maximised coverage and
        preferences and nothing else, so nothing preferred giving eight shifts
        each to two people over twelve to one and four to the other — both
        scored identically, and which came out was an artefact of CP-SAT's
        search order. Meanwhile `/api/reports/fairness` computed and displayed
        a fairness figure, so the system MEASURED and REPORTED an equilibrium
        the solver had never been asked to produce. A planner reading a poor
        number had no lever: re-running changed nothing systematically.

        WHY SPREAD (max - min) AND NOT SQUARED DEVIATION. The textbook fairness
        term penalises squared deviation from the mean, which makes one person
        4 hours over cost more than two people 2 hours over — the shape most
        people mean by "fair". CP-SAT is a linear/integer solver, so squaring
        is not available directly; it would need piecewise-linear
        approximation, which adds variables and a modelling choice (how many
        pieces, where) that is harder to justify than the thing it approximates.
        Minimising `max_load - min_load` is exactly expressible, needs two
        auxiliary variables total, and targets the complaint that actually gets
        raised: the gap between the busiest and least-busy person. Its known
        weakness is indifference to the middle of the distribution — recorded
        here rather than discovered later.

        Employees with no assignments sit at load 0 and pull `min` down, which
        is intended: someone left entirely unused IS an unequal distribution.
        Where there is simply more staff than work the spread is unavoidable
        and this term cannot improve it, so it does no harm either.
        """
        if len(self.employees) < 2:
            return [], 0  # Nothing to balance.

        loads = []
        for emp_id in self.employees:
            terms = [
                v * self._shift_minutes(shift)
                for shift_id, shift in self.shifts.items()
                if (v := self._var(emp_id, shift_id)) is not None
            ]
            if not terms:
                return [], 0
            upper = sum(self._shift_minutes(s) for s in self.shifts.values())
            load = self.model.NewIntVar(0, upper, f'load_e{emp_id}')
            self.model.Add(load == sum(terms))
            loads.append(load)

        upper = sum(self._shift_minutes(s) for s in self.shifts.values())
        max_load = self.model.NewIntVar(0, upper, 'max_load')
        min_load = self.model.NewIntVar(0, upper, 'min_load')
        self.model.AddMaxEquality(max_load, loads)
        self.model.AddMinEquality(min_load, loads)

        spread = self.model.NewIntVar(0, upper, 'load_spread')
        self.model.Add(spread == max_load - min_load)

        # Terms AND their largest possible magnitude, returned together: the
        # caller cannot take one without the other, which is what makes the
        # lexicographic bound impossible to forget.
        return [-spread * scale], upper * scale

    def _preference_terms(self) -> Tuple[List, int]:
        """SOFT: nudge toward preferred shifts and away from avoided ones."""
        weight = int(self.weights.get('employee_preferences', 55.0))
        terms, bound = [], 0
        for (emp_id, shift_id), var in self.assignments.items():
            coefficient = self._get_preference(emp_id, shift_id) * weight
            if coefficient:
                terms.append(var * coefficient)
                # Every soft variable is boolean, so the largest magnitude this
                # contributor can reach is the sum of its absolute coefficients.
                bound += abs(coefficient)
        return terms, bound

    def _surplus_terms(self, fairness_scale: int) -> Tuple[List, int]:
        """
        SOFT: charge for staffing beyond what a shift requires.

        Needed the moment fairness exists. Nothing rewards staffing between
        min_staff and max_staff deliberately — max_staff is a ceiling, not a
        target — but fairness rewards it INDIRECTLY, because adding people
        flattens the load distribution. Observed directly: a 3-shift /
        4-employee fixture went from 6 assignments to 8, buying a perfectly
        even split with two extra shifts of wages. An optimizer that inflates
        payroll to make its own fairness metric look good is exactly the
        "measured but not meaningful" failure fairness was added to fix.

        The weight is DERIVED, not tuned: one extra assignment can improve the
        spread by at most the longest shift's duration, so charging strictly
        more than that per surplus person makes over-staffing never worth a
        fairness gain — while leaving it available when coverage genuinely
        needs it, since shortfall sits at MEDIUM and outranks both.
        """
        if not self.coverage_surplus:
            return [], 0
        longest = max((self._shift_minutes(sh) for sh in self.shifts.values()), default=0)
        scale = longest * fairness_scale + 1
        terms, bound = [], 0
        for surplus, surplus_cap in self.coverage_surplus.values():
            terms.append(-surplus * scale)
            bound += surplus_cap * scale
        return terms, bound

    def _commitment_terms(self, scale: int) -> Tuple[List, int]:
        """
        Reward keeping a published assignment.

        A commitment is something a person arranged their life around, so
        breaking one must never be bought with a preference or a fairness gain
        however many accumulate — which is why this is its own level rather
        than a heavy soft weight. A weight cannot make a lexicographic
        statement.
        """
        terms, bound = [], 0
        for (emp_id, shift_id) in self.pinned:
            var = self._var(emp_id, shift_id)
            if var is None:
                # The pairing is no longer possible — the person lost the skill
                # or booked the day off. Nothing to reward; the diff reports the
                # commitment as broken, which is the honest answer.
                continue
            terms.append(var * scale)
            bound += scale
        return terms, bound

    def _rest_block_terms(self, scale: int) -> Tuple[List, int]:
        """
        SOFT: at least one run of `min_consecutive_days_off` free days per
        rolling 7-day window.

        WHY THIS IS NOT THE CONSECUTIVE-DAYS CAP INVERTED. `max_consecutive_days`
        bounds how long someone works without a break and says nothing about the
        break. Five-on, one-off, five-on, one-off satisfies it completely while
        the person never gets two days together — the difference between "not
        overworked" and "rested", and only the first was modelled.

        WHY A ROLLING 7-DAY WINDOW AND "AT LEAST ONE BLOCK". Requiring EVERY
        rest run to reach the length would forbid a single day off outright,
        which is often fine and sometimes requested. Requiring one block per
        schedule PERIOD is meaningless over a month. One per rolling week is the
        formulation working-time regulations use and what people mean by a
        weekend.

        WHY SOFT. Made hard, an understaffed period becomes unsolvable — and
        refusing to answer is exactly what making coverage a target instead of a
        constraint was meant to stop.

        MODELLING. For each window, a boolean per candidate position of an
        N-day block, true only when every day in it is free; the window is
        satisfied if any position holds. Penalising the unsatisfied windows
        rather than rewarding the satisfied ones keeps the sign consistent with
        the other soft terms, which are all costs.
        """
        terms, bound = [], 0
        for employee_id, employee in self.employees.items():
            required = employee.get('min_consecutive_days_off')
            if not required:
                continue

            day_worked = self._day_worked_indicators(employee_id)
            if not day_worked:
                continue
            ordinals = sorted(day_worked)
            span_start, span_end = ordinals[0], ordinals[-1]

            # Only windows that fit entirely inside the span are judged: one
            # running past the end would show free days that are really just
            # absence of data.
            for start in range(span_start, span_end - 6 + 1):
                positions = []
                for offset in range(0, 7 - required + 1):
                    block = [day_worked[start + offset + d] for d in range(required)]
                    # `day_worked` holds either a plain int (a day already
                    # decided: 1 = fixed external work, 0 = cannot be working)
                    # or a BoolVar. They must be told apart by TYPE, not by
                    # comparison: `var == 1` on a CP-SAT variable builds a
                    # linear expression, and evaluating that as a boolean
                    # raises rather than answering.
                    if any(isinstance(d, int) and d == 1 for d in block):
                        continue  # fixed external work — this position cannot be free
                    free = self.model.NewBoolVar(f'rest_e{employee_id}_w{start}_p{offset}')
                    # free == 1 implies every decidable day in the block is off.
                    for d in block:
                        if isinstance(d, int):
                            continue  # constant free day, nothing to constrain
                        self.model.Add(d == 0).OnlyEnforceIf(free)
                    positions.append(free)

                if not positions:
                    continue  # no position can ever be free; nothing to optimise

                satisfied = self.model.NewBoolVar(f'rested_e{employee_id}_w{start}')
                self.model.AddMaxEquality(satisfied, positions)
                # Cost the UNsatisfied window, so the term is a penalty like the
                # others rather than a reward that inflates the objective floor.
                terms.append(-(1 - satisfied) * scale)
                bound += scale

        return terms, bound

    def _is_weekend(self, date: str) -> bool:
        """
        Whether a date falls on a configured weekend day.

        `weekend_days` uses 0 = Sunday, matching JavaScript's `getUTCDay` so the
        validator and this model agree on the same numbers; Python's `weekday()`
        is 0 = Monday, hence the conversion.
        """
        weekend_days = set(self.constraints_config.get('weekend_days', [0, 6]))
        return datetime.strptime(date, '%Y-%m-%d').weekday() in {(d - 1) % 7 for d in weekend_days}

    def _is_night(self, shift: Dict) -> bool:
        """
        Whether a shift overlaps the configured night window.

        OVERLAP, NOT START TIME. A start-time threshold is simpler and wrong at
        the edges: a 22:00-06:00 and a 02:00-10:00 shift are both night work,
        but only the first starts "late". Overlap catches both, and it is the
        definition someone working the shift would recognise.

        Configurable for the same reason as the weekend: what counts as
        unsocial is sector-specific, and hard-coding it would embed one
        workplace's norms in the engine.
        """
        window = self.constraints_config.get('night_window', {'start': '22:00', 'end': '06:00'})
        night_start = self._parse_time(window.get('start', '22:00'))
        night_end = self._parse_time(window.get('end', '06:00'))
        start = self._parse_time(shift['start_time'])
        end = self._parse_time(shift['end_time'])
        if end <= start:
            end += 24 * 60

        # The window usually wraps midnight, so the occurrence that catches an
        # early-morning shift is the one that STARTED THE PREVIOUS DAY — 22:00
        # yesterday through 06:00 today. Forward offsets alone missed
        # 02:00-10:00 entirely, which is the case overlap exists to catch.
        for offset in (-24 * 60, 0, 24 * 60):
            w_start = night_start + offset
            w_end = night_end + offset + (24 * 60 if night_end <= night_start else 0)
            if start < w_end and end > w_start:
                return True
        return False

    def _category_balance_terms(
        self, label: str, matches, scale: int, carried_key: Optional[str] = None
    ) -> Tuple[List, int]:
        """
        SOFT: spread the DAYS on which a category of shift is worked evenly
        across employees.

        WHY ONE PARAMETERISED CONTRIBUTOR AND NOT ONE PER CATEGORY. Weekend
        equity and night equity are the same function with a different
        predicate: group the matching shifts by date, build a per-employee
        load, minimise the spread. Two such terms would be a coincidence;
        three would be a pattern, and copying it a third time would mean three
        places to fix when the mechanism is wrong — which has already happened
        twice in this objective, both times on the lexicographic bound.

        WHY DAYS AND NOT HOURS. The unit is what the person loses. A four-hour
        Sunday shift costs the day either way, and counting hours would let
        someone take every Sunday morning and still look lightly loaded. Two
        matching shifts on one date therefore cost one day, not two.

        Work held on OTHER schedules counts: the evening is gone regardless of
        which schedule took it.

        And so does work from BEFORE this period, through `carried_load`:
        without it, equity was true of each month in isolation and could be
        false of the year, since someone who worked every weekend in March
        started April level with a colleague who worked none. The carried
        values are a normalised deviation from the candidates' average, not raw
        counts — see the TypeScript type for why a count penalises whoever
        joined later — and are non-negative because the spread `max - min` is
        invariant under adding the same constant to every load.
        """
        if len(self.employees) < 2:
            return [], 0  # Nothing to balance.

        by_date: Dict[str, List[str]] = {}
        for shift_id, shift in self.shifts.items():
            if matches(shift):
                by_date.setdefault(shift['date'], []).append(shift_id)
        if not by_date:
            return [], 0

        upper = len(by_date)
        loads = []
        max_fixed = 0
        for emp_id in self.employees:
            day_flags = []
            for date, shift_ids in by_date.items():
                day_vars = [
                    v for sid in shift_ids if (v := self._var(emp_id, sid)) is not None
                ]
                if not day_vars:
                    continue
                flag = self.model.NewBoolVar(f'{label}_e{emp_id}_{date}')
                self.model.AddMaxEquality(flag, day_vars)
                day_flags.append(flag)

            fixed = len({
                ext['date'] for ext in self.external_by_employee.get(emp_id, [])
                if matches(ext)
            })
            if carried_key is not None:
                fixed += (
                    self.employees[emp_id].get('carried_load', {}) or {}
                ).get(carried_key, 0)
            max_fixed = max(max_fixed, fixed)
            load = self.model.NewIntVar(0, upper + fixed, f'{label}_load_e{emp_id}')
            self.model.Add(load == sum(day_flags) + fixed)
            loads.append(load)

        if len(loads) < 2:
            return [], 0

        cap = upper + max_fixed
        most = self.model.NewIntVar(0, cap, f'{label}_max')
        least = self.model.NewIntVar(0, cap, f'{label}_min')
        self.model.AddMaxEquality(most, loads)
        self.model.AddMinEquality(least, loads)
        spread = self.model.NewIntVar(0, cap, f'{label}_spread')
        self.model.Add(spread == most - least)

        return [-spread * scale], cap * scale

    def _build_objective_function(self):
        """
        Three lexicographic levels — MEDIUM > DISRUPTION > SOFT — emulated on
        the single scalar CP-SAT optimises.

        WHY LEVELS INSTEAD OF WEIGHTS. Priority expressed as a ratio between
        magnitudes is not a guarantee: at the original coverage-100 /
        preferences-55, two satisfied preferences outweighed one covered seat,
        and whether coverage dominated depended on how many preference terms a
        dataset happened to produce. Every added term made that worse, since
        each addition means re-tuning all the weights together and any tuning
        is valid only for the dataset it was tuned on.

        MEDIUM      coverage shortfall below min_staff.
        DISRUPTION  keeping published assignments.
        SOFT        preferences, workload fairness, surplus-staffing charge.

        HOW THE ORDERING IS ENFORCED, AND WHY IT IS BUILT THIS WAY. Each level
        is scaled strictly above the total magnitude every lower level can
        reach, so no accumulation of lower-level score can buy a single unit of
        a higher one.

        That bound must be PROVEN, not guessed — and getting it wrong is
        silent: the solver returns a schedule with inverted priorities that
        still looks valid. It went wrong twice while this was being built.
        First by deriving the bound from a weight, assuming preferences are
        +1/0/-1 when `_get_preference` returns +/-10, so the ceiling was ten
        times too low and SOFT outranked MEDIUM — the solver left every shift
        empty to satisfy an "avoid" preference. Then by adding the fairness
        term AFTER the bound had been computed, so its magnitude was not
        counted at all, at a far larger scale since a spread in minutes dwarfs
        any preference.

        Both failures had the same cause: the bound was a running total that a
        contributor had to remember to update, in the right order. So the
        invariant is now structural rather than remembered — a contributor is a
        function returning `(terms, bound)`, and `_stack_levels` derives every
        scale from what it is given. Adding a term without its magnitude is not
        something you can forget to do; it is something you cannot express.
        """
        fairness_scale = max(1, int(self.weights.get('workload_fairness', 40.0)))

        # Lowest level first. Each entry is (terms, bound) for one contributor;
        # contributors within a level share it and are simply concatenated.
        soft_terms, soft_bound = [], 0
        for terms, bound in (
            self._preference_terms(),
            self._fairness_terms(fairness_scale),
            self._surplus_terms(fairness_scale),
            # Weighted like fairness: both are quality-of-life goals that must
            # never outrank coverage or a published commitment.
            self._rest_block_terms(fairness_scale),
            # Same weight as the hours fairness: both are equity goals, and
            # neither is obviously more important than the other.
            # Two instances of one mechanism: which hours someone loses, not
            # how many they work. Same weight as the hours fairness — all three
            # are equity goals and none obviously outranks the others.
            self._category_balance_terms(
                'wknd', lambda sh: self._is_weekend(sh['date']), fairness_scale, 'weekend'
            ),
            self._category_balance_terms(
                'night', self._is_night, fairness_scale, 'night'
            ),
        ):
            soft_terms.extend(terms)
            soft_bound += bound

        # DISRUPTION sits above SOFT: its unit scale must exceed everything
        # SOFT can total.
        disruption_terms, disruption_bound = self._commitment_terms(soft_bound + 1)

        # MEDIUM sits above both.
        medium_scale = soft_bound + disruption_bound + 1

        objective_terms = []
        # Minimise unstaffed seats, so negate to fit the maximisation.
        for shortfall in self.coverage_shortfall.values():
            objective_terms.append(-shortfall * medium_scale)
        # A shift can be fully staffed and still have nobody qualified: a
        # different problem with a different fix, at the same level of concern.
        for shortfall in self.qualified_shortfall.values():
            objective_terms.append(-shortfall * medium_scale)
        objective_terms.extend(disruption_terms)
        objective_terms.extend(soft_terms)

        # Note: consecutive-days is a HARD constraint
        # (_add_max_consecutive_days_constraints), so it is not expressed as a
        # soft penalty here — that would be redundant and could only ever
        # discourage solutions the hard constraint already forbids.

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

        # CP-SAT runs its parallel portfolio only when asked. Unset, the solve
        # is effectively single-threaded and leaves every other core idle for
        # up to the full time limit.
        #
        # WHY BOUNDED RATHER THAN os.cpu_count(). This runs as a child process
        # under a BullMQ worker, itself alongside the API in a container that
        # usually has a CPU quota. Grabbing every visible core would have the
        # solver compete with the request path it is supposed to stay out of,
        # and `os.cpu_count()` reports the HOST's cores inside a container, not
        # the quota — so "all cores" can be a large overcommit. Eight is enough
        # for the portfolio's diversity to pay off while leaving headroom.
        #
        # Worth stating what this costs: the portfolio is NON-DETERMINISTIC
        # across runs, so the same input can yield different equally-optimal
        # schedules. The parity suite is unaffected because it asserts the
        # VALIDITY of the output against the canonical constraints, never a
        # specific assignment set — a property that was already required for
        # the two engines to be compared at all.
        workers = int(os.environ.get('OPTIMIZATION_SEARCH_WORKERS', '0'))
        if workers <= 0:
            workers = min(8, os.cpu_count() or 1)
        solver.parameters.num_search_workers = workers
        print(f'Search workers: {workers}', file=sys.stderr)
        
        status = solver.Solve(self.model)
        
        result = {
            'status': self._status_to_string(status),
            'objective_value': solver.ObjectiveValue() if status in [cp_model.OPTIMAL, cp_model.FEASIBLE] else None,
            'solve_time_seconds': solver.WallTime(),
            'assignments': [],
            # Always reported, including on a successful run: an employee left
            # out because they are already over their limit is something the
            # planner must see, not a detail of how the solve went.
            'over_committed_employees': self.over_committed,
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
        
        # Per-shift shortfall, so a partially staffed schedule is VISIBLY
        # partial rather than looking complete. This is the reporting half of
        # making coverage a target instead of a hard constraint: the solver no
        # longer refuses to answer when the staff are insufficient, so the
        # answer has to say where it fell short and by how much. Without it a
        # caller cannot distinguish "fully staffed" from "the best we could
        # do", which is the failure mode that makes a draft get published.
        understaffed = []
        total_missing = 0
        for shift_id, shift in self.shifts.items():
            min_staff = shift.get('min_staff', 1)
            missing = min_staff - shift_counts.get(shift_id, 0)
            if missing > 0:
                total_missing += missing
                understaffed.append({
                    'shift_id': shift_id,
                    'date': shift.get('date'),
                    'required': min_staff,
                    'assigned': shift_counts.get(shift_id, 0),
                    'missing': missing,
                })

        return {
            'total_shifts': total_shifts,
            'fully_covered_shifts': fully_covered,
            'coverage_percentage': (fully_covered / total_shifts * 100) if total_shifts > 0 else 0,
            'understaffed_shifts': understaffed,
            'total_missing_staff': total_missing,
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
