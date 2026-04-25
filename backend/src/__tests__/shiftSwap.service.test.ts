/**
 * ShiftSwapService unit tests (F01).
 *
 * Mocks the compliance engine to keep these tests focused on the service's
 * own state machine; compliance integration is covered in
 * compliance.engine.test.ts.
 */

import { ShiftSwapService } from '../services/ShiftSwapService';
import * as Compliance from '../services/ComplianceEngine';

jest.mock('../services/ComplianceEngine', () => ({
  ...jest.requireActual('../services/ComplianceEngine'),
  evaluateAssignmentCompliance: jest.fn(),
}));

const buildSwap = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  requester_user_id: 7,
  requester_assignment_id: 100,
  target_user_id: 8,
  target_assignment_id: 200,
  status: 'pending',
  notes: null,
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: '2026-04-26T12:00:00.000Z',
  updated_at: '2026-04-26T12:00:00.000Z',
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
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

describe('ShiftSwapService.create', () => {
  it('refuses if the requester does not own the requester assignment', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 100, user_id: 999 }], null]);

    const service = new ShiftSwapService(pool);
    await expect(
      service.create({ requesterUserId: 7, requesterAssignmentId: 100, targetAssignmentId: 200 })
    ).rejects.toThrow(/does not own/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('refuses if the target assignment belongs to the same user', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 7 }], null]);

    const service = new ShiftSwapService(pool);
    await expect(
      service.create({ requesterUserId: 7, requesterAssignmentId: 100, targetAssignmentId: 200 })
    ).rejects.toThrow(/different user/);
  });

  it('inserts the swap and returns the persisted row', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute.mockResolvedValueOnce([[buildSwap({ id: 42 })], null]);

    const service = new ShiftSwapService(pool);
    const created = await service.create({
      requesterUserId: 7,
      requesterAssignmentId: 100,
      targetAssignmentId: 200,
      notes: 'Family event',
    });
    expect(created.id).toBe(42);
    expect(created.targetUserId).toBe(8);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('ShiftSwapService.approve', () => {
  beforeEach(() => {
    (Compliance.evaluateAssignmentCompliance as jest.Mock).mockResolvedValue({
      ok: true,
      violations: [],
    });
  });

  it('rejects when the swap is no longer pending', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[buildSwap({ status: 'declined' })], null]);

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve swap/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls back the swap if the requester would violate compliance', async () => {
    (Compliance.evaluateAssignmentCompliance as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        violations: [{ code: 'MAX_WEEKLY_HOURS', message: 'too many', details: {} }],
      });

    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null])
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]);

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Requester would violate compliance/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('atomically swaps user_ids and marks the request approved', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null])
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[buildSwap({ status: 'approved' })], null]);

    const service = new ShiftSwapService(pool);
    const result = await service.approve(1, 99, 'OK');

    expect(result.status).toBe('approved');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('ShiftSwapService.cancel', () => {
  it('only the requester may cancel', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([[buildSwap({ requester_user_id: 7 })], null]);

    const service = new ShiftSwapService(pool);
    await expect(service.cancel(1, 999)).rejects.toThrow(/Forbidden/);
  });
});
