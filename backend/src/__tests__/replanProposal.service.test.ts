/**
 * Replanning proposals: the decision boundary for a published schedule.
 *
 * What matters here is that applying a plan is ALL OR NOTHING, in both
 * directions. The removals and the inserts share one transaction, because a
 * half-applied plan leaves shifts unstaffed that the approved plan staffs with
 * no record of which half took effect. And a plan whose shifts or people have
 * changed underneath it is refused whole, because a plan that is 95% still
 * valid is not 95% approved.
 *
 * @author Luca Ostinelli
 */

import { ReplanProposalService } from '../services/ReplanProposalService';
import { ConflictError, NotFoundError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

const payload = {
  assignments: [
    { shiftId: 10, userId: 1 },
    { shiftId: 11, userId: 2 },
  ],
  brokenCommitments: [{ userId: 3, shiftId: 10 }],
  keptCommitments: 1,
  totalShifts: 2,
};

const proposalRow = (over: Record<string, unknown> = {}) => ({
  id: 5,
  schedule_id: 9,
  proposed_by: 7,
  status: 'pending',
  engine: 'or-tools',
  payload: JSON.stringify(payload),
  decided_by: null,
  decision_reason: null,
  created_at: '2033-01-01 00:00:00',
  ...over,
});

describe('propose', () => {
  it('supersedes any pending proposal for the same schedule', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // supersede
      .mockResolvedValueOnce([{ insertId: 5 }, []]); // insert
    execute.mockResolvedValueOnce([[proposalRow()], []]);

    const created = await new ReplanProposalService(pool).propose({
      scheduleId: 9,
      proposedBy: 7,
      engine: 'or-tools',
      payload,
    });

    expect(created.id).toBe(5);
    // Keeping both would let a planner approve a diff computed against inputs
    // that have since changed, and make "the pending proposal" ambiguous.
    expect(conn.execute.mock.calls[0][0]).toContain("status = 'superseded'");
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back if the insert fails', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockRejectedValueOnce(new Error('boom'));

    await expect(
      new ReplanProposalService(pool).propose({
        scheduleId: 9,
        proposedBy: 7,
        engine: 'greedy',
        payload,
      })
    ).rejects.toThrow('boom');
    // Otherwise a failed proposal would leave the previous one superseded and
    // nothing to replace it.
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('parses a payload the driver hands back as a string', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]);
    const p = await new ReplanProposalService(pool).getById(5);
    expect(p.payload.assignments).toHaveLength(2);
  });

  it('accepts a payload the driver has already parsed', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[proposalRow({ payload })], []]);
    // mysql2 parses JSON columns itself; a TEXT fallback or an older driver
    // does not. Both shapes appear, so neither is assumed.
    const p = await new ReplanProposalService(pool).getById(5);
    expect(p.payload.keptCommitments).toBe(1);
  });

  it('throws NotFoundError for an unknown proposal', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await expect(new ReplanProposalService(pool).getById(99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists a schedule\'s proposals newest first', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]);
    await new ReplanProposalService(pool).listForSchedule(9);
    expect(execute.mock.calls[0][0]).toContain('ORDER BY id DESC');
  });
});

