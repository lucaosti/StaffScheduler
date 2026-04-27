/**
 * Extended AssignmentService coverage targeting:
 *   - createAssignment guards (missing shift, capacity, missing user,
 *     conflicts, availability, missing skills, compliance, policy)
 *   - getAllAssignments / getAssignmentById row mapping
 *   - statistics math
 *   - bulk create branches (array vs shiftId+userIds)
 *   - update / decline / complete and read paths
 *
 * @author Luca Ostinelli
 */

import { AssignmentService } from '../services/AssignmentService';

jest.mock('../services/ComplianceEngine', () => ({
  __esModule: true,
  evaluateAssignmentCompliance: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
}));

jest.mock('../services/PolicyValidator', () => ({
  __esModule: true,
  PolicyValidator: jest.fn().mockImplementation(() => ({
    validateAssignment: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
  })),
}));

import { evaluateAssignmentCompliance } from '../services/ComplianceEngine';
import { PolicyValidator } from '../services/PolicyValidator';

type Tuple = [unknown, unknown];

const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  shift_id: 10,
  user_id: 7,
  status: 'pending',
  notes: null,
  assigned_at: 't',
  confirmed_at: null,
  first_name: 'A',
  last_name: 'B',
  email: 'a@b',
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  department_id: 1,
  schedule_id: 9,
  department_name: 'Dept',
  ...overrides,
});

const shiftRow = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  department_id: 1,
  max_staff: 5,
  current_assignments: 0,
  ...overrides,
});

const makePool = () => {
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

beforeEach(() => {
  jest.clearAllMocks();
  (evaluateAssignmentCompliance as jest.Mock).mockResolvedValue({ ok: true, violations: [] });
  (PolicyValidator as jest.Mock).mockImplementation(() => ({
    validateAssignment: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
  }));
});

describe('AssignmentService.createAssignment guards', () => {
  it('throws when shift not found', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 1, userId: 7 } as never)).rejects.toThrow(
      /Shift not found/
    );
  });

  it('throws when shift is full', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([
      [shiftRow({ current_assignments: 5, max_staff: 5 })],
      null,
    ]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /maximum capacity/
    );
  });

  it('throws when user inactive/missing', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /User not found/
    );
  });

  it('throws on conflicting assignment', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null]) // shift
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null]); // user
    execute.mockResolvedValueOnce([
      [
        {
          id: 1,
          shift_date: '2026-05-01',
          start_time: '08:00',
          end_time: '16:00',
          department_name: 'D',
        },
      ],
      null,
    ]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /conflicting assignment/
    );
  });

  it('throws when user not available', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null]);
    execute
      .mockResolvedValueOnce([[], null]) // checkConflicts
      .mockResolvedValueOnce([[{ id: 99 }], null]); // availability hit
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /not available/
    );
  });

  it('throws when missing required skills', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null])
      .mockResolvedValueOnce([[{ skill_id: 1 }, { skill_id: 2 }], null]) // shift_skills
      .mockResolvedValueOnce([[{ skill_id: 1 }], null]); // user_skills (missing one)
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /required skills/
    );
  });

  it('rolls back on compliance violation', async () => {
    (evaluateAssignmentCompliance as jest.Mock).mockResolvedValueOnce({
      ok: false,
      violations: [{ code: 'REST', message: 'Insufficient rest' }],
    });
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null])
      .mockResolvedValueOnce([[], null]); // no required skills
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /Compliance violation/
    );
  });

  it('rolls back on policy violation', async () => {
    (PolicyValidator as jest.Mock).mockImplementationOnce(() => ({
      validateAssignment: jest.fn().mockResolvedValue({
        ok: false,
        violations: [
          {
            policyKey: 'manual_assignment_locked',
            message: 'Locked',
            hasApprovedException: false,
          },
        ],
      }),
    }));
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null])
      .mockResolvedValueOnce([[], null]);
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.createAssignment({ shiftId: 10, userId: 7 } as never)).rejects.toThrow(
      /Policy violation/
    );
  });

  it('inserts and returns assignment on success', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null]) // shift
      .mockResolvedValueOnce([[{ id: 7, role: 'employee' }], null]) // user
      .mockResolvedValueOnce([[], null]) // shift_skills empty
      .mockResolvedValueOnce([{ insertId: 42 }, null]); // INSERT
    execute
      .mockResolvedValueOnce([[], null]) // checkConflicts
      .mockResolvedValueOnce([[], null]) // checkAvailability
      .mockResolvedValueOnce([[assignmentRow({ id: 42 })], null]); // getAssignmentById
    const svc = new AssignmentService(pool);
    const r = await svc.createAssignment({ shiftId: 10, userId: 7 } as never);
    expect(r.id).toBe(42);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('AssignmentService read paths', () => {
  it('getAssignmentById maps the row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow()], null] as Tuple);
    const svc = new AssignmentService(pool);
    const r = await svc.getAssignmentById(1);
    expect(r?.userName).toBe('A B');
  });

  it('getAssignmentById bubbles DB error', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AssignmentService(pool);
    await expect(svc.getAssignmentById(1)).rejects.toThrow(/boom/);
  });

  it('getAllAssignments builds WHERE for every filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow()], null] as Tuple);
    const svc = new AssignmentService(pool);
    await svc.getAllAssignments({
      shiftId: 1,
      userId: 1,
      scheduleId: 1,
      departmentId: 1,
      status: 'pending',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/sa\.shift_id/);
    expect(sql).toMatch(/sa\.user_id/);
    expect(sql).toMatch(/s\.schedule_id/);
    expect(sql).toMatch(/s\.department_id/);
    expect(sql).toMatch(/sa\.status/);
    expect(sql).toMatch(/s\.date >= \?/);
    expect(sql).toMatch(/s\.date <= \?/);
  });

  it('getAllAssignments propagates errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AssignmentService(pool);
    await expect(svc.getAllAssignments({})).rejects.toThrow(/boom/);
  });

  it('getAssignmentsByUser/Shift/Department forward to getAllAssignments', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([[assignmentRow()], null] as Tuple);
    const svc = new AssignmentService(pool);
    expect((await svc.getAssignmentsByUser(7, 'pending')).length).toBe(1);
    expect((await svc.getAssignmentsByShift(10, 'pending')).length).toBe(1);
    expect((await svc.getAssignmentsByDepartment(1, 'pending')).length).toBe(1);
    expect((await svc.getAssignmentsByDepartment(1)).length).toBe(1);
  });

  it('getAssignmentsByDepartment bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('x'));
    const svc = new AssignmentService(pool);
    await expect(svc.getAssignmentsByDepartment(1)).rejects.toThrow(/x/);
  });
});

