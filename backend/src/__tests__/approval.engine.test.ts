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

describe('ApprovalEngineService.processEscalations', () => {
  it('returns overdue workflow steps', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      { workflow_id: 1, step_id: 1, change_type: 'TimeOff.Request' },
    ], null]);

    const svc = new ApprovalEngineService(pool);
    const overdue = await svc.processEscalations('2030-01-01T00:00:00Z');

    expect(overdue).toHaveLength(1);
    expect(overdue[0].changeType).toBe('TimeOff.Request');
  });

  it('returns empty array when nothing is overdue', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const overdue = await svc.processEscalations('2020-01-01T00:00:00Z');

    expect(overdue).toHaveLength(0);
  });
});
