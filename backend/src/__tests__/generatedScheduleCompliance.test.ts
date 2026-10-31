/**
 * Unit tests for the post-solve compliance check (#963).
 *
 * The check is the last line between an engine's output and the database:
 * whatever ComplianceEngine would refuse for a manual assignment is withheld
 * from a generated one. These cover which work it counts — other schedules,
 * and a draft's own held rows but not a published schedule's — and that the
 * one-pass order leaves a set that is compliant as a whole.
 *
 * @author Luca Ostinelli
 */

import { describeWithheld, withholdNonCompliant } from '../services/generatedScheduleCompliance';
import type { ScheduleInputs, ShiftInputRow } from '../services/autoScheduleProblem';
import type { WorkingTimeLimits } from '../services/WorkingTimeLimitsService';
import type { ScheduleAssignment } from '../optimization/types';

const LIMITS: WorkingTimeLimits = { maxHoursPerWeek: 40, maxConsecutiveDays: 5, minRestHoursBetweenShifts: 8 };

const shift = (id: number, date: string, start_time: string, end_time: string): ShiftInputRow => ({
  id,
  date,
  start_time,
  end_time,
  min_staff: 1,
  max_staff: 1,
});

const inputs = (over: Partial<ScheduleInputs> = {}): ScheduleInputs => ({
  schedule: { id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31', status: 'draft' },
  shifts: [],
  employees: [{ id: 1, min_hours_per_week: 0 }],
  pinned: [],
  held: [],
  pairings: [],
  contractLimits: new Map(),
  workingTimeLimits: new Map([[1, LIMITS]]),
  unavailableByUser: new Map(),
  externalAssignmentsByUser: new Map(),
  carried: new Map(),
  rotationHistory: new Map(),
  ...over,
});

/** The engines' output shape; only the two ids matter to the check. */
const a = (shiftId: number, employeeId = 1): ScheduleAssignment => ({
  employeeId: String(employeeId),
  shiftId: String(shiftId),
  date: '',
  startTime: '',
  endTime: '',
  hours: 0,
});

const ids = (list: ScheduleAssignment[]): string[] => list.map((x) => x.shiftId);

describe('withholdNonCompliant', () => {
  it('keeps a compliant run whole', () => {
    const run = [a(1), a(2)];
    const out = withholdNonCompliant(
      inputs({ shifts: [shift(1, '2026-05-01', '08:00', '16:00'), shift(2, '2026-05-02', '08:00', '16:00')] }),
      run
    );
    expect(ids(out.kept)).toEqual(['1', '2']);
    expect(out.withheld).toEqual([]);
  });

  it('withholds the later of two shifts too close together, whatever order the engine listed them', () => {
    // A night into the next morning: 0 h of rest.
    const out = withholdNonCompliant(
      inputs({ shifts: [shift(1, '2026-05-01', '23:00', '07:00'), shift(2, '2026-05-02', '07:00', '15:00')] }),
      [a(2), a(1)]
    );
    expect(ids(out.kept)).toEqual(['1']);
    expect(out.withheld).toEqual([
      { userId: 1, shiftId: 2, violations: [expect.stringMatching(/^MIN_REST_HOURS: Only 0\.0h of rest/)] },
    ]);
  });

  it('counts work held on other schedules', () => {
    const out = withholdNonCompliant(
      inputs({
        shifts: [shift(1, '2026-05-02', '07:00', '15:00')],
        externalAssignmentsByUser: new Map([[1, [{ date: '2026-05-01', start_time: '15:00', end_time: '23:00' }]]]),
        workingTimeLimits: new Map([[1, { ...LIMITS, minRestHoursBetweenShifts: 11 }]]),
      }),
      [a(1)]
    );
    expect(out.kept).toEqual([]);
    expect(out.withheld[0].violations).toEqual([expect.stringMatching(/^MIN_REST_HOURS/)]);
  });

  it("counts a draft's held rows, and the run's own accepted assignments, toward the week", () => {
    // 16 h a week: the held day plus one more fill it.
    const shifts = [1, 3, 5].map((d) => shift(d, `2026-05-0${d}`, '09:00', '17:00'));
    const out = withholdNonCompliant(
      inputs({
        shifts,
        held: [{ employee_id: '1', shift_id: '1' }],
        workingTimeLimits: new Map([[1, { ...LIMITS, maxHoursPerWeek: 16 }]]),
      }),
      [a(5), a(3)]
    );
    expect(ids(out.kept)).toEqual(['3']);
    expect(out.withheld.map((w) => [w.shiftId, w.violations[0].split(':')[0]])).toEqual([[5, 'MAX_WEEKLY_HOURS']]);
  });

  it("does not count a published schedule's rows, which its proposal replaces", () => {
    const out = withholdNonCompliant(
      inputs({
        schedule: { id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31', status: 'published' },
        shifts: [shift(1, '2026-05-01', '23:00', '07:00'), shift(2, '2026-05-02', '07:00', '15:00')],
        held: [{ employee_id: '1', shift_id: '2' }],
      }),
      [a(1)]
    );
    expect(ids(out.kept)).toEqual(['1']);
  });

  it('withholds the consecutive day that breaks the cap', () => {
    const shifts = [1, 2, 3].map((d) => shift(d, `2026-05-0${d}`, '09:00', '17:00'));
    const out = withholdNonCompliant(
      inputs({ shifts, workingTimeLimits: new Map([[1, { ...LIMITS, maxConsecutiveDays: 2 }]]) }),
      [a(3), a(1), a(2)]
    );
    expect(ids(out.kept)).toEqual(['1', '2']);
    expect(out.withheld[0].violations).toEqual([expect.stringMatching(/^MAX_CONSECUTIVE_DAYS/)]);
  });

  it('withholds an assignment to a shift or person the schedule does not have', () => {
    const out = withholdNonCompliant(
      inputs({ shifts: [shift(1, '2026-05-01', '08:00', '16:00')], held: [{ employee_id: '1', shift_id: '99' }] }),
      [a(99), a(1, 2), a(1)]
    );
    expect(ids(out.kept)).toEqual(['1']);
    expect(out.withheld.map((w) => [w.userId, w.shiftId, w.violations[0].split(':')[0]])).toEqual([
      [1, 99, 'UNKNOWN'],
      [2, 1, 'UNKNOWN'],
    ]);
  });
});

describe('describeWithheld', () => {
  const withheld = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ userId: 1, shiftId: i + 1, violations: ['MIN_REST_HOURS: short'] }));

  it('names every withheld assignment up to five', () => {
    expect(describeWithheld(withheld(1))).toBe(
      'Withheld 1 generated assignment(s) that would break the working-time limits ComplianceEngine ' +
        'enforces: user 1 on shift 1 (MIN_REST_HOURS: short)'
    );
  });

  it('summarises the rest beyond five', () => {
    const reason = describeWithheld(withheld(7));
    expect(reason).toContain('user 1 on shift 5 (MIN_REST_HOURS: short); and 2 more');
    expect(reason).not.toContain('shift 6');
  });
});
