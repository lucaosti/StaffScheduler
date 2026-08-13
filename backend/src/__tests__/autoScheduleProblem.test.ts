/**
 * Unit tests for the auto-schedule problem builder.
 *
 * WHY THESE ARE SEPARATE FROM `autoSchedule.service.test.ts`. Everything here
 * used to be reachable only through `AutoScheduleService.generate`, behind
 * eleven database reads: asking "does a contract limit override the preference
 * default" meant priming a fake pool with a schedule, its shifts, a department,
 * a candidate pool and an equity horizon first. The builder is now a pure
 * function over plain rows, so each question is one call — and a failure names
 * the rule that broke rather than the plumbing that carried it.
 *
 * The service suite still covers the plumbing. These cover the rules.
 *
 * @author Luca Ostinelli
 */

import {
  buildOptimizationProblem,
  carriedLoads,
  parseQualifiedStaff,
  parseSkillLevels,
  type EmployeeInputRow,
  type ScheduleInputs,
  type ShiftInputRow,
} from '../services/autoScheduleProblem';
import type { ContractLimits } from '../services/EmploymentContractService';

const SHIFT: ShiftInputRow = {
  id: 10,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 5,
};

const EMPLOYEE: EmployeeInputRow = {
  id: 1,
  max_hours_per_week: 40,
  min_hours_per_week: 0,
  max_consecutive_days: 5,
};

/** The schedule row; carried by ScheduleInputs but unused by the builder. */
const SCHEDULE = {
  id: 1,
  department_id: 3,
  start_date: '2026-05-01',
  end_date: '2026-05-31',
};

/** Inputs with nothing set but the rows a caller passes in. */
const inputs = (over: Partial<ScheduleInputs> = {}): ScheduleInputs => ({
  schedule: SCHEDULE,
  shifts: [SHIFT],
  employees: [EMPLOYEE],
  pinned: [],
  pairings: [],
  contractLimits: new Map(),
  unavailableByUser: new Map(),
  externalAssignmentsByUser: new Map(),
  carried: new Map(),
  rotationHistory: new Map(),
  ...over,
});

/** A contract stating every limit, so a test can pick the one it is about. */
const FULL_CONTRACT: ContractLimits = {
  maxHoursPerWeek: 20,
  minHoursPerWeek: 8,
  maxHoursPerDay: 6,
  maxConsecutiveDays: 3,
  minHoursBetweenShifts: 11,
  minConsecutiveDaysOff: 2,
  minDaysOffPerPeriod: 8,
};

describe('parseSkillLevels', () => {
  it('reads well-formed name:level pairs', () => {
    expect(parseSkillLevels('Triage:3,Surgery:5')).toEqual({ Triage: 3, Surgery: 5 });
  });

  it('skips a pair whose level is absent rather than reading it as level 0', () => {
    // GROUP_CONCAT emits "name:" when the column is NULL and `Number('')` is 0
    // — a finite number. Reading that as level 0 puts the employee below every
    // requirement, silently disqualifying everyone whose proficiency was never
    // recorded: the precise failure "absent means unknown" exists to prevent.
    expect(parseSkillLevels('Triage:')).toEqual({});
  });

  it('keeps the well-formed entries when only some are malformed', () => {
    // The dangerous shape: a partial parse that looks like it worked.
    expect(parseSkillLevels('Triage:,Surgery:4')).toEqual({ Surgery: 4 });
  });

  it('skips a level that is not a number', () => {
    expect(parseSkillLevels('Triage:senior')).toEqual({});
  });

  it('treats null, undefined and empty as no constraint at all', () => {
    for (const raw of [null, undefined, '']) {
      expect(parseSkillLevels(raw)).toEqual({});
    }
  });
});

describe('parseQualifiedStaff', () => {
  it('reads well-formed name:level:count triples', () => {
    expect(parseQualifiedStaff('Triage:5:1,Surgery:3:2')).toEqual({
      Triage: { level: 5, count: 1 },
      Surgery: { level: 3, count: 2 },
    });
  });

  it('skips a triple with either column absent', () => {
    // "name::" would otherwise parse as level 0 count 0 — a requirement no one
    // stated, applied as though they had.
    for (const raw of ['Triage::', 'Triage:5:', 'Triage::1']) {
      expect(parseQualifiedStaff(raw)).toEqual({});
    }
  });

  it('treats null and empty as no requirement', () => {
    expect(parseQualifiedStaff(null)).toEqual({});
    expect(parseQualifiedStaff('')).toEqual({});
  });
});

