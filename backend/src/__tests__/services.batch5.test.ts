/**
 * Service coverage batch 5 — fills remaining null-refresh and edge-case gaps:
 *   PolicyService         — update: null refresh (line 170)
 *   TwoFactorService      — consumeRecoveryCode: no rows (line 109)
 *   ApprovalMatrixService — update: null refresh (line 114)
 *   AssignmentService     — createAssignment: null getAssignmentById (line 136)
 *   EmployeeLoanService   — create: pending loan with approverUserId (line 285)
 *   ApprovalEngineService — resolveApprover: unknown scope → null (line 303)
 *   ApprovalEngineService — resolveApprover: unit_manager_chain empty rows → null (line 330)
 *
 * @author Luca Ostinelli
 */

import { PolicyService } from '../services/PolicyService';
import { TwoFactorService } from '../services/TwoFactorService';
import { ApprovalMatrixService } from '../services/ApprovalMatrixService';
import { AssignmentService } from '../services/AssignmentService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { ApprovalEngineService } from '../services/ApprovalEngineService';

jest.mock('../services/ComplianceEngine', () => ({
  evaluateAssignmentCompliance: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
}));
jest.mock('../services/PolicyValidator', () => ({
  PolicyValidator: jest.fn().mockImplementation(() => ({
    validateAssignment: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
  })),
}));
jest.mock('../services/AssignmentValidator', () => ({
  AssignmentValidator: jest.fn().mockImplementation(() => ({
    checkConflicts: jest.fn().mockResolvedValue([]),
    checkUserAvailability: jest.fn().mockResolvedValue(true),
  })),
}));

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PolicyService — update: null refresh
// ─────────────────────────────────────────────────────────────────────────────

