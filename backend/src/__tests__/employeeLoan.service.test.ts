/**
 * EmployeeLoanService unit tests.
 *
 * The service composes ApprovalMatrixService + NotificationService so the
 * mock pool needs to satisfy queries from all three.
 */

import { EmployeeLoanService } from '../services/EmployeeLoanService';

type Tuple = [unknown, unknown];

const matrixRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_type: 'Loan.Request',
  approver_scope: 'unit_manager',
  approver_role: null,
  approver_user_id: null,
  auto_approve_for_owner: 1,
  description: '',
  ...overrides,
});

const unitRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  manager_user_id: 99,
  parent_id: null,
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
  approver_user_id: 99,
  reviewed_at: null,
  review_notes: null,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

describe('EmployeeLoanService.create', () => {
  it('rejects when start/end are inverted', async () => {
    const { pool } = makePool();
    const service = new EmployeeLoanService(pool);
    await expect(
      service.create({
        userId: 7,
        fromOrgUnitId: 1,
        toOrgUnitId: 2,
        startDate: '2026-05-15',
        endDate: '2026-05-10',
        requestedBy: 99,
      })
    ).rejects.toThrow(/endDate must be on or after/);
  });

  it('auto-approves when actor is the receiving unit manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple) // approval matrix lookup
      .mockResolvedValueOnce([[unitRow({ id: 2, manager_user_id: 99 })], null] as Tuple) // unit_manager lookup
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple) // INSERT loan
      .mockResolvedValueOnce([[loanRow({ id: 42, status: 'approved' })], null] as Tuple) // SELECT created
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple) // audit INSERT for loan.create
      .mockResolvedValueOnce([
        [
          unitRow({ id: 1, manager_user_id: 50 }),
          unitRow({ id: 2, manager_user_id: 99 }),
        ],
        null,
      ] as Tuple) // managers fan-out
      // notifications.notify -> insert + select for each manager
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [{ id: 1, user_id: 50, type: 'loan.created.auto-approved', title: 't', body: null, link: null, is_read: 0, created_at: 'x', read_at: null }],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([{ insertId: 2 }, null] as Tuple)
      .mockResolvedValueOnce([
        [{ id: 2, user_id: 99, type: 'loan.created.auto-approved', title: 't', body: null, link: null, is_read: 0, created_at: 'x', read_at: null }],
        null,
      ] as Tuple);

    const service = new EmployeeLoanService(pool);
    const created = await service.create({
      userId: 7,
      fromOrgUnitId: 1,
      toOrgUnitId: 2,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      requestedBy: 99,
    });
    expect(created.status).toBe('approved');
    expect(execute.mock.calls[2][0]).toMatch(/INSERT INTO employee_loans/);
  });
});

describe('EmployeeLoanService.isOnLoan', () => {
  it('returns true when an approved loan covers the date', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 1 }], null] as Tuple);
    const service = new EmployeeLoanService(pool);
    const ok = await service.isOnLoan(7, 2, '2026-05-12');
    expect(ok).toBe(true);
  });

  it('returns false otherwise', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 0 }], null] as Tuple);
    const service = new EmployeeLoanService(pool);
    const ok = await service.isOnLoan(7, 2, '2026-05-12');
    expect(ok).toBe(false);
  });
});

// ── Workflow attachment and decision arms (engine/matrix spied) ──────────────
// Same instance-boundary spying as the time-off and shift-swap suites: the
// matrix and engine have their own suites, so these tests pin only the loan
// service's orchestration decisions.

const internalsOf = (service: EmployeeLoanService) =>
  service as unknown as {
    engine: {
      getWorkflowByChangeType: (t: string) => unknown;
      canCreatePendingApprovalForStep: (s: unknown, c: unknown) => unknown;
      createPendingApprovalForStep: (w: number, s: unknown, l: unknown, c: unknown) => unknown;
      decidePendingApproval: (...a: unknown[]) => unknown;
    };
    approvals: { resolve: (t: string, c: unknown) => unknown };
  };

const loanWorkflow = {
  id: 10,
  changeType: 'Loan.Request',
  requireAll: false,
  description: null,
  steps: [{ id: 20, workflowId: 10, stepOrder: 1, approverScope: 'unit_structure' }],
};

const spyLoanCreation = (service: EmployeeLoanService) => {
  const internals = internalsOf(service);
  jest
    .spyOn(internals.approvals, 'resolve')
    .mockResolvedValue({ autoApprove: false, approverUserId: 99 } as never);
  jest.spyOn(internals.engine, 'getWorkflowByChangeType').mockResolvedValue(loanWorkflow as never);
  jest.spyOn(internals.engine, 'canCreatePendingApprovalForStep').mockResolvedValue(true as never);
  return internals;
};

