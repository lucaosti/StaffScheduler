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
    execute.mockResolvedValueOnce([[], null]); // getWorkflowByChangeType('ShiftSwap.Request') -> not found (checked before insert)
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute
      .mockResolvedValueOnce([[buildSwap({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]); // audit.write

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

  it('rejects creation when the workflow exists but the requester has no primary org unit', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 10, change_type: 'ShiftSwap.Request', require_all: 0, description: null }], null]) // getWorkflowByChangeType
      .mockResolvedValueOnce([
        [
          {
            id: 20,
            workflow_id: 10,
            step_order: 1,
            approver_scope: 'unit_structure',
            approver_role_id: null,
            approver_user_id: null,
            approver_permission_code: null,
            auto_approve_for_owner: 1,
            escalate_after_hours: 48,
          },
        ],
        null,
      ]) // hydrate workflow steps
      .mockResolvedValueOnce([[], null]); // resolvePrimaryOrgUnitForUser -> no membership

    const service = new ShiftSwapService(pool);
    await expect(
      service.create({ requesterUserId: 7, requesterAssignmentId: 100, targetAssignmentId: 200 })
    ).rejects.toThrow(/No approver could be resolved/);
    // Rejected before the transaction ever opens — no swap row inserted.
    expect(conn.beginTransaction).not.toHaveBeenCalled();
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
   *  `wouldBeFinalStep` check makes — getPendingApprovalById, then the
   *  next-step lookup (empty => final). The swap itself (compliance,
   *  assignment updates) is now validated and applied entirely inside the
   *  transaction, before decidePendingApproval is ever called. */
  const queueApprovePreChecks = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null]) // wouldBeFinalStep: getPendingApprovalById
      .mockResolvedValueOnce([[], null]); // wouldBeFinalStep: next-step lookup -> none (final)
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
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // SELECT swap FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]) // checkSwapCompliance: assignment pair read
      .mockResolvedValueOnce([[], null]); // checkSwapCompliance: duplicate-assignment check -> none

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Requester would violate compliance/);
    // Compliance fails inside the transaction, before decidePendingApproval
    // is ever called — the workflow decision is never committed, so the
    // request stays fully retryable instead of getting stuck "approved"
    // with the swap never applied.
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rejects the approval if the requester assignment was reassigned to someone else since creation', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    queueApprovePreChecks(execute);
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // SELECT swap FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([
        [
          // requester_user_id on the swap is 7, but assignment 100 now
          // belongs to user 999 — reassigned by a different swap in the
          // meantime.
          { assignment_id: 100, user_id: 999, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]); // checkSwapCompliance: assignment pair read

    const service = new ShiftSwapService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/has been reassigned to another user/);
  });

  it('atomically swaps user_ids and marks the request approved', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    queueApprovePreChecks(execute);

    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // SELECT swap FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]) // checkSwapCompliance: assignment pair read
      .mockResolvedValueOnce([[], null]) // checkSwapCompliance: duplicate-assignment check -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE assignment 100
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE assignment 200
    queueDecideNoNextStep(execute, 'approved');
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE shift_swap_requests
    execute.mockResolvedValueOnce([[buildSwap({ status: 'approved' })], null]); // final getById after transaction

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

// ── Workflow attachment, non-final steps and in-transaction diagnosis ────────
// These paths talk to ApprovalEngineService; the engine instance is spied
// directly (service internals) instead of sequencing its SQL through the
// pool mock — the engine's own behaviour has its own suite, and spying keeps
// each test about ShiftSwapService's orchestration decisions only.

const engineOf = (service: ShiftSwapService) =>
  (service as unknown as { engine: Record<string, jest.Mock> }).engine as unknown as {
    getWorkflowByChangeType: (t: string) => unknown;
    resolvePrimaryOrgUnitForUser: (u: number) => unknown;
    canCreatePendingApprovalForStep: (s: unknown, c: unknown) => unknown;
    createPendingApprovalForStep: (w: number, s: unknown, l: unknown, c: unknown) => unknown;
    wouldBeFinalStep: (id: number) => unknown;
    decidePendingApproval: (...a: unknown[]) => unknown;
  };

const workflowFixture = {
  id: 10,
  changeType: 'ShiftSwap.Request',
  requireAll: false,
  description: null,
  steps: [{ id: 20, workflowId: 10, stepOrder: 1, approverScope: 'unit_structure' }],
};

describe('ShiftSwapService.create — workflow attachment', () => {
  it('attaches the first-step pending approval after commit', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute
      .mockResolvedValueOnce([[buildSwap({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]); // audit.write

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'getWorkflowByChangeType').mockResolvedValue(workflowFixture as never);
    jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine, 'canCreatePendingApprovalForStep').mockResolvedValue(true as never);
    const createPa = jest
      .spyOn(engine, 'createPendingApprovalForStep')
      .mockResolvedValue({ id: 501 } as never);

    const created = await service.create({
      requesterUserId: 7,
      requesterAssignmentId: 100,
      targetAssignmentId: 200,
    });

    expect(created.id).toBe(42);
    expect(createPa).toHaveBeenCalledWith(
      10,
      workflowFixture.steps[0],
      { shiftSwapRequestId: 42 },
      { actorUserId: 7, orgUnitId: 3 }
    );
  });

  it('deletes the stranded request when approver resolution changes mid-flight', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute
      .mockResolvedValueOnce([[buildSwap({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]) // audit.write
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // cleanup DELETE

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'getWorkflowByChangeType').mockResolvedValue(workflowFixture as never);
    jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine, 'canCreatePendingApprovalForStep').mockResolvedValue(true as never);
    jest.spyOn(engine, 'createPendingApprovalForStep').mockResolvedValue(null as never);

    await expect(
      service.create({ requesterUserId: 7, requesterAssignmentId: 100, targetAssignmentId: 200 })
    ).rejects.toThrow(/approver resolution changed during creation/);

    const deleteCall = execute.mock.calls[execute.mock.calls.length - 1];
    expect(deleteCall[0]).toContain('DELETE FROM shift_swap_requests');
    expect(deleteCall[1]).toEqual([42]);
  });
});

describe('ShiftSwapService.approve — non-final step', () => {
  it('records the decision and applies no swap side effects yet', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([[buildSwap()], null]); // refreshed getById

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(false as never);
    jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    const decide = jest
      .spyOn(engine, 'decidePendingApproval')
      .mockImplementation(async (...args: unknown[]) => {
        // Invoke the context provider like the real engine does, so the
        // org-unit resolution closure is exercised too.
        await (args[4] as () => Promise<unknown>)();
        return undefined as never;
      });

    const result = await service.approve(1, 99, 'first sign-off');

    expect(result.status).toBe('pending');
    expect(decide).toHaveBeenCalledWith(501, 99, 'approved', 'first sign-off', expect.any(Function));
    // No transaction, no assignment rewrites for a non-final decision.
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
});

describe('ShiftSwapService.approve — in-transaction concurrency diagnosis', () => {
  const startApprove = (conRows: unknown) => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    conn.execute.mockResolvedValueOnce([conRows, null]); // SELECT ... FOR UPDATE
    const service = new ShiftSwapService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);
    return { service, conn };
  };

  it('throws 404 when the locked re-read finds the row gone', async () => {
    const { service, conn } = startApprove([]);
    await expect(service.approve(1, 99)).rejects.toThrow('Shift swap request not found');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('throws 409 when the row was decided between the auth check and the lock', async () => {
    const { service } = startApprove([buildSwap({ status: 'approved' })]);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve swap in status 'approved'/);
  });

  it('rejects when the TARGET assignment was reassigned since creation', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null]);
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock assignments
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 999, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]);
    const service = new ShiftSwapService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);

    await expect(service.approve(1, 99)).rejects.toThrow(
      /Target's assignment .* has been reassigned/
    );
  });

  it.each([
    [7, 'Requester'],
    [8, 'Target'],
  ])('blocks the swap when user %i already holds a conflicting assignment (%s)', async (dupUserId, who) => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null]);
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock assignments
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00', shift_id: 71 },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00', shift_id: 72 },
        ],
        null,
      ])
      .mockResolvedValueOnce([[{ id: 900, user_id: dupUserId, shift_id: 71 }], null]); // duplicate hit
    const service = new ShiftSwapService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);

    await expect(service.approve(1, 99)).rejects.toThrow(
      new RegExp(`${who} is already assigned to the other party's shift`)
    );
  });
});