describe('AssignmentService.getAssignmentStatistics', () => {
  it('computes averages with non-zero employees', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ total: 10, unique_employees: 4, pending: 2, confirmed: 7, cancelled: 1 }],
      null,
    ] as Tuple);
    const svc = new AssignmentService(pool);
    const s = await svc.getAssignmentStatistics(1);
    expect(s.averageAssignmentsPerEmployee).toBe(2.5);
  });

  it('handles zero employees safely', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ total: 0, unique_employees: 0 }],
      null,
    ] as Tuple);
    const svc = new AssignmentService(pool);
    const s = await svc.getAssignmentStatistics(1);
    expect(s.averageAssignmentsPerEmployee).toBe(0);
  });

  it('bubbles DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AssignmentService(pool);
    await expect(svc.getAssignmentStatistics(1)).rejects.toThrow(/boom/);
  });
});

describe('AssignmentService.bulkCreateAssignments', () => {
  it('returns empty when called with empty array', async () => {
    const { pool } = makePool();
    const svc = new AssignmentService(pool);
    expect(await svc.bulkCreateAssignments([])).toEqual([]);
  });

  it('continues past failed rows', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValue([[], null]); // make every internal createAssignment fail
    const svc = new AssignmentService(pool);
    const r = await svc.bulkCreateAssignments([
      { shiftId: 1, userId: 7 } as never,
      { shiftId: 1, userId: 8 } as never,
    ]);
    expect(r).toEqual([]);
  });

  it('returns empty when shiftId provided without userIds', async () => {
    const { pool } = makePool();
    const svc = new AssignmentService(pool);
    expect(await svc.bulkCreateAssignments(1 as unknown as number)).toEqual([]);
    expect(await svc.bulkCreateAssignments(1 as unknown as number, [])).toEqual([]);
  });

  it('processes shiftId + userIds path', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValue([[], null]);
    const svc = new AssignmentService(pool);
    const r = await svc.bulkCreateAssignments(1 as unknown as number, [7, 8]);
    expect(r).toEqual([]);
  });
});

