/**
 * ApprovalEngineService — responsibility_rule scope tests.
 *
 * Verifies that steps with approver_scope = 'responsibility_rule' delegate
 * resolution to ResponsibilityRuleService.resolveResponsibleUsers().
 *
 * Covers:
 *   - resolveApprover returns first responsible user
 *   - resolveApprover returns null when no responsible users found
 *   - resolveApprover returns null when approver_permission_code is absent
 *   - auto-approve when actor is the first responsible user
 *   - resolveAllApproversForStep returns full list for responsibility_rule scope
 *   - resolveAllApproversForStep delegates to single-approver path for other scopes
 *   - subject context (departmentIds, roleIds) is forwarded to the resolver
 *
 * @author Luca Ostinelli
 */

import { ApprovalEngineService } from '../services/ApprovalEngineService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

const wfRow = {
  id: 10,
  change_type: 'Leave.Request',
  require_all: 0,
  description: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const makeStep = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  workflow_id: 10,
  step_order: 1,
  approver_scope: 'responsibility_rule',
  approver_role_id: null,
  approver_user_id: null,
  approver_permission_code: 'leave.manage',
  auto_approve_for_owner: 1,
  escalate_after_hours: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveApprover — responsibility_rule scope
// ---------------------------------------------------------------------------

describe('ApprovalEngineService.resolveApprover — responsibility_rule scope', () => {
  it('returns the first user from resolveResponsibleUsers when users are found', async () => {
    const { pool, execute } = makePool();
    // getWorkflowByChangeType
    execute.mockResolvedValueOnce([[wfRow], null]);
    // hydrateWorkflow (steps)
    execute.mockResolvedValueOnce([[makeStep()], null]);
    // ResponsibilityRuleService.resolveResponsibleUsers → [7, 8, 9]
    execute.mockResolvedValueOnce([[{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(7);
    expect(result!.autoApprove).toBe(false);
  });

  it('returns approverUserId=null when no responsible users are found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep()], null]);
    // No responsible users
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('returns approverUserId=null when approver_permission_code is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep({ approver_permission_code: null })], null]);
    // resolveResponsibleUsers should NOT be called

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 3 });

    // step has no permission_code → approverUserId null → step returned with null approver
    expect(result!.approverUserId).toBeNull();
    // resolveResponsibleUsers query was NOT executed (only getWorkflow + hydrateWorkflow)
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('auto-approves when the actor is the first responsible user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep()], null]);
    // first resolved user is actorUserId (5)
    execute.mockResolvedValueOnce([[{ user_id: 5 }], null]);

    const svc = new ApprovalEngineService(pool);
    // auto_approve_for_owner=true + actor is the approver → auto-approve all → null
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 5 });

    expect(result).toBeNull();
  });

  it('passes orgUnitId and subject context to resolveResponsibleUsers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep()], null]);
    execute.mockResolvedValueOnce([[{ user_id: 7 }], null]);

    const svc = new ApprovalEngineService(pool);
    await svc.resolveApprover('Leave.Request', {
      actorUserId: 3,
      orgUnitId: 5,
      subjectDepartmentIds: [10, 11],
      subjectRoleIds: [2],
    });

    // Third call = resolveResponsibleUsers SQL
    const [sql, params] = execute.mock.calls[2];
    expect(sql).toContain('permission_code = ?');
    expect(params).toContain('leave.manage');
    expect(params).toContain(5);   // orgUnitId
    expect(params).toContain(10);  // departmentId
    expect(params).toContain(11);  // departmentId
    expect(params).toContain(2);   // roleId
  });
});

// ---------------------------------------------------------------------------
// resolveAllApproversForStep
// ---------------------------------------------------------------------------

describe('ApprovalEngineService.resolveAllApproversForStep', () => {
  it('returns all user IDs for a responsibility_rule step', async () => {
    const { pool, execute } = makePool();
    // resolveResponsibleUsers
    execute.mockResolvedValueOnce([[{ user_id: 5 }, { user_id: 6 }, { user_id: 7 }], null]);

    const svc = new ApprovalEngineService(pool);
    const step = {
      id: 1, workflowId: 10, stepOrder: 1,
      approverScope: 'responsibility_rule' as const,
      approverRoleId: null, approverUserId: null,
      approverPermissionCode: 'leave.manage',
      autoApproveForOwner: true, escalateAfterHours: null,
    };

    const ids = await svc.resolveAllApproversForStep(step, { actorUserId: 3, orgUnitId: 2 });
    expect(ids).toEqual([5, 6, 7]);
  });

  it('returns empty array when approverPermissionCode is absent', async () => {
    const { pool } = makePool();
    const svc = new ApprovalEngineService(pool);
    const step = {
      id: 1, workflowId: 10, stepOrder: 1,
      approverScope: 'responsibility_rule' as const,
      approverRoleId: null, approverUserId: null,
      approverPermissionCode: null,
      autoApproveForOwner: true, escalateAfterHours: null,
    };

    const ids = await svc.resolveAllApproversForStep(step, { actorUserId: 3 });
    expect(ids).toEqual([]);
  });

  it('returns single-element array for company_user scope', async () => {
    const { pool } = makePool();
    const svc = new ApprovalEngineService(pool);
    const step = {
      id: 2, workflowId: 10, stepOrder: 1,
      approverScope: 'company_user' as const,
      approverRoleId: null, approverUserId: 42,
      approverPermissionCode: null,
      autoApproveForOwner: false, escalateAfterHours: null,
    };

    const ids = await svc.resolveAllApproversForStep(step, { actorUserId: 3 });
    expect(ids).toEqual([42]);
  });

  it('returns empty array when company_user step has no approverUserId', async () => {
    const { pool } = makePool();
    const svc = new ApprovalEngineService(pool);
    const step = {
      id: 2, workflowId: 10, stepOrder: 1,
      approverScope: 'company_user' as const,
      approverRoleId: null, approverUserId: null,
      approverPermissionCode: null,
      autoApproveForOwner: false, escalateAfterHours: null,
    };

    const ids = await svc.resolveAllApproversForStep(step, { actorUserId: 3 });
    expect(ids).toEqual([]);
  });

  it('returns empty array for responsibility_rule with no matching users', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const step = {
      id: 1, workflowId: 10, stepOrder: 1,
      approverScope: 'responsibility_rule' as const,
      approverRoleId: null, approverUserId: null,
      approverPermissionCode: 'leave.manage',
      autoApproveForOwner: true, escalateAfterHours: null,
    };

    const ids = await svc.resolveAllApproversForStep(step, { actorUserId: 3 });
    expect(ids).toEqual([]);
  });
});
