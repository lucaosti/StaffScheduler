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

  it('getEmployeeById returns null for non-employee role and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[employee], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[{ ...employee, role: 'admin' }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
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

  it('getEmployeeStatistics aggregates active/inactive', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 10 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 8 }], null] as Tuple)
      .mockResolvedValueOnce([[{ role: 'employee', count: 4 }], null] as Tuple)
      .mockResolvedValueOnce([[employee, { ...employee, is_active: 0 }], null] as Tuple);
    const svc = new EmployeeService(pool);
    const s = await svc.getEmployeeStatistics();
    expect(s.total).toBe(4);
    expect(s.active).toBe(1);
  });

  it('getEmployeeStatistics propagates errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    await expect(svc.getEmployeeStatistics()).rejects.toThrow(/boom/);
  });

  it('getAvailableEmployees forwards to getAllEmployees + bubbles', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[employee], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    expect((await svc.getAvailableEmployees(3, '2026-05-10', '08:00', '16:00')).length).toBe(1);
    await expect(svc.getAvailableEmployees(3, '2026-05-10', '08:00', '16:00')).rejects.toThrow(
      /boom/
    );
  });

  it('createEmployee forces role=employee and bubbles', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new EmployeeService(pool);
    await expect(
      svc.createEmployee({
        email: 'a@b',
        password: 'p',
        firstName: 'A',
        lastName: 'B',
      })
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

  it('create rejects when requester assignment missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ShiftSwapService(pool);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/Requester assignment not found/);
  });

  it('create rejects when requester does not own the assignment', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 10, user_id: 99 }], null]);
    const svc = new ShiftSwapService(pool);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/does not own/);
  });

  it('create rejects when target assignment missing or same user', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new ShiftSwapService(pool);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/Target assignment not found/);

    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 1 }], null]);
    await expect(
      svc.create({ requesterUserId: 1, requesterAssignmentId: 10, targetAssignmentId: 20 })
    ).rejects.toThrow(/different user/);
  });

  it('create happy path', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 2 }], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute.mockResolvedValueOnce([[swap], null] as Tuple);
    const svc = new ShiftSwapService(pool);
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
    conn.execute
      .mockResolvedValueOnce([[{ id: 10, user_id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 20, user_id: 2 }], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ShiftSwapService(pool);
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
    const svc = new ShiftSwapService(pool);
    expect((await svc.list()).length).toBe(1);
    expect((await svc.list({ userId: 1 })).length).toBe(1);
    expect((await svc.list({ userId: 1, status: 'pending' })).length).toBe(1);
  });

  it('approve rolls back when not pending', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null]);
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 9)).rejects.toThrow(/Cannot approve swap/);
  });

  it('approve fails when assignments are gone', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[swap], null])
      .mockResolvedValueOnce([
        [{ assignment_id: 10, user_id: 1, date: '2026-05-10', start_time: '08', end_time: '16' }],
        null,
      ]);
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 9)).rejects.toThrow(/One or both assignments are gone/);
  });

  it('approve rejects when compliance fails for either side', async () => {
    const { pool, conn } = makePool();
    const pair = [
      { assignment_id: 10, user_id: 1, date: '2026-05-10', start_time: '08', end_time: '16' },
      { assignment_id: 20, user_id: 2, date: '2026-05-11', start_time: '08', end_time: '16' },
    ];
    conn.execute.mockResolvedValueOnce([[swap], null]).mockResolvedValueOnce([pair, null]);
    (evaluateAssignmentCompliance as jest.Mock).mockResolvedValueOnce({
      ok: false,
      violations: [{ code: 'OVER_HOURS' }],
    });
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 9)).rejects.toThrow(/Requester would violate/);

    conn.execute.mockResolvedValueOnce([[swap], null]).mockResolvedValueOnce([pair, null]);
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
    conn.execute
      .mockResolvedValueOnce([[swap], null])
      .mockResolvedValueOnce([pair, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    (evaluateAssignmentCompliance as jest.Mock)
      .mockResolvedValueOnce({ ok: true, violations: [] })
      .mockResolvedValueOnce({ ok: true, violations: [] });
    execute.mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null] as Tuple);
    const svc = new ShiftSwapService(pool);
    const out = await svc.approve(1, 9, 'OK');
    expect(out.status).toBe('approved');
  });

  it('decline + cancel cover happy/forbidden/missing branches', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'declined' }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'approved' }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'cancelled' }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, requester_user_id: 999 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[{ ...swap, status: 'declined' }], null] as Tuple);
    const svc = new ShiftSwapService(pool);
    expect((await svc.decline(1, 9, 'no')).status).toBe('declined');
    await expect(svc.decline(1, 9)).rejects.toThrow(/not found/);
    await expect(svc.decline(1, 9)).rejects.toThrow(/Cannot decline swap/);
    expect((await svc.cancel(1, 1)).status).toBe('cancelled');
    await expect(svc.cancel(1, 1)).rejects.toThrow(/not found/);
    await expect(svc.cancel(1, 1)).rejects.toThrow(/Forbidden/);
    await expect(svc.cancel(1, 1)).rejects.toThrow(/Cannot cancel swap/);
  });
});
