/**
 * Extended TimeOffService coverage targeting:
 *   - create input validation (missing dates, retrieval failure)
 *   - getById null path + Date-typed start/end
 *   - list with combined filters and no filters
 *   - approve "request not found" + post-commit refresh failure
 *   - reject success path + missing record
 *   - cancel success + missing record + status-mismatch path
 *
 * @author Luca Ostinelli
 */

import { TimeOffService } from '../services/TimeOffService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  start_date: '2026-05-10',
  end_date: '2026-05-15',
  type: 'vacation',
  reason: 'Beach',
  status: 'pending',
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  unavailability_id: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

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

describe('TimeOffService.create extra branches', () => {
  it('throws when startDate or endDate are missing', async () => {
    const { pool } = makePool();
    const svc = new TimeOffService(pool);
    await expect(
      svc.create({ userId: 1, startDate: '', endDate: '2026-05-10' } as never)
    ).rejects.toThrow(/required/);
  });

  it('throws when post-insert fetch fails', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(
      svc.create({ userId: 1, startDate: '2026-05-10', endDate: '2026-05-15' })
    ).rejects.toThrow(/Failed to retrieve created time-off request/);
  });
});

describe('TimeOffService.getById', () => {
  it('returns null when missing and maps Date-typed columns', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([
        [buildRow({ start_date: new Date('2026-05-10'), end_date: new Date('2026-05-15') })],
        null,
      ] as Tuple);
    const svc = new TimeOffService(pool);
    expect(await svc.getById(1)).toBeNull();
    const out = await svc.getById(1);
    expect(out?.startDate).toBe('2026-05-10');
    expect(out?.endDate).toBe('2026-05-15');
  });
});

describe('TimeOffService.list', () => {
  it('handles all filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);
    const svc = new TimeOffService(pool);
    const out = await svc.list({
      userId: 7,
      status: 'pending',
      rangeStart: '2026-05-01',
      rangeEnd: '2026-05-31',
    });
    expect(out.length).toBe(1);
  });

  it('returns rows when no filters are provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);
    const svc = new TimeOffService(pool);
    expect((await svc.list()).length).toBe(1);
  });
});

describe('TimeOffService.approve extra paths', () => {
  it('throws when the request is missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new TimeOffService(pool);
    await expect(svc.approve(1, 99)).rejects.toThrow(/Time-off request not found/);
  });

  it('throws when post-commit refresh fails', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ insertId: 555 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.approve(1, 99)).rejects.toThrow(/Failed to retrieve approved request/);
  });
});

describe('TimeOffService.reject extra paths', () => {
  it('returns the rejected request on the happy path', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'rejected' })], null] as Tuple);
    const svc = new TimeOffService(pool);
    const out = await svc.reject(1, 99, 'no');
    expect(out.status).toBe('rejected');
  });

  it('throws when the request does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.reject(1, 99)).rejects.toThrow(/Time-off request not found/);
  });

  it('throws when post-update refresh fails', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.reject(1, 99)).rejects.toThrow(/Failed to retrieve rejected request/);
  });
});

describe('TimeOffService.cancel extra paths', () => {
  it('throws when the request does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/Time-off request not found/);
  });

  it('throws when status is not pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([
        [buildRow({ user_id: 7, status: 'approved' })],
        null,
      ] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/Cannot cancel request in status 'approved'/);
  });

  it('returns cancelled request on success', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'cancelled' })], null] as Tuple);
    const svc = new TimeOffService(pool);
    const out = await svc.cancel(1, 7);
    expect(out.status).toBe('cancelled');
  });

  it('throws when post-update refresh fails', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new TimeOffService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/Failed to retrieve cancelled request/);
  });
});
