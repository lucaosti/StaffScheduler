/**
 * ApprovalEngineService — extended unit tests.
 *
 * Covers:
 *   - listWorkflows: returns hydrated list of workflows
 *   - getWorkflowByChangeType: returns null when not found
 *   - createWorkflow: full happy path through transaction
 *   - createWorkflow: rolls back on error
 *   - updateWorkflow: patches fields and replaces steps
 *   - updateWorkflow: throws when workflow not found after update
 *   - deleteWorkflow: throws when workflow does not exist
 *   - deleteWorkflow: executes DELETE on success
 *   - resolveApprover: policy_owner scope
 *   - resolveApprover: company_user scope
 *   - resolveApprover: unit_manager_chain scope with chain traversal
 *   - resolveApprover: unit_manager_chain — manager found at parent level
 *   - resolveApprover: company_role scope — no active user found (returns null approver)
 *   - processEscalations: uses current time when no arg supplied
 */

import { ApprovalEngineService } from '../services/ApprovalEngineService';

// ──────────────────────────────────────────────────────────────────────────────
// Pool mock helpers
// ──────────────────────────────────────────────────────────────────────────────

const makeConnection = () => ({
  execute: jest.fn(),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
});

const makePool = () => {
  const execute = jest.fn();
  const mockConnection = makeConnection();
  const getConnection = jest.fn().mockResolvedValue(mockConnection);
  const pool = { execute, getConnection } as unknown as import('mysql2/promise').Pool;
  return { pool, execute, mockConnection, getConnection };
};

