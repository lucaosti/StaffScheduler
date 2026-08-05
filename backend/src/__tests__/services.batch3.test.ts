/**
 * Service coverage batch 3 — fills remaining gaps:
 *   PolicyExceptionService  — post-create null (109), notification catch (122),
 *                             approve: existing-null (179), policy-null (181),
 *                             null-refresh (199), reject: existing-null (211),
 *                             policy-null (213), null-refresh (231),
 *                             cancel: null-refresh (255)
 *   EmployeeLoanService     — startDate missing (94), post-create null (129),
 *                             approve: existing-null (190), null-refresh (211),
 *                             reject: null-refresh (245),
 *                             cancel: existing-null (270), null-refresh (285)
 *   EmployeeService         — countEmployees error (lines 67-68)
 *   BulkImportService       — mapEmployeeRows empty (109), mapShiftRows empty (158),
 *                             importEmployees unknown role (235-236)
 *   AssignmentOrchestrator  — post-confirm null (57), post-cancel null (82)
 *
 * @author Luca Ostinelli
 */

import { PolicyExceptionService } from '../services/PolicyExceptionService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { EmployeeService } from '../services/EmployeeService';
import { mapEmployeeRows, mapShiftRows } from '../services/BulkImportService';
import { AssignmentOrchestrator } from '../services/AssignmentOrchestrator';

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

// Minimal loan row
const loanRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1, user_id: 5, from_org_unit_id: 1, to_org_unit_id: 2,
  start_date: '2026-01-01', end_date: '2026-01-31',
  reason: null, status: 'pending', requested_by: 7,
  approver_user_id: 8, reviewed_at: null, review_notes: null,
  created_at: 't', updated_at: 't',
  ...overrides,
});

const loanPendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: 1,
  shift_swap_request_id: null,
  workflow_id: 10,
  step_id: 20,
  step_order: 1,
  assigned_to_user_id: 8,
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

// ─────────────────────────────────────────────────────────────────────────────
// PolicyExceptionService — uncovered null paths
//
// create/approve/reject's workflow-engine branches (post-insert null,
// notification catch, policy-not-found, refresh-null-after-decide) moved to
// the spy-based suite in services.extended.test.ts, alongside the workflow
// attachment/decision-arm tests they now share instance-boundary spying
// with — see PolicyExceptionService.approve/reject's engine.decidePendingApproval
// call. Only `cancel`, which the #603 migration left untouched, stays here.
// ─────────────────────────────────────────────────────────────────────────────

describe('PolicyExceptionService.cancel — null refresh', () => {
  it('throws Failed to refresh exception when getById returns null after cancel UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE cancel
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById refresh → null
    const svc = new PolicyExceptionService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow('Failed to refresh exception');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EmployeeLoanService — uncovered null paths
// ─────────────────────────────────────────────────────────────────────────────

describe('EmployeeLoanService.create — early validation throws', () => {
  it('throws startDate/endDate required when startDate is missing', async () => {
    const { pool } = makePool();
    const svc = new EmployeeLoanService(pool);
    await expect(svc.create({
      userId: 1, fromOrgUnitId: 1, toOrgUnitId: 2,
      startDate: '', endDate: '2026-01-31', requestedBy: 7,
    })).rejects.toThrow('startDate/endDate required');
  });
});

describe('EmployeeLoanService.create — post-insert null', () => {
  it('throws Failed to create loan when getById returns null after insert', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 10 }, null] as Tuple)  // INSERT loan
      .mockResolvedValueOnce([[], null] as Tuple);               // getById → null
    const svc = new EmployeeLoanService(pool);
    // Auto-approve path (see employeeLoan.service.test.ts for the same
    // instance-boundary spying): the workflow/matrix resolution has its own
    // dedicated test suite, so this pins only the post-insert null check.
    jest.spyOn(
      (svc as unknown as { engine: { resolveFirstStepAutoApprove: (t: string, c: unknown) => unknown } }).engine,
      'resolveFirstStepAutoApprove'
    ).mockResolvedValue({ workflow: null, approverUserId: 8, autoApprove: true } as never);
    await expect(svc.create({
      userId: 5, fromOrgUnitId: 1, toOrgUnitId: 2,
      startDate: '2026-01-01', endDate: '2026-01-31', requestedBy: 7,
    })).rejects.toThrow('Failed to create loan');
  });
});

describe('EmployeeLoanService.approve — null paths', () => {
  it('throws Loan not found when getById returns null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    await expect(svc.approve(1, 8)).rejects.toThrow('Loan not found');
  });

  it('throws Failed to refresh loan when getById returns null after approve UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null] as Tuple) // getById existing
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[loanPendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[loanPendingApprovalRow({ status: 'approved' })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE employee_loans
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById refresh → null
    const svc = new EmployeeLoanService(pool);
    await expect(svc.approve(1, 8)).rejects.toThrow('Failed to refresh loan');
  });
});

describe('EmployeeLoanService.reject — null refresh', () => {
  it('throws Failed to refresh loan when getById returns null after reject UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null] as Tuple) // getById existing
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[loanPendingApprovalRow()], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[loanPendingApprovalRow({ status: 'rejected' })], null] as Tuple) // post-decision fetch (rejected, no next-step lookup)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE employee_loans
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById refresh → null
    const svc = new EmployeeLoanService(pool);
    await expect(svc.reject(1, 8)).rejects.toThrow('Failed to refresh loan');
  });
});

describe('EmployeeLoanService.cancel — null paths', () => {
  it('throws Loan not found when getById returns null after affectedRows=0', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple) // UPDATE cancel (0 rows)
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById → null
    const svc = new EmployeeLoanService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow('Loan not found');
  });

  it('throws Failed to refresh loan when getById returns null after cancel UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE cancel (1 row)
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById refresh → null
    const svc = new EmployeeLoanService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow('Failed to refresh loan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EmployeeService — countEmployees error path
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../services/UserService');
import { UserService } from '../services/UserService';

describe('EmployeeService.countEmployees — error path', () => {
  it('bubbles errors from userService.countUsers', async () => {
    const { pool } = makePool();
    (UserService.prototype.countUsers as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const svc = new EmployeeService(pool);
    await expect(svc.countEmployees()).rejects.toThrow('db down');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportService — mapEmployeeRows and mapShiftRows empty early-return
// ─────────────────────────────────────────────────────────────────────────────

describe('BulkImportService pure helpers — empty rows early return', () => {
  it('mapEmployeeRows returns CSV is empty error when rows is empty', () => {
    const result = mapEmployeeRows([]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toBe('CSV is empty');
  });

  it('mapShiftRows returns CSV is empty error when rows is empty', () => {
    const result = mapShiftRows([]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toBe('CSV is empty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AssignmentOrchestrator — post-confirm and post-cancel null checks
// ─────────────────────────────────────────────────────────────────────────────

describe('AssignmentOrchestrator — null fetch after confirm/cancel', () => {
  it('throws Assignment not found after confirmation when fetchById returns null', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE confirm
    execute.mockResolvedValueOnce([[], null] as Tuple);              // fetchById → null
    const svc = new AssignmentOrchestrator(pool);
    await expect(svc.confirmAssignment(1)).rejects.toThrow('Assignment not found after confirmation');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('throws Assignment not found after cancellation when fetchById returns null', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE cancel
    execute.mockResolvedValueOnce([[], null] as Tuple);              // fetchById → null
    const svc = new AssignmentOrchestrator(pool);
    await expect(svc.cancelAssignment(1)).rejects.toThrow('Assignment not found after cancellation');
    expect(conn.rollback).toHaveBeenCalled();
  });
});
