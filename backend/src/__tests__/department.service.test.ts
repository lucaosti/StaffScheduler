/**
 * DepartmentService unit tests.
 */

import { DepartmentService } from '../services/DepartmentService';

const buildDept = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Emergency',
  description: '24h emergency dept',
  manager_id: null,
  manager_first_name: null,
  manager_last_name: null,
  is_active: 1,
  employee_count: 5,
  created_at: '2026-04-26T00:00:00Z',
  updated_at: '2026-04-26T00:00:00Z',
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

describe('DepartmentService.createDepartment', () => {
  it('rolls back when the name already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 9 }], null]);
    const service = new DepartmentService(pool);
    await expect(service.createDepartment({ name: 'Emergency' } as never)).rejects.toThrow(/already exists/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls back when an invalid managerId is provided', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]); // manager lookup empty
    const service = new DepartmentService(pool);
    await expect(
      service.createDepartment({ name: 'X', managerId: 999 } as never)
    ).rejects.toThrow(/Invalid manager/);
  });

  it('inserts and returns the persisted row when valid', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // name lookup
      .mockResolvedValueOnce([{ insertId: 7 }, null]); // insert
    execute.mockResolvedValueOnce([[buildDept({ id: 7 })], null]); // refetch
    const service = new DepartmentService(pool);
    const dept = await service.createDepartment({ name: 'Pediatrics' } as never);
    expect(dept.id).toBe(7);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('DepartmentService.getDepartmentById', () => {
  it('returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new DepartmentService(pool);
    expect(await service.getDepartmentById(99)).toBeNull();
  });

  it('builds managerName when manager fields are present', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        buildDept({ manager_first_name: 'Mara', manager_last_name: 'Manager' }),
      ],
      null,
    ]);
    const service = new DepartmentService(pool);
    const dept = await service.getDepartmentById(1);
    expect(dept?.managerName).toBe('Mara Manager');
  });
});

describe('DepartmentService.getAllDepartments', () => {
  it('passes both isActive and search params to SQL', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildDept()], null]);
    const service = new DepartmentService(pool);
    await service.getAllDepartments({ isActive: false, search: 'Emer' });
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual([0, '%Emer%', '%Emer%']);
  });
});

describe('DepartmentService.deleteDepartment', () => {
  it('refuses to delete a department that still has employees', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ count: 3 }], null]);
    const service = new DepartmentService(pool);
    await expect(service.deleteDepartment(1)).rejects.toThrow(/assigned employees/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('soft-deletes by setting is_active = 0 when empty', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ count: 0 }], null]) // employee count
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    const service = new DepartmentService(pool);
    const ok = await service.deleteDepartment(1);
    expect(ok).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('DepartmentService.assignEmployeesToDepartment', () => {
  it('runs DELETE + INSERT pairs in a transaction', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);
    const service = new DepartmentService(pool);
    await service.assignEmployeesToDepartment(1, [10, 11]);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('DepartmentService.getDepartmentStatistics', () => {
  it('returns aggregate counts', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 4 }], null]) // total
      .mockResolvedValueOnce([[{ count: 3 }], null]) // active
      .mockResolvedValueOnce([[{ count: 30 }], null]); // distinct employees
    const service = new DepartmentService(pool);
    const stats = await service.getDepartmentStatistics();
    expect(stats.total).toBe(4);
    expect(stats.active).toBe(3);
    expect(stats.inactive).toBe(1);
    expect(stats.totalEmployees).toBe(30);
    expect(stats.averageEmployeesPerDepartment).toBe(10);
  });
});

describe('DepartmentService.getDepartmentsForUser', () => {
  it('joins user_departments by user_id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildDept()], null]);
    const service = new DepartmentService(pool);
    const out = await service.getDepartmentsForUser(7);
    expect(out).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toMatch(/JOIN user_departments/);
  });
});