// Shared fixtures
const wfRow = {
  id: 1,
  change_type: 'TimeOff.Request',
  require_all: 0,
  description: 'Test workflow',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const stepRow = {
  id: 10,
  workflow_id: 1,
  step_order: 1,
  approver_scope: 'unit_manager',
  approver_role_id: null,
  approver_user_id: null,
  auto_approve_for_owner: 1,
  escalate_after_hours: 48,
};

// ──────────────────────────────────────────────────────────────────────────────
// listWorkflows
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.listWorkflows', () => {
  it('returns an empty array when no workflows exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.listWorkflows();

    expect(result).toEqual([]);
  });

  it('returns hydrated workflows with their steps', async () => {
    const { pool, execute } = makePool();
    // Single JOIN query returns workflow columns + step columns merged
    const joinedRow = {
      ...wfRow,
      step_id: stepRow.id,
      step_workflow_id: stepRow.workflow_id,
      step_order: stepRow.step_order,
      approver_scope: stepRow.approver_scope,
      approver_role_id: stepRow.approver_role_id,
      approver_user_id: stepRow.approver_user_id,
      auto_approve_for_owner: stepRow.auto_approve_for_owner,
      escalate_after_hours: stepRow.escalate_after_hours,
    };
    execute.mockResolvedValueOnce([[joinedRow], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.listWorkflows();

    expect(result).toHaveLength(1);
    expect(result[0].changeType).toBe('TimeOff.Request');
    expect(result[0].requireAll).toBe(false);
    expect(result[0].steps).toHaveLength(1);
    expect(result[0].steps[0].stepOrder).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getWorkflowByChangeType
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.getWorkflowByChangeType', () => {
  it('returns null when no workflow matches the change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.getWorkflowByChangeType('Unknown.Type');

    expect(result).toBeNull();
  });

  it('returns hydrated workflow when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[stepRow], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.getWorkflowByChangeType('TimeOff.Request');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.description).toBe('Test workflow');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createWorkflow
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.createWorkflow', () => {
  it('creates a workflow with steps in a transaction', async () => {
    const { pool, execute, mockConnection } = makePool();
    // conn.execute: INSERT workflow → insertId 5
    mockConnection.execute
      .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }, null])
      // INSERT step
      .mockResolvedValueOnce([{ insertId: 11, affectedRows: 1 }, null]);
    // After commit, pool.execute calls for getWorkflowById then hydrateWorkflow
    execute
      .mockResolvedValueOnce([[{ ...wfRow, id: 5 }], null])
      .mockResolvedValueOnce([[stepRow], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.createWorkflow({
      changeType: 'TimeOff.Request',
      requireAll: false,
      steps: [{
        stepOrder: 1,
        approverScope: 'unit_manager' as any,
        autoApproveForOwner: true,
        escalateAfterHours: 48,
      }],
    });

    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(result.id).toBe(5);
  });

  it('rolls back the transaction and rethrows on error', async () => {
    const { pool, mockConnection } = makePool();
    mockConnection.execute.mockRejectedValueOnce(new Error('DB constraint violation'));

    const svc = new ApprovalEngineService(pool);
    await expect(
      svc.createWorkflow({
        changeType: 'TimeOff.Request',
        steps: [{ stepOrder: 1, approverScope: 'company_user' as any }],
      })
    ).rejects.toThrow('DB constraint violation');

    expect(mockConnection.rollback).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updateWorkflow
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.updateWorkflow', () => {
  it('patches description and replaces steps', async () => {
    const { pool, execute, mockConnection } = makePool();
    mockConnection.execute
      // UPDATE approval_workflows
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      // DELETE steps
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      // INSERT new step
      .mockResolvedValueOnce([{ insertId: 20, affectedRows: 1 }, null]);
    // getWorkflowById + hydrateWorkflow after commit
    execute
      .mockResolvedValueOnce([[wfRow], null])
      .mockResolvedValueOnce([[stepRow], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.updateWorkflow(1, {
      description: 'Updated description',
      steps: [{ stepOrder: 1, approverScope: 'company_user' as any, approverUserId: 7 }],
    });

    expect(mockConnection.commit).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('rolls back and rethrows when an error occurs during update', async () => {
    const { pool, mockConnection } = makePool();
    mockConnection.execute.mockRejectedValueOnce(new Error('update failed'));

    const svc = new ApprovalEngineService(pool);
    await expect(
      svc.updateWorkflow(1, { description: 'oops' })
    ).rejects.toThrow('update failed');

    expect(mockConnection.rollback).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deleteWorkflow
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.deleteWorkflow', () => {
  it('throws when the workflow does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    await expect(svc.deleteWorkflow(999)).rejects.toThrow('Workflow not found');
  });

  it('executes DELETE when the workflow exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }], null])  // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);  // DELETE

    const svc = new ApprovalEngineService(pool);
    await expect(svc.deleteWorkflow(1)).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toContain('DELETE FROM approval_workflows');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveApprover — additional scopes
// ──────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.resolveApprover — additional scopes', () => {
  it('returns policyOwnerId for policy_owner scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'policy_owner', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApprovalEngineService(pool);
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
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'company_user', approver_role_id: null,
      approver_user_id: 55, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(55);
  });

  it('company_role scope with no active user returns null approverUserId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'company_role', approver_role_id: 99,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // findFirstActiveByRoleId — no users with that role
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 3 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('unit_manager_chain traverses to parent when direct unit has no manager', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager_chain', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // WITH RECURSIVE CTE returns the first non-null manager in the chain (parent's manager = 30)
    execute.mockResolvedValueOnce([[{ manager_user_id: 30 }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', {
      actorUserId: 3,
      orgUnitId: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBe(30);
  });

  it('unit_manager_chain returns null when no unit exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager_chain', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);
    // org unit not found
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
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
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'unit_manager', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 0, escalate_after_hours: null,
    }], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('TimeOff.Request', { actorUserId: 5 });

    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });

  it('returns null (all auto-approved) when every step can auto-approve', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[wfRow], null]);
    execute.mockResolvedValueOnce([[{
      id: 1, workflow_id: 1, step_order: 1,
      approver_scope: 'policy_owner', approver_role_id: null,
      approver_user_id: null, auto_approve_for_owner: 1, escalate_after_hours: null,
    }], null]);

    const svc = new ApprovalEngineService(pool);
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

describe('ApprovalEngineService.processEscalations — default now', () => {
  it('returns empty result when no overdue items exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(0);
    expect(result.items).toHaveLength(0);
    // Uses NOW() in SQL so no timestamp param is needed
    expect(execute.mock.calls[0][1]).toEqual([]);
  });

  it('returns multiple overdue items', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[
        { id: 1, change_request_id: 5, workflow_id: 1, step_id: 1, step_order: 1, assigned_to_user_id: 10, escalate_after_hours: 24, manager_id: 11 },
        { id: 2, change_request_id: 6, workflow_id: 2, step_id: 3, step_order: 1, assigned_to_user_id: 20, escalate_after_hours: 48, manager_id: null },
      ], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE row 1
      .mockResolvedValueOnce([{ insertId: 10 }, null])     // INSERT escalated for row 1
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE row 2 (no manager → no INSERT)

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].pendingApprovalId).toBe(1);
    expect(result.items[1].pendingApprovalId).toBe(2);
  });
});
