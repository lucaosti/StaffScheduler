/**
 * ShiftSwapService unit tests (F01).
 *
 * Mocks the compliance engine to keep these tests focused on the service's
 * own state machine; compliance integration is covered in
 * compliance.engine.test.ts.
 *
 * approve()/decline() now authorize via the shared ApprovalEngineService
 * (pending_approvals) before touching the transactional swap logic — see
 * approvalEngine.service.test.ts for that engine's own unit tests.
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

const buildPendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: null,
  shift_swap_request_id: 1,
  workflow_id: 10,
  step_id: 20,
  step_order: 1,
  assigned_to_user_id: 99,
  assigned_to_org_unit_id: null,
  open_to_structure: 0,
  decided_by_user_id: null,
  status: 'pending',
  decided_at: null,
  decision_note: null,
  escalated_at: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], null]);
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

/** Queues the pool.execute calls `ApprovalEngineService.decidePendingApproval`
 *  makes: getPendingApprovalById, guarded UPDATE, then — only when approving
 *  and no next workflow step exists (the seeded ShiftSwap.Request has exactly
 *  one step) — a next-step lookup, before the final getPendingApprovalById
 *  (post-decision). Rejecting short-circuits before the next-step lookup. */
const queueDecideNoNextStep = (execute: jest.Mock, finalStatus: 'approved' | 'rejected') => {
  execute
    .mockResolvedValueOnce([[buildPendingApprovalRow()], null]) // getPendingApprovalById (pre)
    .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // guarded UPDATE
  if (finalStatus === 'approved') {
    execute.mockResolvedValueOnce([[], null]); // next-step lookup -> none
  }
  execute.mockResolvedValueOnce([[buildPendingApprovalRow({ status: finalStatus })], null]); // post-decision fetch
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

  it('inserts the swap and returns the persisted row (no workflow configured)', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute
      .mockResolvedValueOnce([[buildSwap({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]) // audit.write
      .mockResolvedValueOnce([[], null]); // getWorkflowByChangeType('ShiftSwap.Request') -> not found

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
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSwap({ status: 'declined' })], null]); // getById

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve swap/);
  });

  it('throws when no pending_approval row exists for the swap', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId -> none

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/No pending approval found/);
  });

  /** Queues the pool.execute calls `ShiftSwapService.approve`'s upfront
   *  `wouldBeFinalStep` check + compliance dry run make, before it ever calls
   *  `decidePendingApproval` — getPendingApprovalById, the next-step lookup
   *  (empty => final), then the assignment-pair read for the dry-run
   *  compliance check. */
  const queueApprovePreChecks = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null]) // wouldBeFinalStep: getPendingApprovalById
      .mockResolvedValueOnce([[], null]) // wouldBeFinalStep: next-step lookup -> none (final)
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]) // dry-run checkSwapCompliance: assignment pair read
      .mockResolvedValueOnce([[], null]); // dry-run checkSwapCompliance: duplicate-assignment check -> none
  };

  it('rejects the approval without deciding the pending approval if the requester would violate compliance', async () => {
    (Compliance.evaluateAssignmentCompliance as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        violations: [{ code: 'MAX_WEEKLY_HOURS', message: 'too many', details: {} }],
      });

    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    queueApprovePreChecks(execute);

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Requester would violate compliance/);
    // The dry-run compliance check fails before the workflow decision is
    // ever committed and before any swap transaction opens — the request
    // stays fully retryable instead of getting stuck "approved" with the
    // swap never applied.
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('atomically swaps user_ids and marks the request approved', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    queueApprovePreChecks(execute);
    queueDecideNoNextStep(execute, 'approved');
    execute.mockResolvedValueOnce([[buildSwap({ status: 'approved' })], null]); // final getById after transaction

    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null])
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]) // locked re-check: assignment pair read
      .mockResolvedValueOnce([[], null]) // locked re-check: duplicate-assignment check -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new ShiftSwapService(pool);
    const result = await service.approve(1, 99, 'OK');

    expect(result.status).toBe('approved');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('ShiftSwapService.decline', () => {
  it('declines a pending swap end to end', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    queueDecideNoNextStep(execute, 'rejected');
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE shift_swap_requests
      .mockResolvedValueOnce([[buildSwap({ status: 'declined' })], null]); // final getById

    const service = new ShiftSwapService(pool);
    const result = await service.decline(1, 99, 'no capacity');
    expect(result.status).toBe('declined');
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
