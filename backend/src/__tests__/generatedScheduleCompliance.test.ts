/**
 * Unit tests for the post-solve compliance check (#963).
 *
 * The check is the last line between an engine's output and the database:
 * whatever ComplianceEngine would refuse for a manual assignment is withheld
 * from a generated one. The property that matters most is INDEPENDENCE: the
 * work it judges against is read by its own query, so a row the problem
 * builder missed is still counted — a check over the builder's rows would
 * agree with the builder by construction. These cover that, which rows that
 * query excludes, the per-date limits, the one-pass order, and that an
 * engine inventing a shift or person fails the run.
 *
 * @author Luca Ostinelli
 */

import { describeWithheld, listWithheld, withholdNonCompliant } from '../services/generatedScheduleCompliance';
import { WorkingTimeLimitsService, type WorkingTimeLimits } from '../services/WorkingTimeLimitsService';
import type { ScheduleInputs, ShiftInputRow } from '../services/autoScheduleProblem';
import type { ScheduleAssignment } from '../optimization/types';
import { OptimizationFailedError } from '../errors';
import { logger } from '../config/logger';
import { driverDate } from './helpers/driverDate';

jest.mock('../services/WorkingTimeLimitsService', () => ({
  ...jest.requireActual('../services/WorkingTimeLimitsService'),
  WorkingTimeLimitsService: jest.fn(),
}));

const LIMITS: WorkingTimeLimits = { maxHoursPerWeek: 40, maxConsecutiveDays: 5, minRestHoursBetweenShifts: 8 };

/** Limits by user for the mocked resolver; every requested user gets one. */
const resolve = jest.fn();
const limitsFor = (byUser: Record<number, Partial<WorkingTimeLimits>> = {}) => {
  resolve.mockImplementation(async (ids: number[]) => ({
    limits: new Map(ids.map((id) => [id, { ...LIMITS, ...byUser[id] }])),
    contracts: new Map(),
  }));
};

beforeEach(() => {
  resolve.mockReset();
  limitsFor();
  (WorkingTimeLimitsService as unknown as jest.Mock).mockImplementation(() => ({ resolve }));
});

/** A pool whose only read is the check's own work query, answering `rows`. */
const poolWith = (rows: Array<Record<string, unknown>> = []) => {
  const execute = jest.fn().mockResolvedValue([rows, null]);
  return { pool: { execute } as never, execute };
};

const shift = (id: number, date: string, start_time: string, end_time: string): ShiftInputRow => ({
  id,
  date,
  start_time,
  end_time,
  min_staff: 1,
  max_staff: 1,
});