describe('AssignmentService.updateAssignment', () => {
  it('throws when assignment missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AssignmentService(pool);
    await expect(svc.updateAssignment(99, { status: 'confirmed' })).rejects.toThrow(/not found/);
  });

  it('returns existing when no fields to update', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow()], null] as Tuple);
    const svc = new AssignmentService(pool);
    const r = await svc.updateAssignment(1, {});
    expect(r.id).toBe(1);
  });

  it('updates status and notes and refreshes', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)
      .mockResolvedValueOnce([[assignmentRow({ status: 'confirmed' })], null] as Tuple);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AssignmentService(pool);
    const r = await svc.updateAssignment(1, { status: 'confirmed', notes: 'ok' });
    expect(r.status).toBe('confirmed');
  });

  it('throws when refresh returns null', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow()], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AssignmentService(pool);
    await expect(svc.updateAssignment(1, { status: 'x' })).rejects.toThrow(/Failed to retrieve/);
  });
});

describe('AssignmentService.completeAssignment', () => {
  it('throws when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AssignmentService(pool);
    await expect(svc.completeAssignment(1)).rejects.toThrow(/not found/);
  });

  it('idempotent on already completed', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow({ status: 'completed' })], null] as Tuple);
    const svc = new AssignmentService(pool);
    const r = await svc.completeAssignment(1);
    expect(r.status).toBe('completed');
  });

  it('rejects non-confirmed', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[assignmentRow({ status: 'pending' })], null] as Tuple);
    const svc = new AssignmentService(pool);
    await expect(svc.completeAssignment(1)).rejects.toThrow(/Only confirmed/);
  });

  it('completes confirmed assignment', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow({ status: 'confirmed' })], null] as Tuple)
      .mockResolvedValueOnce([[assignmentRow({ status: 'completed' })], null] as Tuple);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AssignmentService(pool);
    const r = await svc.completeAssignment(1);
    expect(r.status).toBe('completed');
  });

  it('throws when refresh returns null after complete', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[assignmentRow({ status: 'confirmed' })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AssignmentService(pool);
    await expect(svc.completeAssignment(1)).rejects.toThrow(/Failed to retrieve/);
  });
});

describe('AssignmentService.declineAssignment', () => {
  it('aliases cancel', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([
      [assignmentRow({ status: 'cancelled' })],
      null,
    ] as Tuple);
    const svc = new AssignmentService(pool);
    const r = await svc.declineAssignment(1);
    expect(r.status).toBe('cancelled');
  });
});

describe('AssignmentService.getAvailableEmployeesForShift', () => {
  it('throws when shift missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new AssignmentService(pool);
    await expect(svc.getAvailableEmployeesForShift(1)).rejects.toThrow(/Shift not found/);
  });

  it('returns rows when shift exists', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[shiftRow()], null])
      .mockResolvedValueOnce([
        [{ userId: 7, firstName: 'A', lastName: 'B', email: 'a@b' }],
        null,
      ]);
    const svc = new AssignmentService(pool);
    const r = await svc.getAvailableEmployeesForShift(1);
    expect(r.length).toBe(1);
  });
});

describe('AssignmentService.checkUserAvailability', () => {
  it('returns true when no row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AssignmentService(pool);
    expect(await svc.checkUserAvailability(7, '2026-05-01', '08:00', '16:00')).toBe(true);
  });

  it('returns false when row present', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 1 }], null] as Tuple);
    const svc = new AssignmentService(pool);
    expect(await svc.checkUserAvailability(7, '2026-05-01', '08:00', '16:00')).toBe(false);
  });

  it('bubbles DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AssignmentService(pool);
    await expect(svc.checkUserAvailability(7, '2026-05-01', '08:00', '16:00')).rejects.toThrow(
      /boom/
    );
  });
});

describe('AssignmentService.checkConflicts error path', () => {
  it('bubbles DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AssignmentService(pool);
    await expect(svc.checkConflicts(7, '2026-05-01', '08:00', '16:00')).rejects.toThrow(
      /boom/
    );
  });
});
