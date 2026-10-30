/**
 * Extended UserService coverage targeting:
 *   - createUser (deps + skills branches, refresh failure)
 *   - getUserByEmail (null + delegated lookup + error)
 *   - getAllUsers filters
 *   - updateUser (each branch incl. password hashing, duplicate email)
 *   - deleteUser
 *   - updateUserDepartments / updateUserSkills (transactional rollback)
 *   - verifyPassword + validatePassword paths (incl. inactive, mismatch, error)
 *   - getUsersByDepartment / getUsersByRole forwarding
 *   - getUserStatistics
 *   - getUsersForManager (admin + manager + error)
 *
 * @author Luca Ostinelli
 */

import bcrypt from 'bcrypt';
import { UserService } from '../services/UserService';
import { invalidateAuthContext } from '../services/cacheStore';

jest.mock('bcrypt');
jest.mock('../services/cacheStore', () => ({ invalidateAuthContext: jest.fn() }));

type Tuple = [unknown, unknown];

const userRow = {
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
  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  it('rejects duplicate email', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 9 }], null]);
    const svc = new UserService(pool);
    await expect(
      svc.createUser({
        email: 'a@b',
        password: 'p',
        firstName: 'A',
        lastName: 'B',
        role: 'employee',
      } as never)
    ).rejects.toThrow(/Email already exists/);
  });

  it('inserts with departments + skills and returns the user', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // existing email
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // INSERT user
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // dept
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // skill
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple) // getUserById select
      .mockResolvedValueOnce([[], null] as Tuple) // dept rows
      .mockResolvedValueOnce([[], null] as Tuple); // skill rows
    const svc = new UserService(pool);
    const out = await svc.createUser({
      email: 'a@b',
      password: 'p',
      firstName: 'A',
      lastName: 'B',
      role: 'employee',
      phone: '1',
      employeeId: 'E',
      departmentIds: [1],
      skillIds: [1],
    } as never);
    expect(out.id).toBe(1);
  });

  it('throws when post-insert fetch is empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    await expect(
      svc.createUser({ email: 'a@b', password: 'p', firstName: 'A', lastName: 'B', role: 'employee' } as never)
    ).rejects.toThrow(/Failed to retrieve created user/);
  });
});

describe('UserService.getUserById / getUserByEmail', () => {
  it('getUserById returns null when missing and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    expect(await svc.getUserById(1)).toBeNull();
    await expect(svc.getUserById(1)).rejects.toThrow(/boom/);
  });

  it('getUserByEmail returns null + delegates when found + bubbles', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    expect(await svc.getUserByEmail('a@b')).toBeNull();
    expect((await svc.getUserByEmail('a@b'))?.id).toBe(1);
    await expect(svc.getUserByEmail('a@b')).rejects.toThrow(/boom/);
  });
});

describe('UserService.getAllUsers filters', () => {
  it('layers all filters and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    const out = await svc.getAllUsers({
      roleId: 1, departmentId: 3,
      isActive: false,
      search: 'foo',
    });
    expect(out.length).toBe(1);
    await expect(svc.getAllUsers({ roleId: 1 })).rejects.toThrow(/boom/);
  });
});

describe('UserService.updateUser', () => {
  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  it('throws on duplicate email', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 5 }], null]);
    const svc = new UserService(pool);
    await expect(svc.updateUser(1, { email: 'x@y' } as never)).rejects.toThrow(
      /Email already exists/
    );
  });

  it('persists every field including password', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // email lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.updateUser(1, {
      email: 'x@y',
      password: 'p',
      firstName: 'A',
      lastName: 'B',
      role: 'manager',
      employeeId: 'E1',
      phone: '5',
      isActive: false,
    } as never);
    expect(out.id).toBe(1);
  });

  it('skips UPDATE when no fields given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    const out = await svc.updateUser(1, {});
    expect(out.id).toBe(1);
  });

  it('throws when post-update fetch is empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    await expect(svc.updateUser(1, { firstName: 'X' } as never)).rejects.toThrow(
      /User not found after update/
    );
  });
});

