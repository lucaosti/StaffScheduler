/**
 * ShiftSwapService unit tests (F01).
 *
 * Mocks the compliance engine to keep these tests focused on the service's
 * own state machine; compliance integration is covered in
 * compliance.engine.test.ts.
 *
 * approve()/decline() now authorize via the shared ApprovalDecisionService
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
  // The manager-step tests (approve/decline/cancel) all assume the target
  // has already accepted — 'pending' now means that, not "request submitted".
  status: 'pending',
  declined_by: null,
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

/** Queues the pool.execute calls `ApprovalDecisionService.decidePendingApproval`
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

  it('inserts the swap as pending_target and returns the persisted row (no workflow configured)', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // getWorkflowByChangeType('ShiftSwap.Request') -> not found (checked before insert)
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute.mockResolvedValueOnce([[buildSwap({ id: 42, status: 'pending_target' })], null]); // getById

    const service = new ShiftSwapService(pool);
    const created = await service.create({
      requesterUserId: 7,
      requesterAssignmentId: 100,
      targetAssignmentId: 200,
      notes: 'Family event',
    });
    expect(created.id).toBe(42);
    expect(created.targetUserId).toBe(8);
    expect(created.status).toBe('pending_target');
    expect(conn.execute.mock.calls[2][0]).toContain(`'pending_target'`);
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

  it('is available while still awaiting the target, not just while awaiting the manager (#522)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE
      .mockResolvedValueOnce([[buildSwap({ status: 'cancelled' })], null]); // getById after

    const service = new ShiftSwapService(pool);
    const result = await service.cancel(1, 7);

    expect(result.status).toBe('cancelled');
    expect(execute.mock.calls[0][0]).toContain(`IN ('pending_target', 'pending')`);
  });
});

// ── Workflow attachment, non-final steps and in-transaction diagnosis ────────
// These paths talk to the three composed approval services; each instance is
// spied directly (service internals) instead of sequencing its SQL through
// the pool mock — those services' own behaviour has its own suite, and
// spying keeps each test about ShiftSwapService's orchestration decisions only.

const engineOf = (service: ShiftSwapService) =>
  service as unknown as {
    workflows: { getWorkflowByChangeType: (t: string) => unknown };
    resolution: {
      resolvePrimaryOrgUnitForUser: (u: number) => unknown;
      canCreatePendingApprovalForStep: (s: unknown, c: unknown) => unknown;
    };
    decisions: {
      createPendingApprovalForStep: (w: number, s: unknown, l: unknown, c: unknown) => unknown;
      wouldBeFinalStep: (id: number) => unknown;
      decidePendingApproval: (...a: unknown[]) => unknown;
    };
  };

const workflowFixture = {
  id: 10,
  changeType: 'ShiftSwap.Request',
  requireAll: false,
  description: null,
  steps: [{ id: 20, workflowId: 10, stepOrder: 1, approverScope: 'unit_structure' }],
};

describe('ShiftSwapService.create — approver dry run', () => {
  it('checks the approval gate but does NOT attach a pending approval at creation (#522)', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null])
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute.mockResolvedValueOnce([[buildSwap({ id: 42, status: 'pending_target' })], null]); // getById

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine.workflows, 'getWorkflowByChangeType').mockResolvedValue(workflowFixture as never);
    jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    const canCreate = jest.spyOn(engine.resolution, 'canCreatePendingApprovalForStep').mockResolvedValue(true as never);
    const createPa = jest.spyOn(engine.decisions, 'createPendingApprovalForStep');

    const created = await service.create({
      requesterUserId: 7,
      requesterAssignmentId: 100,
      targetAssignmentId: 200,
    });

    expect(created.id).toBe(42);
    expect(created.status).toBe('pending_target');
    // The gate is checked (a dry run)...
    expect(canCreate).toHaveBeenCalled();
    // ...but nothing is actually attached — there is nothing for a manager
    // to decide until the target accepts.
    expect(createPa).not.toHaveBeenCalled();
  });
});

describe('ShiftSwapService.respondAsTarget', () => {
  it('rejects a caller who is not the target', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]);

    const service = new ShiftSwapService(pool);
    await expect(service.respondAsTarget(1, 999, true)).rejects.toThrow(/Forbidden/);
  });

  it('rejects responding to a swap that is not awaiting the target', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSwap({ status: 'pending', target_user_id: 8 })], null]);

    const service = new ShiftSwapService(pool);
    await expect(service.respondAsTarget(1, 8, true)).rejects.toThrow(/Cannot respond to swap in status 'pending'/);
  });

  it('declining ends the request immediately, with no manager involved', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE -> declined
      .mockResolvedValueOnce([[buildSwap({ status: 'declined', declined_by: 'target', target_user_id: 8 })], null]) // getById after
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]); // audit.write

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    const getWorkflow = jest.spyOn(engine.workflows, 'getWorkflowByChangeType');

    const result = await service.respondAsTarget(1, 8, false, 'not a good time');

    expect(result.status).toBe('declined');
    expect(result.declinedBy).toBe('target');
    expect(execute.mock.calls[1][0]).toContain(`declined_by = 'target'`);
    // No manager step is ever consulted on a decline.
    expect(getWorkflow).not.toHaveBeenCalled();
  });

  it('throws 409 when the swap was decided concurrently between the auth check and the guarded update', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // guarded UPDATE loses the race
      .mockResolvedValueOnce([[buildSwap({ status: 'cancelled', target_user_id: 8 })], null]); // re-fetch

    const service = new ShiftSwapService(pool);
    await expect(service.respondAsTarget(1, 8, false)).rejects.toThrow(/Cannot respond to swap in status 'cancelled'/);
  });

  it('throws 409 on an accept when the swap was decided concurrently between the auth check and the guarded update', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // guarded UPDATE loses the race
      .mockResolvedValueOnce([[buildSwap({ status: 'cancelled', target_user_id: 8 })], null]); // re-fetch

    const service = new ShiftSwapService(pool);
    jest.spyOn(engineOf(service).workflows, 'getWorkflowByChangeType').mockResolvedValue(null as never);
    await expect(service.respondAsTarget(1, 8, true)).rejects.toThrow(/Cannot respond to swap in status 'cancelled'/);
  });

  it('accepting attaches the first-step pending approval and routes the request to the manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE -> pending
      .mockResolvedValueOnce([[buildSwap({ status: 'pending', target_user_id: 8 })], null]) // getById after
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]); // audit.write

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine.workflows, 'getWorkflowByChangeType').mockResolvedValue(workflowFixture as never);
    jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    const createPa = jest
      .spyOn(engine.decisions, 'createPendingApprovalForStep')
      .mockResolvedValue({ id: 501 } as never);

    const result = await service.respondAsTarget(1, 8, true);

    expect(result.status).toBe('pending');
    expect(createPa).toHaveBeenCalledWith(
      10,
      workflowFixture.steps[0],
      { shiftSwapRequestId: 1 },
      { actorUserId: 7, orgUnitId: 3 }
    );
  });

  it('reverts to pending_target (not stranded) when approver resolution changes mid-flight', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE -> pending
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // revert UPDATE -> pending_target

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine.workflows, 'getWorkflowByChangeType').mockResolvedValue(workflowFixture as never);
    jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine.decisions, 'createPendingApprovalForStep').mockResolvedValue(null as never);

    await expect(service.respondAsTarget(1, 8, true)).rejects.toThrow(/approver resolution changed/);

    const revertCall = execute.mock.calls[execute.mock.calls.length - 1];
    expect(revertCall[0]).toContain(`'pending_target'`);
    expect(revertCall[1]).toEqual([1]);
  });

  it('accepting with no workflow configured routes straight to pending, with no pending approval to attach', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSwap({ status: 'pending_target', target_user_id: 8 })], null]) // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE -> pending
      .mockResolvedValueOnce([[buildSwap({ status: 'pending', target_user_id: 8 })], null]) // getById after
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]); // audit.write

    const service = new ShiftSwapService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine.workflows, 'getWorkflowByChangeType').mockResolvedValue(null as never);
    const createPa = jest.spyOn(engine.decisions, 'createPendingApprovalForStep');

    const result = await service.respondAsTarget(1, 8, true);

    expect(result.status).toBe('pending');
    expect(createPa).not.toHaveBeenCalled();
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
    jest.spyOn(engine.decisions, 'wouldBeFinalStep').mockResolvedValue(false as never);
    jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    const decide = jest
      .spyOn(engine.decisions, 'decidePendingApproval')
      .mockImplementation(async (...args: unknown[]) => {
        // Invoke the context provider like the real engine does, so the
        // org-unit resolution closure is exercised too.
        await (args[4] as () => Promise<unknown>)();
        return undefined as never;
      });

    const result = await service.approve(1, 99, 'first sign-off');

    expect(result.status).toBe('pending');
    expect(decide).toHaveBeenCalledWith(501, 99, 'approved', 'first sign-off', expect.any(Function), null);
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
    jest.spyOn(engineOf(service).decisions, 'wouldBeFinalStep').mockResolvedValue(true as never);
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
    jest.spyOn(engineOf(service).decisions, 'wouldBeFinalStep').mockResolvedValue(true as never);

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
    jest.spyOn(engineOf(service).decisions, 'wouldBeFinalStep').mockResolvedValue(true as never);

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
    jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine.decisions, 'decidePendingApproval').mockImplementation(async (...args: unknown[]) => {
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
    jest.spyOn(engine.decisions, 'wouldBeFinalStep').mockResolvedValue(false as never);
    jest.spyOn(engine.decisions, 'decidePendingApproval').mockResolvedValue(undefined as never);

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
    jest.spyOn(engine.decisions, 'wouldBeFinalStep').mockResolvedValue(true as never);
    const resolveOrg = jest.spyOn(engine.resolution, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
    jest.spyOn(engine.decisions, 'decidePendingApproval').mockImplementation(async (...args: unknown[]) => {
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