describe('ShiftSwapService.decline — diagnosis ladder', () => {
  const declineWith = (updateResult: unknown, refetchRows: unknown[]) => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([updateResult, null]); // guarded UPDATE
    for (const rows of refetchRows) execute.mockResolvedValueOnce([rows, null]);
    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine, 'decidePendingApproval').mockImplementation(async (...args: unknown[]) => {
      await (args[4] as () => Promise<unknown>)();
      return undefined as never;
    });
    return service;
  };

  it('declines end to end through the engine decision', async () => {
    const service = declineWith({ affectedRows: 1 }, [
      [buildSwap({ status: 'declined', reviewer_id: 99 })],
    ]);
    const declined = await service.decline(1, 99, 'coverage need');
    expect(declined.status).toBe('declined');
  });

  it('throws 404 when the request vanished under the guarded update', async () => {
    const service = declineWith({ affectedRows: 0 }, [[]]);
    await expect(service.decline(1, 99)).rejects.toThrow('Shift swap request not found');
  });

  it('throws 409 when it was decided concurrently', async () => {
    const service = declineWith({ affectedRows: 0 }, [[buildSwap({ status: 'approved' })]]);
    await expect(service.decline(1, 99)).rejects.toThrow(/Cannot decline swap in status 'approved'/);
  });

  it('throws an internal error when the declined row cannot be re-read', async () => {
    const service = declineWith({ affectedRows: 1 }, [[]]);
    await expect(service.decline(1, 99)).rejects.toThrow('Failed to retrieve declined swap');
  });
});