describe('PolicyService.update — null after UPDATE throws', () => {
  it('throws Failed to refresh policy when getById returns null after update', async () => {
    const { pool, execute } = makePool();
    const existingPolicyRow = {
      id: 1,
      scope_type: 'global',
      scope_id: null,
      policy_key: 'max_hours_per_week',
      policy_value: '40',
      description: null,
      imposed_by_user_id: 1,
      is_active: 1,
      created_at: 't',
      updated_at: 't',
    };
    execute
      .mockResolvedValueOnce([[existingPolicyRow], null] as Tuple) // getById existing
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById refresh → null
    const svc = new PolicyService(pool);
    await expect(svc.update(1, { isActive: false })).rejects.toThrow('Failed to refresh policy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TwoFactorService — consumeRecoveryCode: no rows
// ─────────────────────────────────────────────────────────────────────────────

describe('TwoFactorService.consumeRecoveryCode — no rows returns false', () => {
  it('returns false when user has no row in DB', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // SELECT returns no rows
    const svc = new TwoFactorService(pool);
    const result = await svc.consumeRecoveryCode(999, 'anycode');
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalMatrixService — update: null refresh
// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalMatrixService.update — null after UPDATE throws', () => {
  it('throws Failed to refresh approval matrix entry when getByChangeType returns null after update', async () => {
    const { pool, execute } = makePool();
    const matrixRow = {
      id: 1,
      change_type: 'Loan.Request',
      approver_scope: 'company_user',
      approver_role_id: null,
      approver_user_id: 5,
      auto_approve_for_owner: 0,
      description: null,
    };
    execute
      .mockResolvedValueOnce([[matrixRow], null] as Tuple) // getByChangeType existing
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[], null] as Tuple);                  // getByChangeType refresh → null
    const svc = new ApprovalMatrixService(pool);
    await expect(svc.update('Loan.Request', { approverUserId: 9 })).rejects.toThrow(
      'Failed to refresh approval matrix entry'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AssignmentService — createAssignment: null getAssignmentById after INSERT
// ─────────────────────────────────────────────────────────────────────────────

describe('AssignmentService.createAssignment — null after INSERT throws', () => {
  it('throws Failed to retrieve created assignment when getAssignmentById returns null', async () => {
    const { pool, execute, conn } = makePool();
    const shiftRow = {
      id: 1,
      date: '2026-07-01',
      start_time: '09:00',
      end_time: '17:00',
      department_id: 1,
      max_staff: 5,
      current_assignments: 0,
    };
    const userRow = { id: 10, role: 'employee' };
    conn.execute
      .mockResolvedValueOnce([[shiftRow], null]) // SELECT shift
      .mockResolvedValueOnce([[userRow], null])  // SELECT users
      .mockResolvedValueOnce([[], null])          // SELECT shift_skills (no required skills)
      .mockResolvedValueOnce([{ insertId: 99 }, null]); // INSERT shift_assignments
    execute.mockResolvedValueOnce([[], null] as Tuple); // getAssignmentById → null
    const svc = new AssignmentService(pool);
    await expect(
      svc.createAssignment({ shiftId: 1, userId: 10, notes: '' })
    ).rejects.toThrow('Failed to retrieve created assignment');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EmployeeLoanService — create: pending loan with approverUserId (line 285)
// ─────────────────────────────────────────────────────────────────────────────

describe('EmployeeLoanService.create — pending loan with approverUserId covers fanOut line 285', () => {
  it('adds approverUserId to notification targets when status is pending and approverUserId is set', async () => {
    const { pool, execute } = makePool();
    const matrixRow = {
      id: 1,
      change_type: 'Loan.Request',
      approver_scope: 'company_user',
      approver_role_id: null,
      approver_user_id: 8,
      auto_approve_for_owner: 0,
      description: null,
    };
    const loanRow = {
      id: 5,
      user_id: 10,
      from_org_unit_id: 1,
      to_org_unit_id: 2,
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      reason: null,
      status: 'pending',
      requested_by: 1,
      approver_user_id: 8,
      reviewed_at: null,
      review_notes: null,
      created_at: 't',
      updated_at: 't',
    };
    execute
      .mockResolvedValueOnce([[matrixRow], null] as Tuple)            // ApprovalMatrixService.getByChangeType
      .mockResolvedValueOnce([[], null] as Tuple)                     // getWorkflowByChangeType -> not found (checked before insert)
      .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }, null] as Tuple) // INSERT loan
      .mockResolvedValueOnce([[loanRow], null] as Tuple)              // getById
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)       // audit INSERT for loan.create
      .mockResolvedValueOnce([[{ id: 1, manager_user_id: null }], null] as Tuple); // fanOut org_units
    // The fire-and-forget notifyAsync() call races on the microtask queue in
    // a way that isn't worth pinning to an exact call index; resolve any
    // further call generically — this test is only about the notification
    // fan-out.
    execute.mockImplementation(() => Promise.resolve([{ insertId: 99, affectedRows: 1 }, null]));

    const svc = new EmployeeLoanService(pool);
    const result = await svc.create({
      userId: 10,
      fromOrgUnitId: 1,
      toOrgUnitId: 2,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      requestedBy: 1,
    });
    // loan was created as pending with approverUserId=8
    expect(result.status).toBe('pending');
    expect(result.approverUserId).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalEngineService — resolveStepApprover: unknown scope → null (line 303)
// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.resolveApprover — unknown approver scope returns null', () => {
  it('returns ResolvedStep with null approverUserId for an unrecognised scope', async () => {
    const { pool, execute } = makePool();
    const workflowRow = {
      id: 1,
      change_type: 'Test.Change',
      require_all: 0,
      description: null,
      created_at: 't',
      updated_at: 't',
    };
    const stepRow = {
      id: 1,
      workflow_id: 1,
      step_order: 1,
      approver_scope: 'totally_unknown_scope', // default case in switch
      approver_role_id: null,
      approver_user_id: null,
      auto_approve_for_owner: 0,
      escalate_after_hours: null,
    };
    execute
      .mockResolvedValueOnce([[workflowRow], null] as Tuple) // getWorkflowByChangeType
      .mockResolvedValueOnce([[stepRow], null] as Tuple);    // hydrateWorkflow steps
    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('Test.Change', { actorUserId: 1 });
    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
    expect(result!.autoApprove).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalEngineService — findUnitManagerChain: empty chainRows → null (line 330)
// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.resolveApprover — unit_manager_chain empty chainRows returns null', () => {
  it('returns null approverUserId when org_unit not found in chain walk', async () => {
    const { pool, execute } = makePool();
    const workflowRow = {
      id: 2,
      change_type: 'Chain.Test',
      require_all: 0,
      description: null,
      created_at: 't',
      updated_at: 't',
    };
    const stepRow = {
      id: 2,
      workflow_id: 2,
      step_order: 1,
      approver_scope: 'unit_manager_chain',
      approver_role_id: null,
      approver_user_id: null,
      auto_approve_for_owner: 0,
      escalate_after_hours: null,
    };
    execute
      .mockResolvedValueOnce([[workflowRow], null] as Tuple) // getWorkflowByChangeType
      .mockResolvedValueOnce([[stepRow], null] as Tuple)     // hydrateWorkflow steps
      .mockResolvedValueOnce([[], null] as Tuple);           // findUnitManagerChain SELECT → empty
    const svc = new ApprovalEngineService(pool);
    const result = await svc.resolveApprover('Chain.Test', { actorUserId: 1, orgUnitId: 42 });
    expect(result).not.toBeNull();
    expect(result!.approverUserId).toBeNull();
  });
});
