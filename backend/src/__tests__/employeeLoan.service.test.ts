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
