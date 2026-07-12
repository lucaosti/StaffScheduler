/**
 * F1 audit coverage tests.
 *
 * Verifies that every mutable operation on TimeOffService, ShiftSwapService,
 * EmployeeLoanService, and AssignmentService writes the expected audit log
 * entry with the correct action string and entity metadata.
 *
 * AuditLogService.prototype.write is spied on so the tests do not require a
 * real audit_logs table INSERT in the mock pool.
 */

import { AuditLogService } from '../services/AuditLogService';
import { TimeOffService } from '../services/TimeOffService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { AssignmentService } from '../services/AssignmentService';
import * as Compliance from '../services/ComplianceEngine';

jest.mock('../services/ComplianceEngine', () => ({
  ...jest.requireActual('../services/ComplianceEngine'),
  evaluateAssignmentCompliance: jest.fn(),
}));

jest.mock('../services/AssignmentValidator', () => ({
  AssignmentValidator: jest.fn().mockImplementation(() => ({
    checkConflicts: jest.fn().mockResolvedValue([]),
    checkUserAvailability: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('../services/PolicyValidator', () => ({
  PolicyValidator: jest.fn().mockImplementation(() => ({
    validateAssignment: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
  })),
}));

type Tuple = [unknown, unknown];

const auditSpy = () =>
  jest.spyOn(AuditLogService.prototype, 'write').mockResolvedValue(undefined);

// ── Pool factories ────────────────────────────────────────────────────────────

const makeSimplePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

const makeConnPool = () => {
  const execute = jest.fn();
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

// ── Row builders ─────────────────────────────────────────────────────────────

const timeOffRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  start_date: '2026-05-10',
  end_date: '2026-05-15',
  type: 'vacation',
  reason: 'Beach',
  status: 'pending',
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  unavailability_id: null,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const swapRow = (overrides: Record<string, unknown> = {}) => ({
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

const loanRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  from_org_unit_id: 1,
  to_org_unit_id: 2,
  start_date: '2026-05-10',
  end_date: '2026-05-15',
  reason: 'cover',
  status: 'pending',
  requested_by: 99,
  approver_user_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const pendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: null,
  shift_swap_request_id: null,
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

const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  shift_id: 10,
  user_id: 7,
  status: 'pending',
  assigned_at: '2026-04-25T12:00:00.000Z',
  confirmed_at: null,
  notes: null,
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  department_id: 3,
  name: 'Engineering',
  department_name: 'Engineering',
  ...overrides,
});

// ── TimeOffService ────────────────────────────────────────────────────────────

describe('TimeOffService — audit log', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = auditSpy();
  });
  afterEach(() => spy.mockRestore());

  it('create writes time_off.create audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // getWorkflowByChangeType -> not found (checked before insert)
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[timeOffRow({ id: 42 })], null] as Tuple); // getById

    const service = new TimeOffService(pool);
    await service.create({ userId: 7, startDate: '2026-05-10', endDate: '2026-05-15', type: 'vacation', reason: 'Beach' });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_off.create',
      entityType: 'time_off_request',
      entityId: 42,
      actorId: 7,
      justification: 'Beach',
    }));
  });

  it('reject writes time_off.reject audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([[timeOffRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[pendingApprovalRow({ status: 'rejected' })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE time_off_requests
      .mockResolvedValueOnce([[timeOffRow({ id: 1, status: 'rejected' })], null] as Tuple); // final getById

    const service = new TimeOffService(pool);
    await service.reject(1, 99, 'No cover');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_off.reject',
      entityType: 'time_off_request',
      entityId: 1,
      actorId: 99,
      justification: 'No cover',
    }));
  });

  it('cancel writes time_off.cancel audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[timeOffRow({ id: 1, status: 'cancelled' })], null] as Tuple);

    const service = new TimeOffService(pool);
    await service.cancel(1, 7);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_off.cancel',
      entityType: 'time_off_request',
      entityId: 1,
      actorId: 7,
    }));
  });

  it('approve writes time_off.approve audit', async () => {
    const { pool, execute, conn } = makeConnPool();
    execute
      .mockResolvedValueOnce([[timeOffRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // wouldBeFinalStep: getPendingApprovalById
      .mockResolvedValueOnce([[], null] as Tuple); // wouldBeFinalStep: next-step lookup -> none (final)
    conn.execute
      .mockResolvedValueOnce([[timeOffRow()], null] as Tuple) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability -> none
      .mockResolvedValueOnce([{ insertId: 555 }, null] as Tuple); // INSERT user_unavailability
    execute
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[pendingApprovalRow({ status: 'approved' })], null] as Tuple); // post-decision fetch
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple); // UPDATE time_off_requests
    execute.mockResolvedValueOnce([[timeOffRow({ status: 'approved', unavailability_id: 555 })], null] as Tuple); // final getById

    const service = new TimeOffService(pool);
    await service.approve(1, 99, 'OK');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_off.approve',
      entityType: 'time_off_request',
      entityId: 1,
      actorId: 99,
    }));
  });
});