const SCHEDULE = { id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31', status: 'draft' };

const inputs = (over: Partial<ScheduleInputs> = {}): ScheduleInputs => ({
  schedule: SCHEDULE,
  shifts: [],
  employees: [
    { id: 1, min_hours_per_week: 0 },
    { id: 2, min_hours_per_week: 0 },
  ],
  pinned: [],
  held: [],
  pairings: [],
  contractLimits: new Map(),
  workingTimeLimits: new Map(),
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
  it('reads nothing for a run that assigned nothing', async () => {
    const { pool, execute } = poolWith();
    await expect(withholdNonCompliant(pool, inputs(), [])).resolves.toEqual({ kept: [], withheld: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps a compliant run whole, ignoring work beyond 14 days of the candidate', async () => {
    // A night shift 20 days earlier is outside ComplianceEngine's window.
    const { pool } = poolWith([{ user_id: 1, date: '2026-04-11', start_time: '23:00', end_time: '07:00' }]);
    const out = await withholdNonCompliant(
      pool,
      inputs({ shifts: [shift(1, '2026-05-01', '08:00', '16:00'), shift(2, '2026-05-02', '08:00', '16:00')] }),
      [a(1), a(2)]
    );
    expect(ids(out.kept)).toEqual(['1', '2']);
    expect(out.withheld).toEqual([]);
  });

  it('withholds the later of two shifts too close together, whatever order the engine listed them', async () => {
    const { pool } = poolWith();
    const out = await withholdNonCompliant(
      pool,
      inputs({ shifts: [shift(1, '2026-05-01', '23:00', '07:00'), shift(2, '2026-05-02', '07:00', '15:00')] }),
      [a(2), a(1)]
    );
    expect(ids(out.kept)).toEqual(['1']);
    expect(out.withheld).toEqual([
      {
        userId: 1,
        shiftId: 2,
        rules: ['MIN_REST_HOURS'],
        violations: [expect.stringMatching(/^MIN_REST_HOURS: Only 0\.0h of rest/)],
      },
    ]);
  });

  it('counts work the problem builder missed, because it reads the work itself', async () => {
    // The loader's rows (externalAssignmentsByUser) say nothing; the check's
    // own query finds the evening before. This is #963's failure, caught.
    const { pool } = poolWith([{ user_id: 1, date: driverDate('2026-05-01'), start_time: '15:00', end_time: '23:00' }]);
    limitsFor({ 1: { minRestHoursBetweenShifts: 11 } });
    const out = await withholdNonCompliant(
      pool,
      inputs({ shifts: [shift(1, '2026-05-02', '07:00', '15:00')], externalAssignmentsByUser: new Map() }),
      [a(1)]
    );
    expect(out.kept).toEqual([]);
    expect(out.withheld[0].rules).toEqual(['MIN_REST_HOURS']);
  });

  it("counts the run's own accepted assignments toward the week", async () => {
    // 16 h a week: the read day plus one more fill it.
    const { pool } = poolWith([{ user_id: 1, date: '2026-05-01', start_time: '09:00', end_time: '17:00' }]);
    limitsFor({ 1: { maxHoursPerWeek: 16 } });
    const out = await withholdNonCompliant(
      pool,
      inputs({ shifts: [3, 5].map((d) => shift(d, `2026-05-0${d}`, '09:00', '17:00')) }),
      [a(5), a(3)]
    );
    expect(ids(out.kept)).toEqual(['3']);
    expect(out.withheld.map((w) => [w.shiftId, w.rules])).toEqual([[5, ['MAX_WEEKLY_HOURS']]]);
  });

  it('withholds the consecutive day that breaks the cap', async () => {
    const { pool } = poolWith();
    limitsFor({ 1: { maxConsecutiveDays: 2 } });
    const out = await withholdNonCompliant(
      pool,
      inputs({ shifts: [1, 2, 3].map((d) => shift(d, `2026-05-0${d}`, '09:00', '17:00')) }),
      [a(3), a(1), a(2)]
    );
    expect(ids(out.kept)).toEqual(['1', '2']);
    expect(out.withheld[0].rules).toEqual(['MAX_CONSECUTIVE_DAYS']);
  });

  it("resolves each person's limits on the candidate's own date, as ComplianceEngine does", async () => {
    const { pool } = poolWith();
    await withholdNonCompliant(
      pool,
      inputs({ shifts: [shift(1, '2026-05-01', '08:00', '16:00'), shift(2, '2026-05-03', '08:00', '16:00')] }),
      [a(1), a(2), a(2, 2)]
    );
    expect(resolve.mock.calls).toEqual([
      [[1], '2026-05-01', '2026-05-01'],
      [[1, 2], '2026-05-03', '2026-05-03'],
    ]);
  });

  describe('which work the query excludes', () => {
    it("excludes only the department's schedules that never happened, keeping a draft's own rows", async () => {
      const { pool, execute } = poolWith();
      await withholdNonCompliant(
        pool,
        inputs({ schedule: { ...SCHEDULE, previous_schedule_id: 9 }, shifts: [shift(1, '2026-05-01', '08:00', '16:00')] }),
        [a(1)]
      );
      const [sql, params] = execute.mock.calls[0];
      expect(sql).toContain('-- post-solve compliance check');
      expect(sql).toContain(
        "AND NOT (sc.department_id = ? AND sc.id NOT IN (?, ?)\n                 AND (sc.status = 'draft' OR (sc.status = 'archived' AND sc.published_at IS NULL)))"
      );
      // Window, then "this schedule's rows are excluded" — 0, none, on a
      // draft — then the department, this schedule and its predecessor.
      expect(params).toEqual(['2026-05-01', '2026-05-31', 0, 3, 1, 9]);
    });

    it("excludes a published schedule's own rows, which its proposal replaces", async () => {
      const { pool, execute } = poolWith();
      await withholdNonCompliant(
        pool,
        inputs({ schedule: { ...SCHEDULE, status: 'published' }, shifts: [shift(1, '2026-05-01', '08:00', '16:00')] }),
        [a(1)]
      );
      expect(execute.mock.calls[0][1]).toEqual(['2026-05-01', '2026-05-31', 1, 3, 1, 0]);
    });
  });

  it('fails the run when the engine assigned a shift or person it was never given', async () => {
    const { pool, execute } = poolWith();
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    await expect(
      withholdNonCompliant(pool, inputs({ shifts: [shift(1, '2026-05-01', '08:00', '16:00')] }), [
        a(1),
        a(99),
        a(1, 7),
      ])
    ).rejects.toThrow(OptimizationFailedError);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('2 assignment(s) to shifts or people it was never given'));
    expect(execute).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('describeWithheld / listWithheld', () => {
  const withheld = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      userId: 1,
      shiftId: i + 1,
      rules: ['MIN_REST_HOURS'],
      violations: ['MIN_REST_HOURS: short'],
    }));

  it('names every withheld assignment up to five', () => {
    expect(describeWithheld(withheld(1))).toBe(
      'Withheld 1 generated assignment(s) that would break the working-time limits ComplianceEngine ' +
        'enforces: user 1 on shift 1 (MIN_REST_HOURS: short)'
    );
  });

  it('summarises the rest beyond the limit', () => {
    const reason = describeWithheld(withheld(7));
    expect(reason).toContain('user 1 on shift 5 (MIN_REST_HOURS: short); and 2 more');
    expect(reason).not.toContain('shift 6');
    expect(listWithheld(withheld(3), 1)).toBe('user 1 on shift 1 (MIN_REST_HOURS: short); and 2 more');
  });
});
