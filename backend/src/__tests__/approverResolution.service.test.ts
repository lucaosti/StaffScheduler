/**
 * ApproverResolutionService — responsibility_rule scope tests.
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

import { ApproverResolutionService } from '../services/ApproverResolutionService';

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

describe('ApproverResolutionService.resolveApprover — responsibility_rule scope', () => {
  it('returns the first user from resolveResponsibleUsers when users are found', async () => {
    const { pool, execute } = makePool();
    // getWorkflowByChangeType
    execute.mockResolvedValueOnce([[wfRow], null]);
    // hydrateWorkflow (steps)
    execute.mockResolvedValueOnce([[makeStep()], null]);
    // ResponsibilityRuleService.resolveResponsibleUsers → [7, 8, 9]
    execute.mockResolvedValueOnce([[{ user_id: 7 }, { user_id: 8 }, { user_id: 9 }], null]);

    const svc = new ApproverResolutionService(pool);
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

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('returns approverUserId=null when approver_permission_code is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep({ approver_permission_code: null })], null]);
    // resolveResponsibleUsers should NOT be called

    const svc = new ApproverResolutionService(pool);
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

    const svc = new ApproverResolutionService(pool);
    // auto_approve_for_owner=true + actor is the approver → auto-approve all → null
    const result = await svc.resolveApprover('Leave.Request', { actorUserId: 5 });

    expect(result).toBeNull();
  });

  it('passes orgUnitId and subject context to resolveResponsibleUsers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[makeStep()], null]);
    execute.mockResolvedValueOnce([[{ user_id: 7 }], null]);

    const svc = new ApproverResolutionService(pool);
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

describe('ApproverResolutionService.resolveAllApproversForStep', () => {
  it('returns all user IDs for a responsibility_rule step', async () => {
    const { pool, execute } = makePool();
    // resolveResponsibleUsers
    execute.mockResolvedValueOnce([[{ user_id: 5 }, { user_id: 6 }, { user_id: 7 }], null]);

    const svc = new ApproverResolutionService(pool);
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
    const svc = new ApproverResolutionService(pool);
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
    const svc = new ApproverResolutionService(pool);
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
    const svc = new ApproverResolutionService(pool);
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

    const svc = new ApproverResolutionService(pool);
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

describe('ApproverResolutionService.resolveApproverForStep', () => {
  const makePoolLocal = () => {
    const execute = jest.fn();
    return { pool: { execute, getConnection: jest.fn() } as never, execute };
  };

  it('returns null for an unknown step and resolves a known one', async () => {
    const { pool, execute } = makePoolLocal();
    execute.mockResolvedValueOnce([[], null]);
    await expect(
      new ApproverResolutionService(pool).resolveApproverForStep(999, { actorUserId: 1 })
    ).resolves.toBeNull();

    const { pool: p2, execute: e2 } = makePoolLocal();
    e2.mockResolvedValueOnce([
      [
        {
          id: 20, workflow_id: 10, step_order: 1, approver_scope: 'company_user',
          approver_role_id: null, approver_user_id: 42, approver_permission_code: null,
          auto_approve_for_owner: 0, escalate_after_hours: null,
        },
      ],
      null,
    ]);
    await expect(
      new ApproverResolutionService(p2).resolveApproverForStep(20, { actorUserId: 1 })
    ).resolves.toBe(42);
  });
});

const timeOffWfRow = {
  id: 1,
  change_type: 'TimeOff.Request',
  require_all: 0,
  description: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('ApproverResolutionService.resolveApprover', () => {
  it('resolves the unit_manager for a unit_manager step', async () => {
    const { pool, execute } = makePool();
    // getWorkflowByChangeType — workflow row
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
    // hydrateWorkflow — steps
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48,
    }], null]);
    // findUnitManager — org unit 5 has manager 10
    execute.mockResolvedValueOnce([[{ manager_user_id: 10 }], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(10);
    expect(result!.autoApprove).toBe(false);
  });

  it('auto-approves when the actor is the resolved approver', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: null,
    }], null]);
    // findUnitManager — returns actorUserId itself
    execute.mockResolvedValueOnce([[{ manager_user_id: 7 }], null]);

    const svc = new ApproverResolutionService(pool);
    // actor 7 is also the manager → auto-approve all steps → returns null
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result).toBeNull();
  });

  it('returns the first non-auto-approved step in a multi-step workflow', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
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

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result).not.toBeNull();
    expect(result!.step.stepOrder).toBe(2);
    expect(result!.approverUserId).toBe(20);
  });

  it('throws when no workflow is configured for the change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // no row

    const svc = new ApproverResolutionService(pool);
    await expect(svc.resolveApprover('UnknownType', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });
});

describe('ApproverResolutionService.resolveFirstStepAutoApprove', () => {
  it('reports autoApprove=true and the approver when the actor resolves the first step', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48,
    }], null]);
    execute.mockResolvedValueOnce([[{ manager_user_id: 7 }], null]); // findUnitManager -> actor themselves

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveFirstStepAutoApprove('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result.autoApprove).toBe(true);
    expect(result.approverUserId).toBe(7);
    expect(result.workflow.id).toBe(1);
  });

  it('reports autoApprove=false, and the resolved approver, for a second-step multi-step workflow — unlike resolveApprover it never walks past the first step', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
    execute.mockResolvedValueOnce([[
      { id: 1, workflow_id: 1, step_order: 1, approver_scope: 'unit_manager',
        approver_role_id: null, approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: 48 },
      { id: 2, workflow_id: 1, step_order: 2, approver_scope: 'company_role',
        approver_role_id: 3, approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: 72 },
    ], null]);
    execute.mockResolvedValueOnce([[{ manager_user_id: 10 }], null]); // step 1 resolves to someone else

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveFirstStepAutoApprove('TimeOff.Request', { orgUnitId: 5, actorUserId: 7 });

    expect(result.autoApprove).toBe(false);
    expect(result.approverUserId).toBe(10);
  });

  it('throws when no workflow is configured for the change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApproverResolutionService(pool);
    await expect(svc.resolveFirstStepAutoApprove('UnknownType', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });

  it('throws when the workflow has no steps', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[timeOffWfRow], null]);
    execute.mockResolvedValueOnce([[], null]); // no steps

    const svc = new ApproverResolutionService(pool);
    await expect(svc.resolveFirstStepAutoApprove('TimeOff.Request', { actorUserId: 1 })).rejects.toThrow(
      /No approval workflow configured/
    );
  });
});


const additionalScopesWfRow = {
  id: 1,
  change_type: 'TimeOff.Request',
  require_all: 0,
  description: 'Test workflow',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

describe('ApproverResolutionService.resolveApprover — additional scopes', () => {
  it('returns policyOwnerId for policy_owner scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'policy_owner', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', {
      actorUserId: 3,
      policyOwnerId: 42,
    });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(42);
    expect(result!.autoApprove).toBe(false);
  });

  it('returns approverUserId directly for company_user scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'company_user', approver_role_id: null,
      approver_user_id: 55, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(55);
  });

  it('company_role scope with no active user returns null approverUserId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'company_role', approver_role_id: 99,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // findFirstActiveByRoleId — no users with that role
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('unit_manager_chain traverses to parent when direct unit has no manager', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager_chain', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // WITH RECURSIVE CTE returns the first non-null manager in the chain (parent's manager = 30)
    execute.mockResolvedValueOnce([[{ manager_user_id: 30 }], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', {
      actorUserId: 3,
      orgUnitId: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(30);
  });

  it('unit_manager_chain returns null when no unit exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager_chain', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // org unit not found
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', {
      actorUserId: 3,
      orgUnitId: 999,
    });

    // no auto-approve (auto_approve_for_owner=0) and approverUserId=null
    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('returns null when no orgUnitId provided for unit_manager scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApproverResolutionService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 5 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('returns null (all auto-approved) when every step can auto-approve', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[additionalScopesWfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'policy_owner', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: null,
    }], null]);

    const svc = new ApproverResolutionService(pool);
    // actor IS the policy owner → auto-approve
    const result = await svc.resolveApprover('TimeOff.Request', {
      actorUserId: 7,
      policyOwnerId: 7,
    });

    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// processEscalations — uses current time by default
// ──────────────────────────────────────────────────────────────────────────────

