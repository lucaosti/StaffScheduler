/**
 * UserService coverage supplement — fills gaps not hit by existing test files:
 *   - createUser with roleIds array
 *   - getAllUsers with departmentName / orgUnitIds filters and pagination
 *   - countUsers (entire method, all filter branches + error)
 *   - updateUser with position / hourlyRate / roleIds (empty + non-empty)
 *   - verifyPassword catch when bcrypt.compare throws
 *   - getUsersForManager search + departmentId filters and pagination
 *   - countUsersForManager admin path, manager path with filters, error
 *
 * @author Luca Ostinelli
 */

import bcrypt from 'bcrypt';
import { UserService } from '../services/UserService';

jest.mock('bcrypt');

type Tuple = [unknown, unknown];

const userRow = {
  id: 1,
  email: 'a@b',
  first_name: 'A',
  last_name: 'B',
  employee_id: 'E',
  phone: null,
  position: 'Engineer',
  hourly_rate: 25.0,
  is_active: 1,
  last_login: null,
  created_at: 't',
  updated_at: 't',
};

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

// ─── createUser with roleIds ──────────────────────────────────────────────────

describe('UserService.createUser with roleIds', () => {
  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  it('inserts role assignments when roleIds is provided', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])           // email check
      .mockResolvedValueOnce([{ insertId: 5 }, null])  // INSERT user
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT roles
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)  // getUserById
      .mockResolvedValueOnce([[], null] as Tuple)          // depts
      .mockResolvedValueOnce([[], null] as Tuple);         // skills

    const svc = new UserService(pool);
    const out = await svc.createUser({
      email: 'a@b',
      password: 'pass1234',
      firstName: 'A',
      lastName: 'B',
      roleIds: [1, 2],
    } as never);
    expect(out.id).toBe(1);
    // Verify the role INSERT was called (third conn.execute call)
    const callArgs = conn.execute.mock.calls[2][0] as string;
    expect(callArgs).toMatch(/INSERT IGNORE INTO user_roles/);
  });
});

// ─── getAllUsers — departmentName + orgUnitIds filters and pagination ─────────

describe('UserService.getAllUsers additional filters', () => {
  it('applies departmentName filter when departmentId is not set', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getAllUsers({ departmentName: 'Eng' });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/dept_f\.name/);
  });

  it('applies departmentName filter combined with departmentId (skips second ud JOIN)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getAllUsers({ departmentId: 1, departmentName: 'Eng' });
    expect(out.length).toBe(1);
    // When both are set the departmentName branch should not add another ud JOIN;
    // it should only add the dept_f JOIN for the name condition.
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/JOIN departments dept_f/);
    // The primary ud alias is introduced once from departmentId; departmentName adds dept_f only.
    expect((sql.match(/JOIN user_departments ud ON/g) ?? []).length).toBe(1);
  });

  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getAllUsers({ orgUnitIds: [3, 4] });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/uou\.org_unit_id IN/);
  });

  it('uses LIMIT/OFFSET when pagination is provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getAllUsers({}, { limit: 10, offset: 20 });
    expect(out.length).toBe(1);
    const params = execute.mock.calls[0][1] as unknown[];
    // Last two params should be limit=10, offset=20
    expect(params.slice(-2)).toEqual([10, 20]);
  });
});

// ─── countUsers ───────────────────────────────────────────────────────────────

describe('UserService.countUsers', () => {
  it('counts without filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 42 }], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsers()).toBe(42);
  });

  it('applies departmentId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 5 }], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsers({ departmentId: 2 })).toBe(5);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/ud\.department_id/);
  });

  it('applies departmentName filter when departmentId absent', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 3 }], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsers({ departmentName: 'Ops' })).toBe(3);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/dept_f\.name/);
  });

  it('applies departmentName combined with departmentId (no double JOIN)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 2 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsers({ departmentId: 1, departmentName: 'Ops' });
    const sql = execute.mock.calls[0][0] as string;
    expect((sql.match(/JOIN user_departments/g) ?? []).length).toBe(1);
  });

  it('applies roleId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 1 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsers({ roleId: 3 });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/ur\.role_id/);
  });

  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 7 }], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsers({ orgUnitIds: [1, 2] })).toBe(7);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/uou\.org_unit_id IN/);
  });

  it('applies isActive filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 9 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsers({ isActive: true });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/u\.is_active/);
  });

  it('applies search filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 4 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsers({ search: 'alice' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/first_name LIKE/);
  });

  it('returns 0 when result row is missing total', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{}], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsers()).toBe(0);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('db down'));
    const svc = new UserService(pool);
    await expect(svc.countUsers()).rejects.toThrow('db down');
  });
});