// ── ShiftSwapService ──────────────────────────────────────────────────────────

describe('ShiftSwapService — audit log', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = auditSpy();
  });
  afterEach(() => spy.mockRestore());

  it('create writes shift_swap.create audit', async () => {
    const { pool, execute, conn } = makeConnPool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found (checked before insert)
    conn.execute
      .mockResolvedValueOnce([[{ id: 100, user_id: 7 }], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 200, user_id: 8 }], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple);
    execute.mockResolvedValueOnce([[swapRow({ id: 42 })], null] as Tuple); // getById

    const service = new ShiftSwapService(pool);
    await service.create({ requesterUserId: 7, requesterAssignmentId: 100, targetAssignmentId: 200 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shift_swap.create',
      entityType: 'shift_swap_request',
      entityId: 42,
      actorId: 7,
    }));
  });

  it('decline writes shift_swap.decline audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([[swapRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow({ shift_swap_request_id: 1 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[pendingApprovalRow({ shift_swap_request_id: 1, status: 'rejected' })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE shift_swap_requests
      .mockResolvedValueOnce([[swapRow({ id: 1, status: 'declined' })], null] as Tuple); // final getById

    const service = new ShiftSwapService(pool);
    await service.decline(1, 99, 'Not possible');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shift_swap.decline',
      entityType: 'shift_swap_request',
      entityId: 1,
      actorId: 99,
      justification: 'Not possible',
    }));
  });

  it('cancel writes shift_swap.cancel audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[swapRow({ id: 1, status: 'cancelled' })], null] as Tuple);

    const service = new ShiftSwapService(pool);
    await service.cancel(1, 7);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shift_swap.cancel',
      entityType: 'shift_swap_request',
      entityId: 1,
      actorId: 7,
    }));
  });
});

// ── EmployeeLoanService ───────────────────────────────────────────────────────

describe('EmployeeLoanService — audit log', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = auditSpy();
  });
  afterEach(() => spy.mockRestore());

  it('cancel writes loan.cancel audit', async () => {
    const { pool, execute } = makeSimplePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[loanRow({ id: 1, status: 'cancelled' })], null] as Tuple);

    const service = new EmployeeLoanService(pool);
    await service.cancel(1, 99);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'loan.cancel',
      entityType: 'employee_loan',
      entityId: 1,
      actorId: 99,
    }));
  });
});

// ── AssignmentService ─────────────────────────────────────────────────────────

describe('AssignmentService — audit log', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = auditSpy();
    (Compliance.evaluateAssignmentCompliance as jest.Mock).mockResolvedValue({ ok: true, violations: [] });
  });
  afterEach(() => spy.mockRestore());

  it('deleteAssignment writes assignment.delete audit', async () => {
    const { pool, execute, conn } = makeConnPool();
    // getAssignmentById (snapshot)
    execute.mockResolvedValueOnce([[assignmentRow()], null] as Tuple);
    // DELETE inside transaction
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    const service = new AssignmentService(pool);
    await service.deleteAssignment(1, 5, 'Wrong shift');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assignment.delete',
      entityType: 'shift_assignment',
      entityId: 1,
      actorId: 5,
      justification: 'Wrong shift',
    }));
  });

  it('updateAssignment writes assignment.update audit', async () => {
    const { pool, execute } = makeConnPool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)           // getAssignmentById initial
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)         // UPDATE
      .mockResolvedValueOnce([[assignmentRow({ status: 'confirmed' })], null] as Tuple); // getAssignmentById refresh

    const service = new AssignmentService(pool);
    await service.updateAssignment(1, { status: 'confirmed', actorId: 5, reason: 'Manual confirm' });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assignment.update',
      entityType: 'shift_assignment',
      entityId: 1,
      actorId: 5,
      justification: 'Manual confirm',
    }));
  });

  it('createAssignment writes assignment.create audit with justification', async () => {
    const { pool, execute, conn } = makeConnPool();
    // shift lookup + user lookup + required skills + INSERT (all inside transaction via conn)
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', max_staff: 5, current_assignments: 2, department_id: 3, schedule_id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)  // required skills
      .mockResolvedValueOnce([{ insertId: 55 }, null] as Tuple);
    // getAssignmentById after commit (pool.execute)
    execute.mockResolvedValueOnce([[assignmentRow({ id: 55 })], null] as Tuple);

    const service = new AssignmentService(pool);
    await service.createAssignment({ shiftId: 10, userId: 7, actorId: 3, reason: 'Urgent coverage' });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assignment.create',
      entityType: 'shift_assignment',
      entityId: 55,
      actorId: 3,
      justification: 'Urgent coverage',
    }));
  });
});
