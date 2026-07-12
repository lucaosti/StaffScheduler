/**
 * Consolidated extended coverage for several smaller services that
 * are still below the 90% target after dedicated test files:
 *   - EmployeeService
 *   - OnCallService
 *   - ShiftSwapService
 *
 * @author Luca Ostinelli
 */

import { EmployeeService } from '../services/EmployeeService';
import { OnCallService } from '../services/OnCallService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { NotificationService } from '../services/NotificationService';

const noopNotifications = { notifyAsync: () => {} } as unknown as NotificationService;

jest.mock('../services/UserService', () => {
  const actual = jest.requireActual('../services/UserService');
  return { ...actual };
});

jest.mock('../services/ComplianceEngine', () => ({
  evaluateAssignmentCompliance: jest.fn(),
}));

const { evaluateAssignmentCompliance } = jest.requireMock('../services/ComplianceEngine');

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

// -------- EmployeeService -----------

describe('EmployeeService', () => {
  const employee = {
    id: 1,
    email: 'a@b',
    first_name: 'A',
    last_name: 'B',
    role: 'employee',
    employee_id: 'E',
    phone: null,
    is_active: 1,
    last_login: null,
    created_at: 't',
    updated_at: 't',
  };

  it('getAllEmployees forwards filters and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[employee], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    expect(
      (await svc.getAllEmployees({ departmentId: 3, isActive: true, search: 's' })).length
    ).toBe(1);
    await expect(svc.getAllEmployees()).rejects.toThrow(/boom/);
  });

  it('getEmployeeById returns the user, null when missing, and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[employee], null] as Tuple) // getUserById #1: user row
      .mockResolvedValueOnce([[], null] as Tuple) // departments
      .mockResolvedValueOnce([[], null] as Tuple) // skills
      .mockResolvedValueOnce([[], null] as Tuple) // getUserById #2: no user -> null
      .mockRejectedValueOnce(new Error('boom')); // getUserById #3: throws
    const svc = new EmployeeService(pool);
    expect((await svc.getEmployeeById(1))?.id).toBe(1);
    expect(await svc.getEmployeeById(1)).toBeNull();
    await expect(svc.getEmployeeById(1)).rejects.toThrow(/boom/);
  });

  it('getEmployeesByDepartment forwards + bubbles', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[employee], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    expect((await svc.getEmployeesByDepartment(3)).length).toBe(1);
    await expect(svc.getEmployeesByDepartment(3)).rejects.toThrow(/boom/);
  });

  it('getEmployeeStatistics aggregates active/inactive from user stats', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 10 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 8 }], null] as Tuple)
      .mockResolvedValueOnce([[{ role: 'Employee', count: 10 }], null] as Tuple);
    const svc = new EmployeeService(pool);
    const s = await svc.getEmployeeStatistics();
    expect(s.total).toBe(10);
    expect(s.active).toBe(8);
    expect(s.inactive).toBe(2);
  });

  it('getEmployeeStatistics propagates errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    await expect(svc.getEmployeeStatistics()).rejects.toThrow(/boom/);
  });

  it('createEmployee delegates to createUser and bubbles', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    await expect(
      svc.createEmployee({ email: 'a@b', password: 'p', firstName: 'A', lastName: 'B' })
    ).rejects.toThrow(/boom/);
  });

  it('updateEmployee throws when not employee, otherwise delegates', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // getUserById empty
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new EmployeeService(pool);
    await expect(svc.updateEmployee(1, { firstName: 'X' })).rejects.toThrow(/Employee not found/);
  });

  it('deleteEmployee throws when not employee', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new EmployeeService(pool);
    await expect(svc.deleteEmployee(1)).rejects.toThrow(/Employee not found/);
  });

  it('getEmployeeSkills returns rows + bubbles', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, name: 'CPR' }], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    expect((await svc.getEmployeeSkills(1)).length).toBe(1);
    await expect(svc.getEmployeeSkills(1)).rejects.toThrow(/boom/);
  });

  it('addEmployeeSkill / removeEmployeeSkill happy + error', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom2'));
    const svc = new EmployeeService(pool);
    await svc.addEmployeeSkill(1, 2, 3);
    await svc.removeEmployeeSkill(1, 2);
    await expect(svc.addEmployeeSkill(1, 2)).rejects.toThrow(/boom/);
    await expect(svc.removeEmployeeSkill(1, 2)).rejects.toThrow(/boom2/);
  });
});