describe('carriedLoads', () => {
  const shift = (userId: number, date: string, startTime = '08:00', endTime = '16:00') => ({
    userId,
    date,
    startTime,
    endTime,
  });

  it('measures a deviation from the candidates average, not a raw count', () => {
    // 2026-04-04 and 2026-04-05 are a Saturday and a Sunday.
    const loads = carriedLoads(
      [shift(1, '2026-04-04'), shift(1, '2026-04-05')],
      [1, 2]
    );
    // Average one weekend day each: deviations +1 and −1, shifted so the least
    // loaded sits at zero.
    expect(loads.get(1)!.weekend).toBe(2);
    expect(loads.get(2)!.weekend).toBe(0);
  });

  it('anchors the least-loaded candidate at exactly zero', () => {
    // The normalisation's defining property, and what makes the values safe as
    // CP-SAT load variables: the set is shifted up until the floor is zero,
    // never further. Someone who joined mid-period lands ON that floor —
    // neither owed nor owing — rather than at a negative offset.
    const loads = carriedLoads([shift(1, '2026-04-04'), shift(2, '2026-04-05')], [1, 2, 3]);
    expect(loads.get(3)!.weekend).toBe(0);
    expect(Math.min(...[...loads.values()].map((l) => l.weekend))).toBe(0);
  });

  it('gives two candidates with identical history identical loads', () => {
    // Nothing outside the history may separate two otherwise-equal people —
    // not their id, not their position in the candidate list.
    const loads = carriedLoads([shift(1, '2026-04-04'), shift(2, '2026-04-04')], [1, 2]);
    expect(loads.get(1)).toEqual(loads.get(2));
  });

  it('counts a date once however many shifts it held', () => {
    const loads = carriedLoads(
      [shift(1, '2026-04-04', '08:00', '12:00'), shift(1, '2026-04-04', '13:00', '17:00')],
      [1, 2]
    );
    // The unit is what the person loses: two shifts on one Saturday cost one
    // Saturday.
    expect(loads.get(1)!.weekend).toBe(1);
  });

  it('classifies a midweek night as night and not as weekend', () => {
    // Wednesday 22:00–06:00.
    const loads = carriedLoads([shift(1, '2026-04-08', '22:00', '06:00')], [1, 2]);
    expect(loads.get(1)!.night).toBe(1);
    expect(loads.get(1)!.weekend).toBe(0);
  });

  it('gives every candidate an entry even with no history at all', () => {
    const loads = carriedLoads([], [1, 2, 3]);
    expect([...loads.keys()]).toEqual([1, 2, 3]);
    expect(loads.get(2)).toEqual({ weekend: 0, night: 0 });
  });

  it('ignores rows for someone outside the candidate set', () => {
    // The deviation is measured against the people the solver is choosing
    // between; a stray row must not shift their average.
    const withStray = carriedLoads([shift(99, '2026-04-04')], [1, 2]);
    expect(withStray.get(1)).toEqual({ weekend: 0, night: 0 });
    expect(withStray.get(2)).toEqual({ weekend: 0, night: 0 });
  });

  it('never emits a negative load, whatever the history', () => {
    // The invariant both engines rely on: loads are shifted up until the least
    // loaded candidate sits at zero, so no CP-SAT load variable needs a
    // negative lower bound. The objective minimises max − min, which that
    // shift leaves unchanged.
    const histories = [
      [shift(1, '2026-04-04')],
      [shift(1, '2026-04-04'), shift(1, '2026-04-05'), shift(2, '2026-04-11')],
      [shift(3, '2026-04-08', '22:00', '06:00')],
      [],
    ];
    for (const history of histories) {
      for (const load of carriedLoads(history, [1, 2, 3]).values()) {
        expect(load.weekend).toBeGreaterThanOrEqual(0);
        expect(load.night).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('buildOptimizationProblem', () => {
  describe('working-time limits', () => {
    it('lets the contract override the preference-derived row values', () => {
      // The whole reason contracts exist: the row values come from
      // `user_preferences`, which carries no validity period, so a person
      // moving to part-time overwrote the old value and a schedule generated
      // before the change appeared to violate a limit that did not apply.
      const problem = buildOptimizationProblem(
        inputs({ contractLimits: new Map([[1, FULL_CONTRACT]]) })
      );
      expect(problem.employees[0]).toMatchObject({
        max_hours_per_week: 20,
        min_hours_per_week: 8,
        max_consecutive_days: 3,
        max_hours_per_day: 6,
        min_consecutive_days_off: 2,
        min_days_off_per_period: 8,
      });
    });

    it('keeps the row defaults for an employee with no contract', () => {
      // An installation that has not set contracts up must behave exactly as
      // it did before contracts existed.
      const problem = buildOptimizationProblem(inputs());
      expect(problem.employees[0]).toMatchObject({
        max_hours_per_week: 40,
        min_hours_per_week: 0,
        max_consecutive_days: 5,
      });
    });

    it('applies a contract only to the employee it belongs to', () => {
      const problem = buildOptimizationProblem(
        inputs({
          employees: [EMPLOYEE, { ...EMPLOYEE, id: 2 }],
          contractLimits: new Map([[2, FULL_CONTRACT]]),
        })
      );
      expect(problem.employees[0].max_hours_per_week).toBe(40);
      expect(problem.employees[1].max_hours_per_week).toBe(20);
    });

    it('omits the contract-only limits rather than sending zero when unset', () => {
      // The engines fall back to their historical derived formula on absence.
      // A zero would be read as a real cap and make every day unworkable.
      const problem = buildOptimizationProblem(inputs());
      expect(problem.employees[0].max_hours_per_day).toBeUndefined();
      expect(problem.employees[0].min_consecutive_days_off).toBeUndefined();
      expect(problem.employees[0].min_days_off_per_period).toBeUndefined();
    });
  });

  describe('hourly rate', () => {
    it('converts the DECIMAL string mysql2 returns into a number', () => {
      const problem = buildOptimizationProblem(
        inputs({ employees: [{ ...EMPLOYEE, hourly_rate: '15.50' }] })
      );
      // Forwarding the raw string would make the solver's cost terms compare
      // text rather than money.
      expect(problem.employees[0].hourly_rate).toBe(15.5);
    });

    it('omits the field rather than inventing zero when the column is null', () => {
      // Zero would say this person is free, which is a different claim from
      // "no cost signal recorded".
      for (const rate of [null, undefined]) {
        const problem = buildOptimizationProblem(
          inputs({ employees: [{ ...EMPLOYEE, hourly_rate: rate }] })
        );
        expect(problem.employees[0].hourly_rate).toBeUndefined();
      }
    });
  });

  describe('skills', () => {
    it('reads a shift requirement and an employee proficiency independently', () => {
      const problem = buildOptimizationProblem(
        inputs({
          shifts: [
            {
              ...SHIFT,
              skill_names: 'Triage',
              skill_levels: 'Triage:3',
              qualified_staff: 'Triage:5:1',
            },
          ],
          employees: [{ ...EMPLOYEE, skill_names: 'Triage', skill_levels: 'Triage:4' }],
        })
      );
      expect(problem.shifts[0].required_skills).toEqual(['Triage']);
      expect(problem.shifts[0].required_skill_levels).toEqual({ Triage: 3 });
      expect(problem.shifts[0].qualified_staff).toEqual({ Triage: { level: 5, count: 1 } });
      expect(problem.employees[0].skill_levels).toEqual({ Triage: 4 });
    });

    it('yields an empty list, never [""], for an absent concat column', () => {
      // `''.split(',')` is `['']`, and a phantom skill named "" would make
      // every shift requiring it unstaffable.
      for (const raw of [null, undefined, '']) {
        const problem = buildOptimizationProblem(
          inputs({
            shifts: [{ ...SHIFT, skill_names: raw }],
            employees: [{ ...EMPLOYEE, skill_names: raw }],
          })
        );
        expect(problem.shifts[0].required_skills).toEqual([]);
        expect(problem.employees[0].skills).toEqual([]);
      }
    });
  });

  describe('identity and dates', () => {
    it('stringifies ids, which the engines key their variables by', () => {
      const problem = buildOptimizationProblem(
        inputs({ shifts: [{ ...SHIFT, id: 10 }], employees: [{ ...EMPLOYEE, id: 7 }] })
      );
      expect(problem.shifts[0].id).toBe('10');
      expect(problem.employees[0].id).toBe('7');
    });

    it('normalises a shift date arriving as a Date, the way mysql2 sends it', () => {
      // Same failure mode as #716: `shifts.date` is a DATE column, so the
      // driver materialises it as a Date and a naive stringify would put
      // "Fri May 01" on the wire to the solver.
      const problem = buildOptimizationProblem(
        inputs({ shifts: [{ ...SHIFT, date: new Date(2026, 4, 1) }] })
      );
      expect(problem.shifts[0].date).toBe('2026-05-01');
    });

    it('passes a date already in YYYY-MM-DD through unchanged', () => {
      expect(buildOptimizationProblem(inputs()).shifts[0].date).toBe('2026-05-01');
    });
  });

  describe('per-employee history', () => {
    it('attaches each employee their own unavailability and busy time', () => {
      const problem = buildOptimizationProblem(
        inputs({
          employees: [EMPLOYEE, { ...EMPLOYEE, id: 2 }],
          unavailableByUser: new Map([[1, ['2026-05-02']]]),
          externalAssignmentsByUser: new Map([
            [2, [{ date: '2026-05-03', start_time: '08:00', end_time: '16:00' }]],
          ]),
        })
      );
      expect(problem.employees[0].unavailable_dates).toEqual(['2026-05-02']);
      expect(problem.employees[0].existing_assignments).toEqual([]);
      expect(problem.employees[1].unavailable_dates).toEqual([]);
      expect(problem.employees[1].existing_assignments).toHaveLength(1);
    });

    it('carries equity load and rotation streak through as distinct fields', () => {
      // Two different questions: a cumulative deviation over a date window,
      // and how many consecutive periods the same person held the category.
      const problem = buildOptimizationProblem(
        inputs({
          carried: new Map([[1, { weekend: 3, night: 0 }]]),
          rotationHistory: new Map([[1, { weekend: 2, night: 1 }]]),
        })
      );
      expect(problem.employees[0].carried_load).toEqual({ weekend: 3, night: 0 });
      expect(problem.employees[0].consecutive_category_periods).toEqual({ weekend: 2, night: 1 });
    });

    it('leaves both absent for an employee with no history, rather than zeroing them', () => {
      const problem = buildOptimizationProblem(inputs());
      expect(problem.employees[0].carried_load).toBeUndefined();
      expect(problem.employees[0].consecutive_category_periods).toBeUndefined();
    });
  });

  describe('problem-level fields', () => {
    it('forwards pinned commitments and pairings verbatim', () => {
      const pinned = [{ employee_id: '1', shift_id: '10' }];
      const pairings = [{ employee_id: '1', other_id: '2', kind: 'requires' as const }];
      const problem = buildOptimizationProblem(inputs({ pinned, pairings }));
      expect(problem.pinned_assignments).toEqual(pinned);
      expect(problem.pairings).toEqual(pairings);
    });

    it('sends preferences as a map keyed by employee id, not an array', () => {
      // Both engines index it by id — the Python solver with `id not in
      // self.preferences`. The array literal that used to sit here was the
      // reason the whole problem had to be cast through `as never`.
      const preferences = buildOptimizationProblem(inputs()).preferences;
      expect(Array.isArray(preferences)).toBe(false);
      expect(preferences).toEqual({});
    });

    it('states the baseline constraints the per-employee limits refine', () => {
      expect(buildOptimizationProblem(inputs()).constraints).toEqual({
        max_hours_per_week: 40,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
      });
    });

    it('does not share one constraints object between two problems', () => {
      // A shared literal would let an engine that annotates the problem in
      // place leak that annotation into the next run.
      const first = buildOptimizationProblem(inputs());
      const second = buildOptimizationProblem(inputs());
      expect(first.constraints).not.toBe(second.constraints);
    });

    it('builds an empty problem without throwing when nothing is schedulable', () => {
      const problem = buildOptimizationProblem(inputs({ shifts: [], employees: [] }));
      expect(problem.shifts).toEqual([]);
      expect(problem.employees).toEqual([]);
    });
  });
});
