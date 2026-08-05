/**
 * ApprovalEngineService unit tests (issue #91).
 *
 * Covers:
 *   - single-step workflow resolves approver correctly
 *   - multi-step workflow returns first non-auto-approved step
 *   - auto-approve when actor is the approver
 *   - escalation: processEscalations returns overdue steps
 *   - escalation with mocked "now" excludes non-overdue steps
 */

import { ApprovalEngineService } from '../services/ApprovalEngineService';

// ──────────────────────────────────────────────────────────────────────────────
// Pool mock
// ──────────────────────────────────────────────────────────────────────────────

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

// Workflow row returned by getWorkflowByChangeType
const wfRow = {
  id: 1,
  change_type: 'TimeOff.Request',
  require_all: 0,
  description: null,
  created_at: new Date(),
  updated_at: new Date(),
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.resolveApprover', () => {
  it('resolves the unit_manager for a unit_manager step', async () => {
    const { pool, execute } = makePool();
    // getWorkflowByChangeType — workflow row
    execute.mockResolvedValueOnce([[wfRow], null]);
    // hydrateWorkflow — steps
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48,
    }], null]);
    // findUnitManager — org unit 5 has manager 10
    execute.mockResolvedValueOnce([[{ manager_user_id: 10 }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(10);
    expect(result!.autoApprove).toBe(false);
  });

  it('auto-approves when the actor is the resolved approver', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: null,
    }], null]);
    // findUnitManager — returns actorUserId itself
    execute.mockResolvedValueOnce([[{ manager_user_id: 7 }], null]);

    const svc = new ApprovalEngineService(pool);
    // actor 7 is also the manager → auto-approve all steps → returns null
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result).toBeNull();
  });

  it('returns the first non-auto-approved step in a multi-step workflow', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[
      { id: 1, workflow_id: 1, step_order: 1, approver_scope: 'unit_manager',
        approver_role_id: null, approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48 },
      { id: 2, workflow_id: 1, step_order: 2, approver_scope: 'company_role',
        approver_role_id: 3, approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: 72 },
    ], null]);
    // step 1: actor IS the manager → auto-approve
    execute.mockResolvedValueOnce([[{ manager_user_id: 7 }], null]);
    // step 2: company_role → returns user 20
    execute.mockResolvedValueOnce([[{ id: 20 }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result).not.toBeNull();
    expect(result!.step.stepOrder).toBe(2);
    expect(result!.approverUserId).toBe(20);
  });

  it('throws when no workflow is configured for the change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // no row

    const svc = new ApprovalEngineService(pool);
    await expect(svc.resolveApprover('UnknownType', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });
});

describe('ApprovalEngineService.resolveFirstStepAutoApprove', () => {
  it('reports autoApprove=true and the approver when the actor resolves the first step', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48,
    }], null]);
    execute.mockResolvedValueOnce([[{ manager_user_id: 7 }], null]); // findUnitManager -> actor themselves

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveFirstStepAutoApprove('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result.autoApprove).toBe(true);
    expect(result.approverUserId).toBe(7);
    expect(result.workflow.id).toBe(1);
  });

  it('reports autoApprove=false, and the resolved approver, for a second-step multi-step workflow — unlike resolveApprover it never walks past the first step', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[
      { id: 1, workflow_id: 1, step_order: 1, approver_scope: 'unit_manager',
        approver_role_id: null, approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48 },
      { id: 2, workflow_id: 1, step_order: 2, approver_scope: 'company_role',
        approver_role_id: 3, approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: 72 },
    ], null]);
    execute.mockResolvedValueOnce([[{ manager_user_id: 10 }], null]); // step 1 resolves to someone else

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveFirstStepAutoApprove('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result.autoApprove).toBe(false);
    expect(result.approverUserId).toBe(10);
  });

  it('throws when no workflow is configured for the change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    await expect(svc.resolveFirstStepAutoApprove('UnknownType', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });

  it('throws when the workflow has no steps', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[], null]); // no steps

    const svc = new ApprovalEngineService(pool);
    await expect(svc.resolveFirstStepAutoApprove('TimeOff.Request', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });
});

