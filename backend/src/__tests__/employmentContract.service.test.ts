/**
 * Employment contracts: effective-dated working-time limits.
 *
 * The behaviour worth testing here is the RESOLUTION, not the CRUD. A schedule
 * spans weeks, so a contract change can fall inside its period, and the answer
 * to "which limits applied?" is what decides whether a generated schedule is
 * legal. Getting it wrong in the permissive direction produces schedules that
 * breach a limit which was in force while they ran.
 *
 * @author Luca Ostinelli
 */

import { EmploymentContractService } from '../services/EmploymentContractService';
import { NotFoundError, ValidationError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Full time',
  description: null,
  is_active: 1,
  max_hours_per_week: 40,
  min_hours_per_week: 0,
  max_hours_per_day: 8,
  max_consecutive_days: 5,
  min_hours_between_shifts: 11,
  min_consecutive_days_off: 2,
  ...over,
});

describe('resolveLimitsForPeriod', () => {
  it('returns the contract in force over the period', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 7, ...contractRow() }], []]);

    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7],
      '2033-04-01',
      '2033-04-30'
    );

    expect(limits.get(7)).toEqual({
      maxHoursPerWeek: 40,
      minHoursPerWeek: 0,
      maxHoursPerDay: 8,
      maxConsecutiveDays: 5,
      minHoursBetweenShifts: 11,
      minConsecutiveDaysOff: 2,
    });
  });

  /**
   * The case the whole design exists for. Someone moving from full-time to
   * part-time mid-period must not be scheduled all period under whichever
   * contract happens to be picked. Taking the tightest bound in force at any
   * point is conservative in the direction that matters: it can under-schedule
   * someone whose limits ROSE, but never produces a schedule breaching a limit
   * that applied while it ran.
   */
  it('takes the tightest upper bound when the period spans a contract change', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, ...contractRow({ id: 1, max_hours_per_week: 40, max_consecutive_days: 5 }) },
        { user_id: 7, ...contractRow({ id: 2, max_hours_per_week: 20, max_consecutive_days: 3 }) },
      ],
      [],
    ]);

    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7],
      '2033-04-01',
      '2033-04-30'
    );

    expect(limits.get(7)).toMatchObject({ maxHoursPerWeek: 20, maxConsecutiveDays: 3 });
  });

  /**
   * A MINIMUM is tightened by RAISING it, not lowering it. Getting this
   * backwards would relax a rest requirement — the direction that produces an
   * illegal schedule rather than a merely inconvenient one.
   */
  it('tightens lower bounds upward, not downward', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, ...contractRow({ id: 1, min_hours_between_shifts: 8, min_hours_per_week: 0 }) },
        { user_id: 7, ...contractRow({ id: 2, min_hours_between_shifts: 12, min_hours_per_week: 16 }) },
      ],
      [],
    ]);

    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7],
      '2033-04-01',
      '2033-04-30'
    );

    expect(limits.get(7)).toMatchObject({ minHoursBetweenShifts: 12, minHoursPerWeek: 16 });
  });

  /**
   * `null` means "this contract does not constrain it", which must LOSE to any
   * number: a contract silent on a limit cannot loosen one that another
   * contract in the same period does set.
   */
  it('lets a stated limit win over an unstated one', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, ...contractRow({ id: 1, max_hours_per_week: null, max_hours_per_day: null }) },
        { user_id: 7, ...contractRow({ id: 2, max_hours_per_week: 24, max_hours_per_day: 6 }) },
      ],
      [],
    ]);

    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7],
      '2033-04-01',
      '2033-04-30'
    );

    expect(limits.get(7)).toMatchObject({ maxHoursPerWeek: 24, maxHoursPerDay: 6 });
  });

  it('omits users with no contract rather than inventing limits', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);

    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7, 8],
      '2033-04-01',
      '2033-04-30'
    );

    // "No contract" is not the same as "a contract with no limits"; callers
    // apply their own defaults, and conflating the two here would hide which
    // employees are actually unconstrained.
    expect(limits.size).toBe(0);
  });

  it('does not query at all for an empty user list', async () => {
    const { pool, execute } = makePool();
    const limits = await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [],
      '2033-04-01',
      '2033-04-30'
    );
    expect(limits.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('inlines only integer ids', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await new EmploymentContractService(pool).resolveLimitsForPeriod(
      [7, NaN, 9] as number[],
      '2033-04-01',
      '2033-04-30'
    );
    // An IN list cannot be a single bound parameter, so the ids are
    // interpolated — which is only safe because non-integers are dropped
    // first. The dates remain bound.
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('IN (7,9)');
    expect(params).toEqual(['2033-04-30', '2033-04-01']);
  });
});

