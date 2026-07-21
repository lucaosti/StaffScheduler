/**
 * Golden fixtures for optimizer parity.
 *
 * WHY A SHARED FIXTURE MODULE
 * ---------------------------
 * Both the constraint-validator unit tests and the cross-engine parity suite
 * (optimizer.parity.test.ts) consume these exact problems. The greedy engine
 * reads the typed object directly; the Python CP-SAT engine reads the same
 * object serialised to JSON on stdin. Defining each fixture once, here,
 * guarantees the two engines are measured on byte-identical input — the whole
 * point of a parity test. Any divergence in behaviour is then a real
 * constraint-model difference, never a difference in how the case was set up.
 *
 * Each fixture is designed to be FEASIBLE under the full canonical hard-
 * constraint set (see constraintValidator.ts): CP-SAT treats coverage as a hard
 * constraint and would report INFEASIBLE otherwise, so every fixture provides
 * enough eligible staff to fully cover every shift while still respecting every
 * cap. Fixtures in `constrainedFixtures` deliberately sit on a constraint
 * boundary (rest, weekly hours, consecutive days, external load) so that an
 * engine which ignored that rule would emit a detectable violation.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../../optimization/ScheduleOptimizerORTools';

export interface OptimizerFixture {
  name: string;
  problem: OptimizationProblem;
  /** True when every shift can be fully staffed under all hard constraints. */
  fullyCoverable: boolean;
}

// Standard rest/weekly constraints reused across fixtures.
const CONSTRAINTS = { max_hours_per_week: 40, max_consecutive_days: 5, min_hours_between_shifts: 8 };

/**
 * Fixtures where a legal, fully-covered solution exists. Both engines must emit
 * zero constraint violations AND zero coverage shortfalls.
 */
export const feasibleFixtures: OptimizerFixture[] = [
  {
    name: 'basic coverage across two days',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 2 },
        { id: 's2', date: '2026-03-03', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 2 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
        { id: 'e2', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    name: 'skill requirement narrows eligible staff',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 1, required_skills: ['RN'] },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_consecutive_days: 5, skills: ['RN'], unavailable_dates: [] },
        { id: 'e2', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    name: 'unavailability blocks one employee',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: ['2026-03-02'] },
        { id: 'e2', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    name: 'overlapping same-day shifts need distinct staff',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '13:00', min_staff: 1, max_staff: 1 },
        { id: 's2', date: '2026-03-02', start_time: '11:00', end_time: '15:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
        { id: 'e2', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
];

/**
 * Fixtures that sit on a constraint boundary. A fully-covered solution may not
 * exist for the greedy (best-effort), so only the hard-rule check is asserted:
 * both engines must emit ZERO violations. An engine missing the rule under test
 * would produce a violating assignment and fail the suite.
 */
export const constrainedFixtures: OptimizerFixture[] = [
  {
    // Two adjacent-day shifts 7h apart (22:00→06:00 then 13:00 next day is 7h
    // rest). Only min-rest-aware engines keep a single employee off both.
    name: 'insufficient rest between adjacent-day shifts',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '22:00', end_time: '06:00', min_staff: 1, max_staff: 1 },
        { id: 's2', date: '2026-03-03', start_time: '13:00', end_time: '21:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 60, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
        { id: 'e2', max_hours_per_week: 60, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    // A six-day run of single-staff shifts with max_consecutive_days = 5 for the
    // only always-eligible employee; a second employee must absorb day 6.
    name: 'consecutive-days cap forces a hand-off',
    fullyCoverable: true,
    problem: {
      shifts: Array.from({ length: 6 }, (_, i) => ({
        id: `s${i + 1}`,
        date: `2026-03-0${i + 2}`,
        start_time: '09:00',
        end_time: '15:00',
        min_staff: 1,
        max_staff: 1,
      })),
      employees: [
        { id: 'e1', max_hours_per_week: 60, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
        { id: 'e2', max_hours_per_week: 60, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    // Employee e1 already holds a shift on an adjacent schedule that, combined
    // with a new same-day assignment, would exceed the daily budget. Only an
    // engine that accounts for existing_assignments keeps e1 off it.
    name: 'external assignment consumes the daily budget',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '13:00', end_time: '21:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        {
          id: 'e1',
          max_hours_per_week: 40,
          max_consecutive_days: 5,
          skills: [],
          unavailable_dates: [],
          existing_assignments: [{ date: '2026-03-02', start_time: '00:00', end_time: '08:00' }],
        },
        { id: 'e2', max_hours_per_week: 40, max_consecutive_days: 5, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
];

export const allFixtures: OptimizerFixture[] = [...feasibleFixtures, ...constrainedFixtures];