describe('ApprovalEngineService.decidePendingApproval — webhook dispatch (#315)', () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    change_request_id: null,
    time_off_request_id: null,
    employee_loan_id: null,
    shift_swap_request_id: null,
    workflow_id: 1,
    step_id: 1,
    step_order: 1,
    // Deciding user IS the assignee — isAuthorizedToDecide's cheap path, no extra query.
    assigned_to_user_id: 9,
    assigned_to_org_unit_id: null,
    open_to_structure: 0,
    decided_by_user_id: null,
    status: 'pending',
    decided_at: null,
    decision_note: null,
    escalated_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  it('dispatches an approval.decided webhook event on a rejection, given an organization', async () => {
    const { pool, execute } = makePool();
    // dispatch() is called without `await` (fire-and-forget, same as the
    // schedule/assignment call sites) — its own SELECT is issued
    // synchronously before decidePendingApproval continues to its final
    // getPendingApprovalById, but the resulting INSERT only happens once
    // that SELECT's promise resolves, in a later microtask. The mock queue
    // order below reflects the actual call ORDER, not dispatch's logical
    // position in the source.
    execute
      .mockResolvedValueOnce([[pendingRow()], null]) // getPendingApprovalById (initial)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE pending_approvals
      .mockResolvedValueOnce([[{ id: 1, event_types: 'approval.decided' }], null]) // dispatch: matching subscriptions
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]) // getPendingApprovalById (updated)
      .mockResolvedValueOnce([{ insertId: 1 }, null]); // INSERT webhook_deliveries (resolves after the method returns)

    const svc = new ApprovalEngineService(pool);
    const result = await svc.decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never, 'Acme');
    // Flush the microtask queue so dispatch's continuation (the INSERT) runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(result.decision).toBe('rejected');
    const dispatchInsert = execute.mock.calls.find((c) => /INSERT INTO webhook_deliveries/.test(c[0]));
    expect(dispatchInsert).toBeDefined();
    expect(dispatchInsert![1][1]).toBe('approval.decided');
    expect(JSON.parse(dispatchInsert![1][2])).toMatchObject({ pendingApprovalId: 1, decision: 'rejected' });
  });

  it('does not let a webhook dispatch failure surface — the decision already resolved', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[pendingRow()], null]) // getPendingApprovalById (initial)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE pending_approvals
      .mockRejectedValueOnce(new Error('subscriptions table unavailable')) // dispatch's own SELECT
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]); // getPendingApprovalById (updated)

    const svc = new ApprovalEngineService(pool);
    const result = await svc.decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never, 'Acme');
    await Promise.resolve();
    await Promise.resolve();

    expect(result.decision).toBe('rejected');
  });

  it('does not dispatch when no organization is given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[pendingRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]);

    await new ApprovalEngineService(pool).decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never);
    await Promise.resolve();

    expect(execute.mock.calls.some((c) => /webhook_deliveries|webhook_subscriptions/.test(c[0]))).toBe(false);
  });
});

describe('ApprovalEngineService.processEscalations', () => {
  it('escalates overdue pending approvals and returns a summary', async () => {
    const { pool, execute } = makePool();
    // SELECT overdue rows
    execute.mockResolvedValueOnce([[
      { id: 1, change_request_id: 10, workflow_id: 2, step_id: 3, step_order: 1,
        assigned_to_user_id: 5, escalate_after_hours: 24, manager_id: 7 },
    ], null]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);  // UPDATE
    execute.mockResolvedValueOnce([{ insertId: 50 }, null]);     // INSERT

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(1);
    expect(result.items[0]).toMatchObject({
      pendingApprovalId: 1,
      entityRef: { changeRequestId: 10 },
      escalatedToUserId: 7,
    });
  });

  it('returns { escalated: 0, items: [] } when nothing is overdue', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});