describe('assign', () => {
  it('rejects a period overlapping an existing assignment', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 3 }], []]); // an overlapping row exists

    await expect(
      new EmploymentContractService(pool).assign({
        userId: 7,
        contractId: 2,
        effectiveFrom: '2033-04-01',
        effectiveTo: null,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an end before the start', async () => {
    const { pool } = makePool();
    await expect(
      new EmploymentContractService(pool).assign({
        userId: 7,
        contractId: 2,
        effectiveFrom: '2033-04-30',
        effectiveTo: '2033-04-01',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('treats an open-ended assignment as overlapping anything after it', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 3 }], []]);

    await expect(
      new EmploymentContractService(pool).assign({
        userId: 7,
        contractId: 2,
        effectiveFrom: '2040-01-01',
      })
    ).rejects.toBeInstanceOf(ValidationError);

    // `effective_to IS NULL` means still in force, so the comparison has to
    // substitute a far-future date rather than treating NULL as "ended".
    const [sql] = execute.mock.calls[0];
    expect(sql).toContain("COALESCE(effective_to, '9999-12-31')");
  });
});

describe('contract CRUD', () => {
  const row = contractRow();

  it('lists contracts', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[row], []]);
    const all = await new EmploymentContractService(pool).list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 1, name: 'Full time', isActive: true });
  });

  it('throws NotFoundError for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await expect(new EmploymentContractService(pool).getById(99)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('creates a contract, defaulting unstated limits to null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, []])
      .mockResolvedValueOnce([[contractRow({ id: 5 })], []]);

    await new EmploymentContractService(pool).create({ name: 'Casual' });

    const [, params] = execute.mock.calls[0];
    // `null` is "this contract does not constrain it" — distinct from zero, so
    // an unstated limit must not become one.
    expect(params).toEqual(['Casual', null, null, null, null, null, null, null]);
  });

  it('keeps current values for fields an update omits', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[row], []]) // current
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[contractRow({ max_hours_per_week: 24 })], []]);

    await new EmploymentContractService(pool).update(1, { maxHoursPerWeek: 24 });

    const [, params] = execute.mock.calls[1];
    // name, description, isActive, weekly, minWeekly, daily, consecutive,
    // rest-between-shifts, consecutive-days-off, id
    expect(params).toEqual(['Full time', null, true, 24, 0, 8, 5, 11, 2, 1]);
  });

  it('distinguishes clearing a limit from omitting it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[row], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[contractRow({ max_hours_per_day: null })], []]);

    await new EmploymentContractService(pool).update(1, { maxHoursPerDay: null });

    const [, params] = execute.mock.calls[1];
    // Explicit null must clear the daily cap, not be treated as "unchanged" —
    // `?? current` would have kept 8 and made the field impossible to unset.
    expect(params[5]).toBeNull();
  });

  it('returns a user contract history with dates normalised to YYYY-MM-DD', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          id: 3,
          user_id: 7,
          contract_id: 1,
          contract_name: 'Full time',
          effective_from: new Date('2033-01-01T00:00:00Z'),
          effective_to: null,
        },
      ],
      [],
    ]);

    const history = await new EmploymentContractService(pool).assignmentsForUser(7);
    expect(history[0]).toEqual({
      id: 3,
      userId: 7,
      contractId: 1,
      contractName: 'Full time',
      effectiveFrom: '2033-01-01',
      effectiveTo: null,
    });
  });

  it('assigns a contract when the period is free', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], []]) // no overlap
      .mockResolvedValueOnce([{ insertId: 4 }, []])
      .mockResolvedValueOnce([
        [
          {
            id: 4,
            user_id: 7,
            contract_id: 2,
            contract_name: 'Part time',
            effective_from: '2033-04-01',
            effective_to: '2033-06-30',
          },
        ],
        [],
      ]);

    const created = await new EmploymentContractService(pool).assign({
      userId: 7,
      contractId: 2,
      effectiveFrom: '2033-04-01',
      effectiveTo: '2033-06-30',
    });
    expect(created).toMatchObject({ id: 4, contractId: 2 });
  });
});