// -------- OnCallService -----------

describe('OnCallService', () => {
  const periodRow = {
    id: 1,
    schedule_id: null,
    department_id: 3,
    department_name: 'X',
    date: '2026-05-10',
    start_time: '20:00',
    end_time: '08:00',
    min_staff: 1,
    max_staff: 2,
    notes: null,
    status: 'open',
    assigned_count: 0,
    created_at: 't',
    updated_at: 't',
  };
  const valid = {
    departmentId: 3,
    date: '2026-05-10',
    startTime: '20:00',
    endTime: '08:00',
  };

  it('rejects invalid input + creates valid period', async () => {
    const { pool, execute } = makePool();
    const svc = new OnCallService(pool);
    await expect(svc.createPeriod({ ...valid, minStaff: 0 })).rejects.toThrow(/minStaff/);
    await expect(svc.createPeriod({ ...valid, minStaff: 3, maxStaff: 1 })).rejects.toThrow(
      /maxStaff/
    );
    await expect(svc.createPeriod({ ...valid, date: 'bad' })).rejects.toThrow(/Invalid date/);
    await expect(svc.createPeriod({ ...valid, startTime: 'bad' })).rejects.toThrow(
      /Invalid startTime/
    );
    await expect(svc.createPeriod({ ...valid, endTime: 'bad' })).rejects.toThrow(/Invalid endTime/);

    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[periodRow], null] as Tuple);
    expect((await svc.createPeriod(valid)).id).toBe(1);
  });

  it('createPeriod throws when post-insert fetch is empty', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OnCallService(pool);
    await expect(svc.createPeriod(valid)).rejects.toThrow(/Failed to retrieve created/);
  });

  it('listPeriods all filters + getPeriodById null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[periodRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OnCallService(pool);
    expect(
      (
        await svc.listPeriods({
          departmentId: 3,
          status: 'open',
          rangeStart: '2026-05-01',
          rangeEnd: '2026-05-31',
        })
      ).length
    ).toBe(1);
    expect(await svc.getPeriodById(99)).toBeNull();
  });

  it('updatePeriod no-fields returns existing or throws', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[periodRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OnCallService(pool);
    expect((await svc.updatePeriod(1, {})).id).toBe(1);
    await expect(svc.updatePeriod(1, {})).rejects.toThrow(/On-call period not found/);
  });

  it('updatePeriod runs UPDATE and refetches; throws on missing rows', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[periodRow], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OnCallService(pool);
    expect(
      (
        await svc.updatePeriod(1, {
          date: 'd',
          startTime: 's',
          endTime: 'e',
          minStaff: 1,
          maxStaff: 2,
          notes: 'n',
          status: 'open',
        })
      ).id
    ).toBe(1);
    await expect(svc.updatePeriod(1, { date: 'd' })).rejects.toThrow(/On-call period not found/);
    await expect(svc.updatePeriod(1, { date: 'd' })).rejects.toThrow(
      /On-call period not found after update/
    );
  });

  it('deletePeriod returns true / throws when missing', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    const svc = new OnCallService(pool);
    expect(await svc.deletePeriod(1)).toBe(true);
    await expect(svc.deletePeriod(1)).rejects.toThrow(/not found/);
  });

  it('assign throws when missing period, full capacity, and runs happy path', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new OnCallService(pool);
    await expect(svc.assign(1, 2, 3)).rejects.toThrow(/On-call period not found/);

    conn.execute.mockResolvedValueOnce([[{ id: 1, max_staff: 0, assigned_count: 0 }], null]);
    await expect(svc.assign(1, 2, 3)).rejects.toThrow(/max capacity/);

    conn.execute
      .mockResolvedValueOnce([[{ id: 1, max_staff: 5, assigned_count: 0 }], null])
      .mockResolvedValueOnce([{ insertId: 9 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([
      [
        {
          id: 9,
          period_id: 1,
          user_id: 2,
          status: 'pending',
          assigned_at: 't',
          assigned_by: 3,
          notes: null,
        },
      ],
      null,
    ] as Tuple);
    const out = await svc.assign(1, 2, 3, null);
    expect(out.id).toBe(9);
  });

  it('unassign returns boolean based on affected rows', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    const svc = new OnCallService(pool);
    expect(await svc.unassign(1, 2)).toBe(true);
    expect(await svc.unassign(1, 2)).toBe(false);
  });

  it('listAssignments + listForUser map rows', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            period_id: 1,
            user_id: 2,
            status: 'pending',
            assigned_at: 't',
            assigned_by: 3,
            notes: null,
          },
        ],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ ...periodRow, a_status: 'pending' }], null] as Tuple);
    const svc = new OnCallService(pool);
    expect((await svc.listAssignments(1)).length).toBe(1);
    expect(
      (
        await svc.listForUser(2, {
          rangeStart: '2026-05-01',
          rangeEnd: '2026-05-31',
        })
      )[0].assignmentStatus
    ).toBe('pending');
  });
});

