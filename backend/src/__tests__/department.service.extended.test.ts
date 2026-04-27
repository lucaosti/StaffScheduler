/**
 * Extended DepartmentService coverage targeting:
 *   - createDepartment "Failed to retrieve created department" path
 *   - getDepartmentById error bubble
 *   - getAllDepartments error bubble + no-filter path
 *   - updateDepartment (every field branch + uniqueness rejection +
 *     invalid manager + missing post-update + no-fields no-op)
 *   - deleteDepartment "not found" path
 *   - getDepartmentEmployees / removeEmployeeFromDepartment / addUser/removeUser
 *   - assignEmployeesToDepartment (missing dept, skipped invalid user, dedupe)
 *   - getDepartmentsByManager mapping
 *   - getDepartmentStatistics with zero active depts
 *   - getDepartmentStatsByDepartment + getDepartmentStats
 *
 * @author Luca Ostinelli
 */

import { DepartmentService } from '../services/DepartmentService';

type Tuple = [unknown, unknown];

const buildDept = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Emergency',
  description: 'd',
  manager_id: 5,
  manager_first_name: 'Mara',
  manager_last_name: 'Manager',
  is_active: 1,
  employee_count: 5,
  created_at: 't',
  updated_at: 't',
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
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

describe('DepartmentService.createDepartment edge cases', () => {
  it('throws when post-insert lookup is empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 7 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new DepartmentService(pool);
    await expect(svc.createDepartment({ name: 'X' } as never)).rejects.toThrow(
      /Failed to retrieve created department/
    );
  });

  it('inserts with managerId after a successful manager lookup', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[{ id: 5 }], null])
      .mockResolvedValueOnce([{ insertId: 9 }, null]);
    execute.mockResolvedValueOnce([[buildDept({ id: 9 })], null] as Tuple);
    const svc = new DepartmentService(pool);
    const out = await svc.createDepartment({ name: 'X', managerId: 5, description: 'd' } as never);
    expect(out.id).toBe(9);
  });
});

describe('DepartmentService.getDepartmentById error path', () => {
  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    await expect(svc.getDepartmentById(1)).rejects.toThrow(/boom/);
  });
});

describe('DepartmentService.getAllDepartments paths', () => {
  it('runs without filters and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildDept()], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    expect((await svc.getAllDepartments()).length).toBe(1);
    await expect(svc.getAllDepartments()).rejects.toThrow(/boom/);
  });

  it('hides managerName when manager fields missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [buildDept({ manager_first_name: null, manager_last_name: null })],
      null,
    ] as Tuple);
    const svc = new DepartmentService(pool);
    const [d] = await svc.getAllDepartments();
    expect(d.managerName).toBeUndefined();
  });
});

describe('DepartmentService.updateDepartment', () => {
  it('rejects duplicate names', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 9 }], null]);
    const svc = new DepartmentService(pool);
    await expect(svc.updateDepartment(1, { name: 'Other' } as never)).rejects.toThrow(
      /already in use/
    );
  });

  it('rejects invalid manager', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new DepartmentService(pool);
    await expect(svc.updateDepartment(1, { managerId: 999 } as never)).rejects.toThrow(
      /Invalid manager/
    );
  });

  it('persists each field including null managerId and isActive', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // name lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute.mockResolvedValueOnce([[buildDept()], null] as Tuple);
    const svc = new DepartmentService(pool);
    const out = await svc.updateDepartment(1, {
      name: 'New',
      description: 'd',
      managerId: null,
      isActive: false,
    } as never);
    expect(out.id).toBe(1);
  });

  it('skips UPDATE when nothing to change but still refetches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildDept()], null] as Tuple);
    const svc = new DepartmentService(pool);
    const out = await svc.updateDepartment(1, {});
    expect(out.id).toBe(1);
  });

  it('throws when post-update lookup is empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new DepartmentService(pool);
    await expect(svc.updateDepartment(1, { description: 'x' } as never)).rejects.toThrow(
      /Department not found after update/
    );
  });
});

describe('DepartmentService.deleteDepartment', () => {
  it('throws when DELETE affects 0 rows', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ count: 0 }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const svc = new DepartmentService(pool);
    await expect(svc.deleteDepartment(1)).rejects.toThrow(/Department not found/);
  });
});

describe('DepartmentService.getDepartmentEmployees', () => {
  it('maps users + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 7,
            email: 'a@b',
            first_name: 'A',
            last_name: 'B',
            role: 'employee',
            employee_id: 'E1',
          },
        ],
        null,
      ] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    expect((await svc.getDepartmentEmployees(1)).length).toBe(1);
    await expect(svc.getDepartmentEmployees(1)).rejects.toThrow(/boom/);
  });
});

describe('DepartmentService.assignEmployeesToDepartment branches', () => {
  it('throws when department missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new DepartmentService(pool);
    await expect(svc.assignEmployeesToDepartment(1, [1])).rejects.toThrow(/Department not found/);
  });

  it('skips invalid users and avoids duplicates', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null]) // dept exists
      .mockResolvedValueOnce([[], null]) // user 1 invalid
      .mockResolvedValueOnce([[{ id: 2 }], null]) // user 2 exists
      .mockResolvedValueOnce([[{ id: 99 }], null]) // already assigned
      .mockResolvedValueOnce([[{ id: 3 }], null]) // user 3 exists
      .mockResolvedValueOnce([[], null]) // not assigned
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT
    const svc = new DepartmentService(pool);
    await svc.assignEmployeesToDepartment(1, [1, 2, 3]);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('DepartmentService convenience helpers', () => {
  it('addUserToDepartment delegates to assignEmployeesToDepartment', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null])
      .mockResolvedValueOnce([[{ id: 2 }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new DepartmentService(pool);
    await svc.addUserToDepartment(1, 2);
  });

  it('removeUserFromDepartment delegates to remove + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    await svc.removeUserFromDepartment(1, 2);
    await expect(svc.removeEmployeeFromDepartment(1, 2)).rejects.toThrow(/boom/);
  });

  it('getDepartmentsByManager maps rows + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildDept()], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    expect((await svc.getDepartmentsByManager(5)).length).toBe(1);
    await expect(svc.getDepartmentsByManager(5)).rejects.toThrow(/boom/);
  });

  it('getDepartmentStatistics handles 0 active depts + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 0 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 0 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 0 }], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    expect((await svc.getDepartmentStatistics()).averageEmployeesPerDepartment).toBe(0);
    await expect(svc.getDepartmentStatistics()).rejects.toThrow(/boom/);
  });

  it('getDepartmentsForUser bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    await expect(svc.getDepartmentsForUser(1)).rejects.toThrow(/boom/);
  });

  it('getDepartmentStats forwards to getDepartmentStatistics', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 4 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 3 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 30 }], null] as Tuple);
    const svc = new DepartmentService(pool);
    const s = await svc.getDepartmentStats();
    expect(s.total).toBe(4);
  });

  it('getDepartmentStatsByDepartment returns counts + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 5 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 12 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 1 }], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new DepartmentService(pool);
    const s = await svc.getDepartmentStatsByDepartment(1);
    expect(s.employeeCount).toBe(5);
    expect(s.shiftCount).toBe(12);
    expect(s.activeScheduleCount).toBe(1);
    await expect(svc.getDepartmentStatsByDepartment(1)).rejects.toThrow(/boom/);
  });
});
