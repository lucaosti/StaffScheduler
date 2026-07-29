/**
 * Swap candidates.
 *
 * This endpoint is the one place an ordinary employee learns about someone
 * else's assignment, so the tests that matter are the ones about what it
 * refuses to say: it answers only for the caller's own shift, only within the
 * org units they belong to, and never for an exchange that would leave either
 * person double-booked.
 *
 * @author Luca Ostinelli
 */

import { SwapCandidateService } from '../services/SwapCandidateService';
import { ForbiddenError, NotFoundError } from '../errors';

export {};

const checkConflicts = jest.fn();
jest.mock('../services/AssignmentValidator', () => ({
  AssignmentValidator: jest.fn().mockImplementation(() => ({
    checkConflicts: (...args: unknown[]) => checkConflicts(...args),
  })),
}));

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const OWN = {
  id: 1,
  user_id: 5,
  shift_id: 10,
  date: '2033-04-01',
  start_time: '09:00:00',
  end_time: '17:00:00',
};

const candidateRow = (over: Record<string, unknown> = {}) => ({
  id: 2,
  user_id: 9,
  shift_id: 11,
  user_name: 'Grace Hopper',
  date: '2033-04-02',
  start_time: '09:00:00',
  end_time: '17:00:00',
  department_name: 'Ward A',
  ...over,
});

beforeEach(() => {
  checkConflicts.mockReset().mockResolvedValue([]);
});

describe('ownership', () => {
  it('refuses to answer for someone else\'s assignment', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ ...OWN, user_id: 99 }], []]);

    // Without this the endpoint would answer "who works near this shift" for
    // any id a caller cared to try.
    await expect(
      new SwapCandidateService(pool).forAssignment(1, 5, null)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError for an assignment that does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      new SwapCandidateService(pool).forAssignment(99, 5, null)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('scoping', () => {
  it('restricts to the caller\'s org units inside the query', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[], []]);

    await new SwapCandidateService(pool).forAssignment(1, 5, [3, 4]);

    // A row the caller may not see is never read, so no later filter can be
    // forgotten.
    expect(String(execute.mock.calls[1][0])).toContain('d.org_unit_id IN (3,4)');
  });

  it('returns nothing, and queries nothing further, for an empty scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]);

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, []);

    // Belonging to no unit means seeing nobody, not everybody.
    expect(out.candidates).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('omits the restriction for an unrestricted caller', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[], []]);
    await new SwapCandidateService(pool).forAssignment(1, 5, null);
    expect(String(execute.mock.calls[1][0])).not.toContain('org_unit_id IN');
  });
});

describe('which assignments are offered', () => {
  it('excludes the caller, the same shift, the past and the far future in SQL', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[], []]);

    await new SwapCandidateService(pool).forAssignment(1, 5, null);

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain('sa.user_id != ?');
    expect(sql).toContain('sa.shift_id != ?');
    // A shift that has already run cannot be swapped; taking one is not a
    // swap, it is a hole in the roster.
    expect(sql).toContain('s.date >= CURDATE()');
    expect(sql).toContain('INTERVAL 60 DAY');
    expect(params).toEqual([5, 10]);
  });

  it('returns a candidate the exchange would survive', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[candidateRow()], []]);

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);

    expect(out.candidates).toEqual([
      {
        assignmentId: 2,
        userId: 9,
        userName: 'Grace Hopper',
        shiftId: 11,
        date: '2033-04-02',
        startTime: '09:00:00',
        endTime: '17:00:00',
        departmentName: 'Ward A',
      },
    ]);
    expect(out.truncated).toBe(false);
  });

  it('drops a candidate that would double-book the caller', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[candidateRow()], []]);
    // A clash with something OTHER than the shift being given up.
    checkConflicts.mockResolvedValueOnce([{ assignmentId: 77 }]);

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);
    expect(out.candidates).toEqual([]);
  });

  it('drops a candidate that would double-book the other person', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[candidateRow()], []]);
    checkConflicts
      .mockResolvedValueOnce([]) // caller is fine
      .mockResolvedValueOnce([{ assignmentId: 88 }]); // the other person is not

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);
    // A swap that breaks the person receiving it is not a swap either.
    expect(out.candidates).toEqual([]);
  });

  it('discounts the clash each person has with the shift being exchanged', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[candidateRow()], []]);
    // Each person's only "conflict" is the very assignment the swap removes.
    checkConflicts
      .mockResolvedValueOnce([{ assignmentId: 1 }])
      .mockResolvedValueOnce([{ assignmentId: 2 }]);

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);
    // Counting those would reject every swap of two overlapping shifts, which
    // is most of the ones anyone wants.
    expect(out.candidates).toHaveLength(1);
  });
});

describe('the cap', () => {
  it('says the list is partial rather than presenting a prefix as the whole answer', async () => {
    const { pool, execute } = makePool();
    const many = Array.from({ length: 51 }, (_, i) => candidateRow({ id: i + 2, shift_id: i + 11 }));
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([many, []]);

    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);

    // The conflict check costs two queries per candidate, so it is bounded —
    // but a caller told nothing would believe they had seen everything.
    expect(out.candidates).toHaveLength(50);
    expect(out.truncated).toBe(true);
  });

  it('reports a complete list as complete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[OWN], []]).mockResolvedValueOnce([[candidateRow()], []]);
    const out = await new SwapCandidateService(pool).forAssignment(1, 5, null);
    expect(out.truncated).toBe(false);
  });
});