describe('UserService.deleteUser', () => {
  it('soft-deletes and returns true', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new UserService(pool);
    expect(await svc.deleteUser(1)).toBe(true);
  });

  it('rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    await expect(svc.deleteUser(1)).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('UserService ends sessions on a credential or activation change (#818)', () => {
  const REVOKE_ALL = /UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP\s+WHERE user_id = \? AND revoked_at IS NULL/;

  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    (invalidateAuthContext as jest.Mock).mockClear();
  });

  /** The order the transaction's statements and the cache invalidation happened in. */
  const timeline = (conn: { execute: jest.Mock; commit: jest.Mock }) => {
    const events: string[] = [];
    conn.execute.mockImplementation(async (sql: string) => {
      events.push(REVOKE_ALL.test(sql) ? 'revoke' : 'sql');
      return [{ affectedRows: 1 }, null];
    });
    conn.commit.mockImplementation(async () => { events.push('commit'); });
    (invalidateAuthContext as jest.Mock).mockImplementation(async () => { events.push('invalidate'); });
    return events;
  };

  const mockFetch = (execute: jest.Mock) =>
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

  it.each([
    ['a password change', { password: 'new-password' }],
    ['a deactivation', { isActive: false }],
  ])('revokes every refresh token inside the transaction on %s, then drops the cached context', async (_label, change) => {
    const { pool, conn, execute } = makePool();
    const events = timeline(conn);
    mockFetch(execute);

    await new UserService(pool).updateUser(1, change as never);

    expect(conn.execute.mock.calls.find(([sql]) => REVOKE_ALL.test(sql))?.[1]).toEqual([1]);
    expect(events).toEqual(['sql', 'revoke', 'commit', 'invalidate']);
  });

  it.each([
    ['a profile edit', { firstName: 'X' }],
    ['a reactivation', { isActive: true }],
  ])('leaves sessions alone on %s', async (_label, change) => {
    const { pool, conn, execute } = makePool();
    const events = timeline(conn);
    mockFetch(execute);

    await new UserService(pool).updateUser(1, change as never);

    expect(events).toEqual(['sql', 'commit']);
  });

  it('revokes every refresh token when the account is deleted', async () => {
    const { pool, conn } = makePool();
    const events = timeline(conn);

    await new UserService(pool).deleteUser(1);

    expect(events).toEqual(['sql', 'sql', 'revoke', 'commit', 'invalidate']);
  });
});

describe('UserService.updateUserDepartments / Skills', () => {
  it('replaces departments transactionally and rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new UserService(pool);
    expect(await svc.updateUserDepartments(1, [2])).toBe(true);

    conn.execute.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.updateUserDepartments(1, [2])).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('replaces skills transactionally and rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new UserService(pool);
    expect(await svc.updateUserSkills(1, [2])).toBe(true);

    conn.execute.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.updateUserSkills(1, [2])).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('UserService.verifyPassword / validatePassword', () => {
  it('verifyPassword returns false when hash missing or compare false', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[{ password_hash: 'h' }], null] as Tuple);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
    const svc = new UserService(pool);
    expect(await svc.verifyPassword(1, 'p')).toBe(false);
    expect(await svc.verifyPassword(1, 'p')).toBe(false);
  });

  it('verifyPassword returns false on DB error (covered by safe fallback)', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    expect(await svc.verifyPassword(1, 'p')).toBe(false);
  });

  it('validatePassword null when user missing or inactive', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.validatePassword('a@b', 'p')).toBeNull();
  });

  it('validatePassword null when password mismatch', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[{ password_hash: 'h' }], null] as Tuple);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
    const svc = new UserService(pool);
    expect(await svc.validatePassword('a@b', 'wrong')).toBeNull();
  });

  it('validatePassword returns the user on success and updates last_login', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[{ password_hash: 'h' }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    const svc = new UserService(pool);
    const out = await svc.validatePassword('a@b', 'good');
    expect(out?.id).toBe(1);
  });

  it('validatePassword propagates internal errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    await expect(svc.validatePassword('a@b', 'p')).rejects.toThrow('boom');
  });

  it('validatePassword returns null when user inactive', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([[{ ...userRow, is_active: 0 }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new UserService(pool);
    expect(await svc.validatePassword('a@b', 'p')).toBeNull();
  });
});

describe('UserService getters / stats', () => {
  it('getUsersByDepartment + getUsersByRole forward to getAllUsers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    expect((await svc.getUsersByDepartment(3)).length).toBe(1);
    expect((await svc.getUsersByRoleId(2)).length).toBe(1);
  });

  it('getUserStatistics returns aggregates and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ count: 10 }], null] as Tuple)
      .mockResolvedValueOnce([[{ count: 8 }], null] as Tuple)
      .mockResolvedValueOnce([[{ role: 'admin', count: 1 }], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    const s = await svc.getUserStatistics();
    expect(s.total).toBe(10);
    expect(s.inactive).toBe(2);
    expect(s.byRole[0].role).toBe('admin');
    await expect(svc.getUserStatistics()).rejects.toThrow(/boom/);
  });

  it('getUsersForManager admin path returns all users', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow], null] as Tuple);
    const svc = new UserService(pool);
    expect((await svc.getUsersForManager({ id: 1, email: 'a@x', isActive: true, permissions: ['settings.manage'] } as never)).length).toBe(1);
  });

  it('getUsersForManager manager path filters by manager and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[userRow], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new UserService(pool);
    expect((await svc.getUsersForManager({ id: 1, email: 'm@x', isActive: true, permissions: [] } as never)).length).toBe(1);
    await expect(svc.getUsersForManager({ id: 1, email: 'm@x', isActive: true, permissions: [] } as never)).rejects.toThrow(/boom/);
  });
});