describe('ShiftSwapService — residual failure arms', () => {
  it('non-final approve throws when the refreshed row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([[], null]); // refreshed getById: gone

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(false as never);
    jest.spyOn(engine, 'decidePendingApproval').mockResolvedValue(undefined as never);

    await expect(service.approve(1, 99)).rejects.toThrow('Failed to retrieve shift swap request');
  });

  it('final approve resolves the org-unit context for the decision audit', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    conn.execute
      .mockResolvedValueOnce([[buildSwap()], null]) // FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock assignments
      .mockResolvedValueOnce([
        [
          { assignment_id: 100, user_id: 7, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { assignment_id: 200, user_id: 8, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ])
      .mockResolvedValueOnce([[], null]) // duplicate check -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE assignment 100
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE assignment 200
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE shift_swap_requests
    execute.mockResolvedValueOnce([[buildSwap({ status: 'approved' })], null]); // final getById

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(true as never);
    const resolveOrg = jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine, 'decidePendingApproval').mockImplementation(async (...args: unknown[]) => {
      await (args[4] as () => Promise<unknown>)();
      return undefined as never;
    });

    const result = await service.approve(1, 99);

    expect(result.status).toBe('approved');
    expect(resolveOrg).toHaveBeenCalledWith(7); // the requester's unit scopes the decision
  });

  it('decline refuses when no pending approval row exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap()], null]) // getById (auth check)
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId -> none

    await expect(new ShiftSwapService(pool).decline(1, 99)).rejects.toThrow(
      'No pending approval found for this shift swap'
    );
  });
});