// -------- ShiftSwapService -----------

describe('ShiftSwapService', () => {
  const swap = {
    id: 1,
    requester_user_id: 1,
    requester_assignment_id: 10,
    target_user_id: 2,
    target_assignment_id: 20,
    status: 'pending',
    notes: null,
    reviewer_id: null,
    reviewed_at: null,
    review_notes: null,
    created_at: 't',
    updated_at: 't',
  };

  beforeEach(() => {
    (evaluateAssignmentCompliance as jest.Mock).mockReset();
  });

  const pendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
    id: 501,
    change_request_id: null,
    time_off_request_id: null,
    employee_loan_id: null,
    shift_swap_request_id: 1,
    workflow_id: 10,
    step_id: 20,
    step_order: 1,
    assigned_to_user_id: 9,
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

  /** Queues the pool.execute calls `approve()` makes before it ever opens a
   *  transaction: getById, findPendingApprovalId, the upfront
   *  wouldBeFinalStep check (getPendingApprovalById + next-step lookup). */
  const queueApprovePreChecks = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([[swap], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // wouldBeFinalStep: getPendingApprovalById
      .mockResolvedValueOnce([[], null] as Tuple); // wouldBeFinalStep: next-step lookup -> none (final)
  };

  /** Queues the conn.execute calls the transaction makes for the swap-row
   *  lock, the assignment lock, and checkSwapCompliance's pair read — for
   *  tests where a bad pair (gone/reassigned) throws right after, so the
   *  duplicate-assignment check and beyond are never reached. Pass
   *  `includeDupCheck: true` when the pair itself is fine and the test
   *  expects to fail later, at the evaluateAssignmentCompliance mock. */
  const queueTransactionChecksOnly = (
    conn: { execute: jest.Mock },
    pairRows: unknown[],
    includeDupCheck = false
  ) => {
    conn.execute
      .mockResolvedValueOnce([[swap], null]) // SELECT swap FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([pairRows, null]); // checkSwapCompliance: pair read
    if (includeDupCheck) {
      conn.execute.mockResolvedValueOnce([[], null]); // checkSwapCompliance: duplicate-assignment check -> none
    }
  };

  /** Queues the conn.execute calls the transaction makes up through a
   *  successful checkSwapCompliance (pair read + duplicate check -> none)
   *  and the two assignment UPDATEs, plus the pool.execute calls
   *  ApprovalEngineService.decidePendingApproval makes once that succeeds:
   *  getPendingApprovalById(pre) + guarded UPDATE + (approved only)
   *  next-step lookup + getPendingApprovalById(post). */
  const queueApproveTransactionAndDecide = (
    conn: { execute: jest.Mock },
    execute: jest.Mock,
    pairRows: unknown[],
    decision: 'approved' | 'rejected' = 'approved'
  ) => {
    conn.execute
      .mockResolvedValueOnce([[swap], null]) // SELECT swap FOR UPDATE
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([pairRows, null]) // checkSwapCompliance: pair read
      .mockResolvedValueOnce([[], null]) // checkSwapCompliance: duplicate-assignment check -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE assignment (requester)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE assignment (target)
    execute
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple); // guarded UPDATE
    if (decision === 'approved') {
      execute.mockResolvedValueOnce([[], null] as Tuple); // next-step lookup -> none
    }
    execute.mockResolvedValueOnce([[pendingApprovalRow({ status: decision })], null] as Tuple); // post-decision fetch
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE shift_swap_requests
  };

  it('create rejects when requester assignment missing', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found (checked before insert)
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/Requester assignment not found/);
  });

  it('create rejects when requester does not own the assignment', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found
    conn.execute.mockResolvedValueOnce([[{ id: 10, user_id: 99 }], null]);
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/does not own/);
  });

  it('create rejects when target assignment missing or same user', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/Target assignment not found/);

    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 1 }], null]);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/different user/);
  });

  it('create happy path', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found (checked before insert)
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 2 }], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute
      .mockResolvedValueOnce([[swap], null] as Tuple) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null] as Tuple); // audit.write
    const svc = new ShiftSwapService(pool, noopNotifications);
    const out = await svc.create({
      requesterUserId: 1,
      requesterAssignmentId: 10,
      targetAssignmentId: 20,
      notes: 'pls',
    });
    expect(out.id).toBe(1);
  });

  it('create throws when post-commit fetch is empty', async () => {
    const { pool, conn, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType -> not found (checked before insert)
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 2 }], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple); // getById -> empty
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/Failed to retrieve created swap/);
  });

  it('list applies filters and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[swap], null] as Tuple)
      .mockResolvedValueOnce([[swap], null] as Tuple)
      .mockResolvedValueOnce([[swap], null] as Tuple);
    const svc = new ShiftSwapService(pool, noopNotifications);
    expect((await svc.list()).length).toBe(1);
    expect((await svc.list({ userId: 1 })).length).toBe(1);
    expect((await svc.list({ userId: 1, status: 'pending' })).length).toBe(1);
  });

  it('approve rolls back when not pending', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null] as Tuple); // getById
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(svc.approve(1, 9)).rejects.toThrow(/Cannot approve swap/);
  });

  it('approve fails when assignments are gone', async () => {
    const { pool, conn, execute } = makePool();
    queueApprovePreChecks(execute);
    // checkSwapCompliance's pair read happens inside the transaction now —
    // a single row means "gone" is caught there, before any assignment
    // UPDATE or decidePendingApproval call.
    queueTransactionChecksOnly(conn, [
      { assignment_id: 10, user_id: 1, date: '2026-05-10', start_time: '08', end_time: '16' },
    ]);
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(svc.approve(1, 9)).rejects.toThrow(/One or both assignments are gone/);
  });

  it('approve rejects when compliance fails for either side', async () => {
    const { pool, conn, execute } = makePool();
    const pair = [
      { assignment_id: 10, user_id: 1, date: '2026-05-10', start_time: '08', end_time: '16' },
      { assignment_id: 20, user_id: 2, date: '2026-05-11', start_time: '08', end_time: '16' },
    ];
    // Both cases are caught inside the transaction, before decidePendingApproval
    // or any assignment UPDATE is ever reached.
    queueApprovePreChecks(execute);
    queueTransactionChecksOnly(conn, pair, true);
    (evaluateAssignmentCompliance as jest.Mock).mockResolvedValueOnce({
      ok: false,
      violations: [{ code: 'OVER_HOURS' }],
    });
    const svc = new ShiftSwapService(pool, noopNotifications);
    await expect(svc.approve(1, 9)).rejects.toThrow(/Requester would violate/);

    queueApprovePreChecks(execute);
    queueTransactionChecksOnly(conn, pair, true);
    (evaluateAssignmentCompliance as jest.Mock)
      .mockResolvedValueOnce({ ok: true, violations: [] })
      .mockResolvedValueOnce({ ok: false, violations: [{ code: 'REST_BREAK' }] });
    await expect(svc.approve(1, 9)).rejects.toThrow(/Target would violate/);
  });

  it('approve happy path swaps user_ids and refetches', async () => {
    const { pool, conn, execute } = makePool();
    const pair = [
      {
        assignment_id: 10,
        user_id: 1,
        date: new Date('2026-05-10'),
        start_time: '08',
        end_time: '16',
      },
      {
        assignment_id: 20,
        user_id: 2,
        date: new Date('2026-05-11'),
        start_time: '08',
        end_time: '16',
      },
    ];
    queueApprovePreChecks(execute);
    queueApproveTransactionAndDecide(conn, execute, pair);
    (evaluateAssignmentCompliance as jest.Mock)
      .mockResolvedValueOnce({ ok: true, violations: [] }) // requester
      .mockResolvedValueOnce({ ok: true, violations: [] }); // target
    execute.mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null] as Tuple);
    const svc = new ShiftSwapService(pool, noopNotifications);
    const out = await svc.approve(1, 9, 'OK');
    expect(out.status).toBe('approved');
  });

  it('decline happy path, not-found, and already-decided branches', async () => {
    const { pool, execute } = makePool();
    // decline(1, 9, 'no') — happy path: getById, findPendingApprovalId, decide
    // (pre-fetch, guarded UPDATE, post-fetch — rejected short-circuits before
    // any next-step lookup), own UPDATE, final getById, audit.write.
    execute
      .mockResolvedValueOnce([[swap], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[pendingApprovalRow({ status: 'rejected' })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE shift_swap_requests
      .mockResolvedValueOnce([[{ ...swap, status: 'declined' }], null] as Tuple) // final getById
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple) // audit INSERT
      // decline(1, 9) — request no longer exists: getById returns nothing,
      // which now short-circuits before any pending_approval lookup.
      .mockResolvedValueOnce([[], null] as Tuple) // getById -> not found
      // decline(1, 9) — already decided: getById reports a non-pending status,
      // which now short-circuits immediately too.
      .mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null] as Tuple); // getById -> approved

    const svc = new ShiftSwapService(pool, noopNotifications);
    expect((await svc.decline(1, 9, 'no')).status).toBe('declined');
    await expect(svc.decline(1, 9)).rejects.toThrow(/not found/);
    await expect(svc.decline(1, 9)).rejects.toThrow(/Cannot decline swap/);
  });

  it('cancel covers happy/forbidden/missing/already-decided branches', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'cancelled' }], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 2 }, null] as Tuple) // audit INSERT for cancel#1
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, requester_user_id: 999 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'declined' }], null] as Tuple);
    const svc = new ShiftSwapService(pool, noopNotifications);
    expect((await svc.cancel(1, 1)).status).toBe('cancelled');
    await expect(svc.cancel(1, 1)).rejects.toThrow(/not found/);
    await expect(svc.cancel(1, 1)).rejects.toThrow(/Forbidden/);
    await expect(svc.cancel(1, 1)).rejects.toThrow(/Cannot cancel swap/);
  });
});
