/**
 * TimeOffService unit tests (F02).
 *
 * Uses a queueable mysql2 Pool fake. Each test queues the result tuples the
 * service is expected to consume (via `pool.execute` / `pool.getConnection`)
 * and asserts the surfaced behaviour: validation, listing, approve/reject
 * state machine, and cancel ownership rules.
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
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  const fakeConn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const getConnection = jest.fn().mockResolvedValue(fakeConn);
  return { pool: { execute, getConnection } as never, execute, conn: fakeConn };
};

describe('TimeOffService.create', () => {
  it('rejects when endDate is before startDate', async () => {
    const { pool } = makePool();
    const service = new TimeOffService(pool);
    await expect(
      service.create({ userId: 1, startDate: '2026-05-10', endDate: '2026-05-09' })
    ).rejects.toThrow(/endDate must be on or after/);
  });

  it('inserts a pending request and returns the persisted row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 42 })], null] as Tuple);

    const service = new TimeOffService(pool);
    const created = await service.create({
      userId: 7,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      type: 'vacation',
      reason: 'Beach',
    });

    expect(created.id).toBe(42);
    expect(created.status).toBe('pending');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO time_off_requests/);
  });
});

describe('TimeOffService.approve', () => {
  it('refuses to approve a request that is not pending', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[buildRow({ status: 'approved' })], null]);

    const service = new TimeOffService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve request in status 'approved'/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('writes the unavailability row and links it back to the request', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null]) // SELECT FOR UPDATE
      .mockResolvedValueOnce([{ insertId: 555 }, null]) // INSERT INTO user_unavailability
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE time_off_requests
    execute.mockResolvedValueOnce([[buildRow({ status: 'approved', unavailability_id: 555 })], null]);

    const service = new TimeOffService(pool);
    const result = await service.approve(1, 99, 'OK');

    expect(result.status).toBe('approved');
    expect(result.unavailabilityId).toBe(555);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});

describe('TimeOffService.reject', () => {
  it('rejects only when status is pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // UPDATE matched 0
      .mockResolvedValueOnce([[buildRow({ status: 'approved' })], null]); // getById

    const service = new TimeOffService(pool);
    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject request in status 'approved'/);
  });
});

describe('TimeOffService.cancel', () => {
  it('forbids cancelling a request belonging to a different user', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([[buildRow({ user_id: 7, status: 'pending' })], null]);

    const service = new TimeOffService(pool);
    await expect(service.cancel(1, 999)).rejects.toThrow(/Forbidden/);
  });
});