describe('EmployeeLoanService.create — workflow attachment', () => {
  const queueCreate = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null]) // INSERT employee_loans
      .mockResolvedValueOnce([[loanRow({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // audit
      // fanOutNotifications unit lookup + notification inserts fall through
      // to a permissive default.
      .mockResolvedValue([[], null]);
  };

  it('refuses upfront when the first step cannot resolve an approver', async () => {
    const { pool } = makePool();
    const service = new EmployeeLoanService(pool);
    const internals = spyLoanCreation(service);
    (internals.engine.canCreatePendingApprovalForStep as jest.Mock).mockResolvedValue(false);

    await expect(
      service.create({ userId: 7, fromOrgUnitId: 1, toOrgUnitId: 2, startDate: '2026-05-10', endDate: '2026-05-15', requestedBy: 5 })
    ).rejects.toThrow(/target organizational unit has no manager/);
  });

  it('attaches the first-step pending approval', async () => {
    const { pool, execute } = makePool();
    queueCreate(execute);
    const service = new EmployeeLoanService(pool);
    const internals = spyLoanCreation(service);
    const createPa = jest
      .spyOn(internals.engine, 'createPendingApprovalForStep')
      .mockResolvedValue({ id: 501 } as never);

    const created = await service.create({
      userId: 7, fromOrgUnitId: 1, toOrgUnitId: 2,
      startDate: '2026-05-10', endDate: '2026-05-15', requestedBy: 5,
    });

    expect(created.id).toBe(42);
    expect(createPa).toHaveBeenCalledWith(
      10,
      loanWorkflow.steps[0],
      { employeeLoanId: 42 },
      { actorUserId: 5, orgUnitId: 2 }
    );
  });

  it('deletes the stranded loan when approver resolution changes mid-flight', async () => {
    const { pool, execute } = makePool();
    queueCreate(execute); // the permissive default also serves the cleanup DELETE
    const service = new EmployeeLoanService(pool);
    const internals = spyLoanCreation(service);
    jest.spyOn(internals.engine, 'createPendingApprovalForStep').mockResolvedValue(null as never);

    await expect(
      service.create({ userId: 7, fromOrgUnitId: 1, toOrgUnitId: 2, startDate: '2026-05-10', endDate: '2026-05-15', requestedBy: 5 })
    ).rejects.toThrow(/approver resolution changed during creation/);

    const deleteCall = execute.mock.calls.find((c) => String(c[0]).includes('DELETE FROM employee_loans'));
    expect(deleteCall?.[1]).toEqual([42]);
  });
});

describe('EmployeeLoanService.approve/reject — decision arms', () => {
  const spyDecide = (service: EmployeeLoanService, result: unknown) =>
    jest
      .spyOn(internalsOf(service).engine, 'decidePendingApproval')
      .mockImplementation(async (...args: unknown[]) => {
        const ctx = await (args[4] as () => Promise<{ orgUnitId: number }>)();
        expect(ctx.orgUnitId).toBe(2); // decisions are scoped to the receiving unit
        return result as never;
      });

  it('approve refuses when no pending approval row exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null]) // getById
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId

    await expect(new EmployeeLoanService(pool).approve(1, 99)).rejects.toThrow(
      'No pending approval found for this loan'
    );
  });

  it('approve returns after a non-final decision without touching the loan row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([[loanRow()], null]); // refresh

    const service = new EmployeeLoanService(pool);
    spyDecide(service, { isFinalStep: false });

    const result = await service.approve(1, 99);
    expect(result.status).toBe('pending');
    const updates = execute.mock.calls.filter((c) => String(c[0]).includes('UPDATE employee_loans'));
    expect(updates).toHaveLength(0);
  });

  it('approve diagnoses a concurrent decision on the final step', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // guarded UPDATE misses

    const service = new EmployeeLoanService(pool);
    spyDecide(service, { isFinalStep: true });

    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve loan in status 'pending'/);
  });

  it('approve throws when the refreshed loan cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE
      .mockResolvedValueOnce([[], null]); // refresh gone

    const service = new EmployeeLoanService(pool);
    spyDecide(service, { isFinalStep: true });

    await expect(service.approve(1, 99)).rejects.toThrow('Failed to refresh loan');
  });

  it('reject records the decision and diagnoses a concurrent change', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // guarded UPDATE misses

    const service = new EmployeeLoanService(pool);
    spyDecide(service, undefined);

    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject loan in status 'pending'/);
  });

  it('reject succeeds end to end', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // guarded UPDATE
      .mockResolvedValueOnce([[loanRow({ status: 'rejected' })], null]) // refresh
      .mockResolvedValueOnce([{ insertId: 1 }, null]); // audit

    const service = new EmployeeLoanService(pool);
    spyDecide(service, undefined);

    const rejected = await service.reject(1, 99, 'not needed');
    expect(rejected.status).toBe('rejected');
  });
});