describe('reject', () => {
  it('records the decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[proposalRow({ status: 'rejected' })], []]);

    const p = await new ReplanProposalService(pool).reject(5, 3, 'Too disruptive');
    expect(p.status).toBe('rejected');
    expect(execute.mock.calls[0][1]).toEqual([3, 'Too disruptive', 5]);
  });

  it('refuses to re-decide a decided proposal', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([[proposalRow({ status: 'applied' })], []]);

    await expect(new ReplanProposalService(pool).reject(5, 3)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('apply', () => {
  /** Mocks a full successful application. */
  const arrange = (existing: Array<{ id: number; shift_id: number; user_id: number }>) => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]); // getById pre-check
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // claim
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], []]) // shifts still there
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]) // users still active
      .mockResolvedValueOnce([existing, []]) // current assignments
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // delete
      .mockResolvedValueOnce([{ affectedRows: 2 }, []]); // insert
    execute.mockResolvedValueOnce([[proposalRow({ status: 'applied' })], []]); // getById after
    return { pool, execute, conn };
  };

  it('removes what the approved plan leaves out and adds what it introduces', async () => {
    const { pool, conn } = arrange([
      { id: 100, shift_id: 10, user_id: 3 }, // broken commitment: not in the plan
      { id: 101, shift_id: 10, user_id: 1 }, // kept
    ]);

    const out = await new ReplanProposalService(pool).apply(5, 3, 'Approved');

    expect(out.removed).toBe(1);
    expect(out.inserted).toBe(2);
    // The deletion is the whole point: without it `brokenCommitments` names
    // people who are still assigned, and a schedule solved twice is the union
    // of both solves.
    expect(conn.execute.mock.calls[4][0]).toContain('DELETE FROM shift_assignments WHERE id IN (100)');
    expect(conn.commit).toHaveBeenCalled();
  });

  it('writes the new assignments pinned', async () => {
    const { pool, conn } = arrange([]);
    await new ReplanProposalService(pool).apply(5, 3);
    // The schedule is published, so an assignment in the approved plan is a
    // commitment the moment it exists — the same rule publishing applies.
    const insert = conn.execute.mock.calls.map((c) => String(c[0])).find((sql) => sql.includes('INSERT'));
    expect(insert).toContain('is_pinned');
    expect(insert).toContain('TRUE');
  });

  it('deletes nothing when the plan keeps everything', async () => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]);
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], []])
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []])
      .mockResolvedValueOnce([[{ id: 101, shift_id: 10, user_id: 1 }], []])
      .mockResolvedValueOnce([{ affectedRows: 2 }, []]); // insert, no delete
    execute.mockResolvedValueOnce([[proposalRow({ status: 'applied' })], []]);

    const out = await new ReplanProposalService(pool).apply(5, 3);
    expect(out.removed).toBe(0);
    // A `DELETE ... IN ()` with an empty list is a syntax error, so the
    // statement must not be issued at all rather than issued with no ids.
    expect(conn.execute.mock.calls.every((c) => !String(c[0]).startsWith('DELETE'))).toBe(true);
  });

  it('refuses a proposal that is not pending, before touching anything', async () => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([[proposalRow({ status: 'superseded' })], []]);

    await expect(new ReplanProposalService(pool).apply(5, 3)).rejects.toBeInstanceOf(ConflictError);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('loses the race rather than applying the same plan twice', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[proposalRow()], []]) // read says pending
      .mockResolvedValueOnce([[proposalRow({ status: 'applied' })], []]); // by now it is not
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]); // claim failed

    // Two approvers clicking at once would otherwise both pass the read, and
    // the second application would delete assignments the first just wrote.
    await expect(new ReplanProposalService(pool).apply(5, 3)).rejects.toBeInstanceOf(ConflictError);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('refuses the whole plan when a shift it names has gone', async () => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]);
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 10 }], []]); // one of the two shifts is missing

    await expect(new ReplanProposalService(pool).apply(5, 3)).rejects.toThrow(/deleted or moved/);
    // The claim is rolled back with everything else: a refused plan must not
    // leave the proposal marked applied.
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('refuses the whole plan when someone it assigns is no longer active', async () => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([[proposalRow()], []]);
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], []])
      .mockResolvedValueOnce([[{ id: 1 }], []]); // user 2 deactivated

    await expect(new ReplanProposalService(pool).apply(5, 3)).rejects.toThrow(/no longer active/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('skips verification for an empty plan', async () => {
    const { pool, execute, conn } = makePool();
    execute.mockResolvedValueOnce([
      [proposalRow({ payload: JSON.stringify({ ...payload, assignments: [] }) })],
      [],
    ]);
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // claim
      .mockResolvedValueOnce([[{ id: 100, shift_id: 10, user_id: 3 }], []]) // current
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // delete
    execute.mockResolvedValueOnce([[proposalRow({ status: 'applied' })], []]);

    // An empty plan names no shifts and no people, so there is nothing to
    // verify — and `IN ()` would be a syntax error. It still removes: an
    // approved empty plan means the schedule should be empty.
    const out = await new ReplanProposalService(pool).apply(5, 3);
    expect(out.inserted).toBe(0);
    expect(out.removed).toBe(1);
  });
});