// ─── updateUser — position, hourlyRate, roleIds ───────────────────────────────

describe('UserService.updateUser position / hourlyRate / roleIds', () => {
  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  it('persists position and hourlyRate', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple) // getUserById
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.updateUser(1, { position: 'Manager', hourlyRate: 30 });
    expect(out.id).toBe(1);
    const sql = conn.execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/position = \?/);
    expect(sql).toMatch(/hourly_rate = \?/);
  });

  it('replaces roles when roleIds non-empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE base fields
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // DELETE roles
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT roles
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    await svc.updateUser(1, { firstName: 'X', roleIds: [5] } as never);
    const deleteCall = conn.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM user_roles')
    );
    expect(deleteCall).toBeDefined();
    const insertCall = conn.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT IGNORE INTO user_roles')
    );
    expect(insertCall).toBeDefined();
  });

  it('only deletes roles when roleIds is empty array', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // DELETE roles
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    await svc.updateUser(1, { firstName: 'X', roleIds: [] } as never);
    const insertCall = conn.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT IGNORE INTO user_roles')
    );
    expect(insertCall).toBeUndefined();
  });
});

// ─── verifyPassword — bcrypt.compare throws ───────────────────────────────────

describe('UserService.verifyPassword error path', () => {
  it('returns false when bcrypt.compare throws', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ password_hash: 'h' }], null] as Tuple);
    (bcrypt.compare as jest.Mock).mockRejectedValueOnce(new Error('bcrypt fail'));
    const svc = new UserService(pool);
    expect(await svc.verifyPassword(1, 'pass')).toBe(false);
  });
});

// ─── getUsersForManager — search, departmentId, pagination ───────────────────

describe('UserService.getUsersForManager filters and pagination', () => {
  const managerActor = { id: 99, email: 'm@x', isActive: true, permissions: [] } as never;

  it('applies search filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getUsersForManager(managerActor, { search: 'alice' });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/first_name LIKE/);
  });

  it('applies departmentId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.getUsersForManager(managerActor, { departmentId: 7 });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/ud\.department_id/);
  });

  it('appends LIMIT/OFFSET when pagination provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    await svc.getUsersForManager(managerActor, {}, { limit: 5, offset: 10 });
    const params = execute.mock.calls[0][1] as unknown[];
    expect(params.slice(-2)).toEqual([5, 10]);
  });
});

// ─── countUsersForManager ─────────────────────────────────────────────────────

describe('UserService.countUsersForManager', () => {
  it('delegates to countUsers for admin', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 20 }], null] as Tuple);
    const svc = new UserService(pool);
    const count = await svc.countUsersForManager(
      { id: 1, email: 'a@x', isActive: true, permissions: ['settings.manage'] } as never
    );
    expect(count).toBe(20);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/COUNT\(DISTINCT u\.id\)/);
  });

  it('counts by manager without filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 3 }], null] as Tuple);
    const svc = new UserService(pool);
    const count = await svc.countUsersForManager(
      { id: 9, email: 'm@x', isActive: true, permissions: [] } as never
    );
    expect(count).toBe(3);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/d\.manager_id/);
  });

  it('applies search filter for manager path', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 1 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsersForManager(
      { id: 9, email: 'm@x', isActive: true, permissions: [] } as never,
      { search: 'bob' }
    );
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/first_name LIKE/);
  });

  it('applies departmentId filter for manager path', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 2 }], null] as Tuple);
    const svc = new UserService(pool);
    await svc.countUsersForManager(
      { id: 9, email: 'm@x', isActive: true, permissions: [] } as never,
      { departmentId: 4 }
    );
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/ud\.department_id/);
  });

  it('returns 0 when result row missing total', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{}], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.countUsersForManager(
      { id: 9, email: 'm@x', isActive: true, permissions: [] } as never
    )).toBe(0);
  });

  it('bubbles errors from DB', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('conn lost'));
    const svc = new UserService(pool);
    await expect(
      svc.countUsersForManager({ id: 9, email: 'm@x', isActive: true, permissions: [] } as never)
    ).rejects.toThrow('conn lost');
  });
});
