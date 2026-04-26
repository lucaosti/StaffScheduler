/**
 * UserService unit tests.
 */

import { UserService } from '../services/UserService';

const buildUserRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  email: 'a@x.com',
  first_name: 'A',
  last_name: 'B',
  role: 'employee',
  employee_id: 'E-007',
  phone: null,
  is_active: 1,
  last_login: null,
  created_at: '2026-04-26',
  updated_at: '2026-04-26',
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

describe('UserService.createUser', () => {
  it('rolls back when the email already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1 }], null]);
    const service = new UserService(pool);
    await expect(
      service.createUser({ email: 'dup@x.com', password: 'pw', firstName: 'A', lastName: 'B', role: 'employee' } as never)
    ).rejects.toThrow(/already exists/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('inserts the user, links departments and skills, and commits', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // dup check
      .mockResolvedValueOnce([{ insertId: 7 }, null]) // insert user
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // dept link
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // skill link
    execute
      .mockResolvedValueOnce([[buildUserRow()], null]) // refetch base row
      .mockResolvedValueOnce([[], null]) // departments
      .mockResolvedValueOnce([[], null]); // skills

    const service = new UserService(pool);
    const created = await service.createUser({
      email: 'a@x.com',
      password: 'pw',
      firstName: 'A',
      lastName: 'B',
      role: 'employee',
      departmentIds: [3],
      skillIds: [9],
    } as never);
    expect(created.id).toBe(7);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('UserService.getUserById', () => {
  it('returns null when the user is missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new UserService(pool);
    expect(await service.getUserById(99)).toBeNull();
  });

  it('hydrates departments and skills', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildUserRow()], null])
      .mockResolvedValueOnce([[{ id: 1, name: 'Emergency' }], null])
      .mockResolvedValueOnce([
        [{ id: 11, name: 'Triage', description: '', is_active: 1, created_at: '2026-04-26' }],
        null,
      ]);
    const service = new UserService(pool);
    const user = await service.getUserById(7);
    expect(user?.departments).toHaveLength(1);
    expect(user?.skills).toHaveLength(1);
  });
});

describe('UserService.getUserByEmail', () => {
  it('returns null when no row matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new UserService(pool);
    expect(await service.getUserByEmail('nope@x')).toBeNull();
  });
});

describe('UserService.getAllUsers', () => {
  it('layers filters: role, departmentId, isActive, search', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildUserRow()], null]);
    const service = new UserService(pool);
    await service.getAllUsers({ role: 'manager', departmentId: 3, isActive: false, search: 'demo' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/JOIN user_departments/);
    expect(sql).toMatch(/u\.role = \?/);
    expect(sql).toMatch(/u\.is_active = \?/);
    expect(sql).toMatch(/LIKE \?/);
  });
});

describe('UserService.updateUser', () => {
  it('refuses an email collision on another user', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 99 }], null]);
    const service = new UserService(pool);
    await expect(service.updateUser(7, { email: 'dup@x.com' } as never)).rejects.toThrow(/already exists/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('builds a partial UPDATE for the supplied fields', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // email collision check absent for this case
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute
      .mockResolvedValueOnce([[buildUserRow({ first_name: 'X' })], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    const service = new UserService(pool);
    const updated = await service.updateUser(7, { firstName: 'X' } as never);
    expect(updated.firstName).toBe('X');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('UserService.deleteUser', () => {
  it('soft-deletes by flipping is_active', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const service = new UserService(pool);
    expect(await service.deleteUser(7)).toBe(true);
    expect(conn.execute.mock.calls[0][0]).toMatch(/UPDATE users SET is_active = 0/);
  });
});

describe('UserService.validatePassword', () => {
  it('returns null when the user is inactive', async () => {
    const { pool, execute } = makePool();
    // getUserByEmail -> getUserById path
    execute
      .mockResolvedValueOnce([[{ id: 7 }], null]) // getUserByEmail base row
      .mockResolvedValueOnce([[buildUserRow({ is_active: 0 })], null]) // getUserById row
      .mockResolvedValueOnce([[], null]) // depts
      .mockResolvedValueOnce([[], null]); // skills
    const service = new UserService(pool);
    expect(await service.validatePassword('a@x.com', 'pw')).toBeNull();
  });
});

describe('UserService.getUserStatistics', () => {
  it('combines total, active, and per-role counts', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 10 }], null])
      .mockResolvedValueOnce([[{ count: 8 }], null])
      .mockResolvedValueOnce([[{ role: 'employee', count: 6 }, { role: 'manager', count: 2 }], null]);
    const service = new UserService(pool);
    const stats = await service.getUserStatistics();
    expect(stats.total).toBe(10);
    expect(stats.active).toBe(8);
    expect(stats.inactive).toBe(2);
    expect(stats.byRole).toHaveLength(2);
  });
});

describe('UserService.getUsersForManager', () => {
  it('admin gets full list (delegates to getAllUsers)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildUserRow()], null]);
    const service = new UserService(pool);
    const users = await service.getUsersForManager(1, 'admin');
    expect(users).toHaveLength(1);
  });

  it('manager gets users from departments they own', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildUserRow()], null]);
    const service = new UserService(pool);
    const users = await service.getUsersForManager(1, 'manager');
    expect(users).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toMatch(/d\.manager_id = \?/);
  });
});
