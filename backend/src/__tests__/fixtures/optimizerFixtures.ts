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
  {
    // Three 2h40 shifts are exactly 8h, so they fit an 8h daily cap. Counted
    // as hours rounded to 0.1 they were 3 x 2.7 = 8.1h: the validator flagged
    // a legal schedule and the greedy left the third shift empty, while
    // CP-SAT, counting minutes, staffed it (#834, #907). One employee, and no
    // rest requirement, so the cap is the only thing deciding.
    name: 'three 2h40 shifts are exactly an 8h day (#834)',
    fullyCoverable: true,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '06:00', end_time: '08:40', min_staff: 1, max_staff: 1 },
        { id: 's2', date: '2026-03-02', start_time: '10:00', end_time: '12:40', min_staff: 1, max_staff: 1 },
        { id: 's3', date: '2026-03-02', start_time: '14:00', end_time: '16:40', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_hours_per_day: 8, skills: [], unavailable_dates: [] },
      ],
      constraints: { min_hours_between_shifts: 0 },
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

/**
 * Adversarial fixtures, one per defect the seeded property suite was written
 * to expose (#907). Each sits exactly where an engine's arithmetic and the
 * validator's part ways, and each has a SINGLE employee: with nobody else to
 * pick, an engine that misreads the rule has no way to pass by accident, since
 * coverage pushes it to take every shift its own model allows.
 *
 * The first three are half-hour cases (#834). CP-SAT counted duration as whole
 * hours and rest as `int(hours)`, so 08:00–16:30 was 8 h against an 8 h cap and
 * a 10.5 h rest requirement was 10 h; the validator and the greedy read both
 * exactly. The last two are cross-midnight overlaps (#835): the greedy compared
 * only shifts sharing a start date, so a night shift and the next morning's
 * shift both went to one person.
 */
const regressionFixtures: OptimizerFixture[] = [
  {
    name: 'an 8.5h shift under an 8h daily cap (#834)',
    fullyCoverable: false,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '08:00', end_time: '16:30', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_hours_per_day: 8, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    // 5 x 8.5h = 42.5h. Whole-hour arithmetic reads 5 x 8 = 40, exactly the cap.
    name: 'five 8.5h shifts under a 40h week (#834)',
    fullyCoverable: false,
    problem: {
      shifts: Array.from({ length: 5 }, (_, i) => ({
        id: `s${i + 1}`,
        date: `2026-03-0${i + 2}`,
        start_time: '08:00',
        end_time: '16:30',
        min_staff: 1,
        max_staff: 1,
      })),
      employees: [
        {
          id: 'e1',
          max_hours_per_week: 40,
          max_hours_per_day: 9,
          max_consecutive_days: 7,
          skills: [],
          unavailable_dates: [],
        },
      ],
      constraints: { min_hours_between_shifts: 8 },
    },
  },
  {
    // 4 x 8h fit a 37.5h week, 5 do not. Found by the property suite: a
    // fractional cap was not an integer CP-SAT could hold, so the model
    // raised while being built and the run never produced a schedule.
    name: 'a fractional 37.5h weekly cap (#834)',
    fullyCoverable: false,
    problem: {
      shifts: Array.from({ length: 5 }, (_, i) => ({
        id: `s${i + 1}`,
        date: `2026-03-0${i + 2}`,
        start_time: '08:00',
        end_time: '16:00',
        min_staff: 1,
        max_staff: 1,
      })),
      employees: [
        { id: 'e1', max_hours_per_week: 37.5, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
      ],
      constraints: { min_hours_between_shifts: 8 },
    },
  },
  {
    // 16:00 to 02:00 next day is a 10h gap against 10.5h of required rest.
    name: 'a 10h gap under 10.5h of required rest (#834)',
    fullyCoverable: false,
    problem: {
      shifts: [
        { id: 's1', date: '2026-03-02', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 1 },
        { id: 's2', date: '2026-03-03', start_time: '02:00', end_time: '10:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 60, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
      ],
      constraints: { min_hours_between_shifts: 10.5 },
    },
  },
  {
    // Day 1 22:00–06:00 runs into day 2 05:00–13:00 by one hour.
    name: 'a night shift overlapping the next morning (#835)',
    fullyCoverable: false,
    problem: {
      shifts: [
        { id: 'n', date: '2026-03-02', start_time: '22:00', end_time: '06:00', min_staff: 1, max_staff: 1 },
        { id: 'm', date: '2026-03-03', start_time: '05:00', end_time: '13:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        { id: 'e1', max_hours_per_week: 60, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
      ],
      constraints: CONSTRAINTS,
    },
  },
  {
    // The same overlap with the night shift held on another schedule.
    name: 'an external night shift overlapping the next morning (#835)',
    fullyCoverable: false,
    problem: {
      shifts: [
        { id: 'm', date: '2026-03-03', start_time: '05:00', end_time: '13:00', min_staff: 1, max_staff: 1 },
      ],
      employees: [
        {
          id: 'e1',
          max_hours_per_week: 60,
          max_consecutive_days: 7,
          skills: [],
          unavailable_dates: [],
          existing_assignments: [{ date: '2026-03-02', start_time: '22:00', end_time: '06:00' }],
        },
      ],
      constraints: CONSTRAINTS,
    },
  },
];

export const allFixtures: OptimizerFixture[] = [...feasibleFixtures, ...constrainedFixtures, ...regressionFixtures];

/**
 * Workload fairness with an ineligible bystander (#839).
 *
 * Two RNs and six RN-only single-seat shifts: the balanced answer is 3/3. The
 * third employee holds no RN skill, so is eligible for nothing. The fairness
 * builder used to `return` on the first such employee instead of skipping
 * them, which removed the fairness term for EVERYONE — so adding one person
 * who could not work changed how the people who could were treated.
 *
 * Kept apart from `allFixtures` because no hard rule is at stake: a 6/0 split
 * is legal, only unfair, so the validator cannot see this defect and the test
 * asserts the split itself.
 */
export const fairnessBystanderFixture: OptimizationProblem = {
  shifts: Array.from({ length: 6 }, (_, i) => ({
    id: `s${i + 1}`,
    date: `2026-03-0${i + 2}`,
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 1,
    max_staff: 1,
    required_skills: ['RN'],
  })),
  employees: ['RN', 'RN', null].map((skill, i) => ({
    id: `e${i + 1}`,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    skills: skill ? [skill] : [],
    unavailable_dates: [],
  })),
  constraints: { min_hours_between_shifts: 8 },
};
