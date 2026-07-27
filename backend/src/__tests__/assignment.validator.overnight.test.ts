/**
 * Conflict detection must work in absolute time, not wall-clock time.
 *
 * WHY THIS SUITE EXISTS: `checkConflicts` used to filter on `s.date = ?` and
 * compare `start_time`/`end_time` directly, which is wrong for any shift
 * crossing midnight — and wrong in both directions. Both misses are silent
 * DOUBLE BOOKINGS: the system would accept an assignment putting one person on
 * two overlapping shifts, defeating the first hard constraint the optimizer
 * enforces.
 *
 * The defect was latent only because the request schemas rejected overnight
 * shifts outright, so none could be created through the API. Accepting them
 * (see #465) makes the SQL reachable, which is why it had to be fixed in the
 * same change rather than after.
 *
 * These assertions are on the SQL the validator composes and the bounds it
 * computes. Whether MySQL agrees is proven separately, by the real-database
 * integration sweep — a mocked pool can only show that a string was built.
 *
 * @author Luca Ostinelli
 */

import { AssignmentValidator } from '../services/AssignmentValidator';
import { DateUtils } from '../utils';

export {};

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], []]);
  return { pool: { execute } as never, execute };
};

describe('DateUtils.shiftBounds', () => {
  it('keeps a same-day shift on its own date', () => {
    expect(DateUtils.shiftBounds('2026-03-01', '09:00', '17:00')).toEqual([
      '2026-03-01 09:00:00',
      '2026-03-01 17:00:00',
    ]);
  });

  it('rolls an overnight end into the following day', () => {
    expect(DateUtils.shiftBounds('2026-03-01', '22:00', '06:00')).toEqual([
      '2026-03-01 22:00:00',
      '2026-03-02 06:00:00',
    ]);
  });

  it('accepts times already carrying seconds, as MySQL returns them', () => {
    expect(DateUtils.shiftBounds('2026-03-01', '22:00:00', '06:00:00')).toEqual([
      '2026-03-01 22:00:00',
      '2026-03-02 06:00:00',
    ]);
  });

  it('treats equal times as a full day rather than zero length', () => {
    // The schemas reject startTime === endTime, so this shape cannot be stored;
    // rolling forward is the safe reading if one ever appears, since treating a
    // shift as instantaneous would make it conflict with nothing.
    expect(DateUtils.shiftBounds('2026-03-01', '08:00', '08:00')).toEqual([
      '2026-03-01 08:00:00',
      '2026-03-02 08:00:00',
    ]);
  });

  /**
   * REGRESSION, caught by the real-MySQL integration job and not by any mocked
   * test: mysql2 materializes a DATE column as a `Date`, and `AssignmentService`
   * passed `shift.date` straight through. Interpolating a `Date` into
   * `${day}T${time}Z` yields a string `new Date()` cannot parse, so every
   * assignment creation failed with `INTERNAL_ERROR: Invalid time value`.
   *
   * The audit path two lines away in the same method already converted with
   * `fromMySQLDate`, which is what makes this the right fix: normalising inside
   * the helper removes the obligation from every call site rather than fixing
   * the one that forgot.
   */
  it('accepts the Date that mysql2 returns for a DATE column', () => {
    // Local midnight, which is how mysql2 materializes `2026-03-01`.
    const fromDb = new Date(2026, 2, 1);
    expect(DateUtils.shiftBounds(fromDb, '22:00:00', '06:00:00')).toEqual([
      '2026-03-01 22:00:00',
      '2026-03-02 06:00:00',
    ]);
  });

  it('does not shift the date across a UTC offset', () => {
    // Regression guard for the class of bug DateUtils.fromMySQLDate documents:
    // a local-vs-UTC mix-up silently moves a date by one day in any positive
    // offset timezone, which on a night shift is the difference between two
    // calendar days of attribution.
    const [start] = DateUtils.shiftBounds('2026-03-01', '00:30', '08:30');
    expect(start).toBe('2026-03-01 00:30:00');
  });
});

describe('AssignmentValidator.checkConflicts', () => {
  it('compares absolute timestamps rather than wall-clock times', async () => {
    const { pool, execute } = makePool();
    await new AssignmentValidator(pool).checkConflicts(7, '2026-03-01', '22:00', '06:00');

    const [sql, params] = execute.mock.calls[0];
    // The half-open overlap test, on both sides reconstructed to absolute time.
    expect(sql).toContain('TIMESTAMP(s.date, s.start_time) <');
    expect(sql).toContain('IF(s.end_time <= s.start_time, 86400, 0)');
    // The candidate's own bounds are computed here and bound as parameters.
    expect(params).toEqual([7, '2026-03-01', '2026-03-01', '2026-03-02 06:00:00', '2026-03-01 22:00:00']);
  });

  it('widens the date filter to the adjacent days', async () => {
    const { pool, execute } = makePool();
    await new AssignmentValidator(pool).checkConflicts(7, '2026-03-02', '02:00', '08:00');

    const [sql] = execute.mock.calls[0];
    // Without this, a 22:00-06:00 shift dated the 1st is never even considered
    // as a conflict for a 02:00-08:00 shift dated the 2nd.
    expect(sql).toContain('BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)');
    // Still filtered by date, so idx_date stays usable: correctness must not
    // cost a full scan of every assignment the user has ever held.
    expect(sql).not.toContain('AND s.date =');
  });

  it('no longer emits the wall-clock comparison that missed overnight overlaps', async () => {
    const { pool, execute } = makePool();
    await new AssignmentValidator(pool).checkConflicts(7, '2026-03-01', '09:00', '17:00');

    const [sql] = execute.mock.calls[0];
    // `'22:00' < '07:00'` is false as a string comparison on a wrapped clock,
    // which is exactly how the old query missed a same-date overnight overlap.
    expect(sql).not.toContain('s.start_time < ? AND s.end_time > ?');
  });

  it('runs on the supplied executor so it serializes with the caller transaction', async () => {
    const { pool } = makePool();
    const txExecute = jest.fn().mockResolvedValue([[], []]);
    await new AssignmentValidator(pool).checkConflicts(7, '2026-03-01', '22:00', '06:00', {
      execute: txExecute,
    } as never);

    // Two concurrent assignments each find no conflict unless the check reads
    // the surrounding transaction's uncommitted rows.
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect((pool as unknown as { execute: jest.Mock }).execute).not.toHaveBeenCalled();
  });

  it('maps rows to the caller-facing conflict shape', async () => {
    const execute = jest.fn().mockResolvedValue([
      [
        {
          id: 42,
          shift_date: '2026-03-01',
          start_time: '22:00:00',
          end_time: '06:00:00',
          department_name: 'Night Ward',
        },
      ],
      [],
    ]);
    const conflicts = await new AssignmentValidator({ execute } as never).checkConflicts(
      7,
      '2026-03-02',
      '02:00',
      '08:00'
    );

    expect(conflicts).toEqual([
      {
        assignmentId: 42,
        shiftDate: '2026-03-01',
        startTime: '22:00:00',
        endTime: '06:00:00',
        departmentName: 'Night Ward',
      },
    ]);
  });
});
