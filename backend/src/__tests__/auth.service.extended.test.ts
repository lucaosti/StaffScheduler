/**
 * Extended AuthService coverage: token verify/refresh, hasRole, change/reset
 * password flows, and error branches that the original suite didn't reach.
 *
 * @author Luca Ostinelli
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/AuthService';
import { config } from '../config';

type Tuple = [unknown, unknown];

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  email: 'a@b',
  password_hash: '',
  first_name: 'A',
  last_name: 'B',
  role: 'manager',
  employee_id: 'E-1',
  phone: null,
  is_active: 1,
  last_login: null,
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
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

const sign = (payload: Record<string, unknown>, expiresIn = '1h') =>
  jwt.sign(payload, config.jwt.secret, { expiresIn } as jwt.SignOptions);

describe('AuthService.verifyToken / getUserFromToken / refreshToken', () => {
  it('verifyToken returns null for invalid', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    expect(await svc.verifyToken('not-a-jwt')).toBeNull();
  });

  it('verifyToken returns decoded for valid', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    const t = sign({ userId: 1, role: 'admin' });
    const r = await svc.verifyToken(t);
    expect((r as any).userId).toBe(1);
  });

  it('getUserFromToken returns null on invalid token', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    expect(await svc.getUserFromToken('garbage')).toBeNull();
  });

  it('getUserFromToken returns null when missing in DB', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AuthService(pool);
    const t = sign({ userId: 99 });
    expect(await svc.getUserFromToken(t)).toBeNull();
  });

  it('getUserFromToken returns mapped user row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[userRow({ id: 99 })], null] as Tuple);
    const svc = new AuthService(pool);
    const t = sign({ userId: 99 });
    const u = await svc.getUserFromToken(t);
    expect(u?.id).toBe(99);
    expect(u?.role).toBe('manager');
  });

  it('getUserFromToken returns null on DB error', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AuthService(pool);
    expect(await svc.getUserFromToken(sign({ userId: 1 }))).toBeNull();
  });

  it('refreshToken returns null on invalid token', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    expect(await svc.refreshToken('garbage')).toBeNull();
  });

  it('refreshToken returns null when user missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AuthService(pool);
    expect(await svc.refreshToken(sign({ userId: 1 }))).toBeNull();
  });

  it('refreshToken returns a new JWT for active user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 1, email: 'a@b', role: 'admin' }],
      null,
    ] as Tuple);
    const svc = new AuthService(pool);
    const t = await svc.refreshToken(sign({ userId: 1 }));
    expect(t).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('refreshToken returns null on DB error', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AuthService(pool);
    expect(await svc.refreshToken(sign({ userId: 1 }))).toBeNull();
  });
});

describe('AuthService.logout / hasRole', () => {
  it('logout returns true', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    expect(await svc.logout(1)).toBe(true);
  });

  it('hasRole returns true when role matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ role: 'admin' }], null] as Tuple);
    const svc = new AuthService(pool);
    expect(await svc.hasRole(1, ['admin', 'manager'])).toBe(true);
  });

  it('hasRole returns false when role missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ role: 'employee' }], null] as Tuple);
    const svc = new AuthService(pool);
    expect(await svc.hasRole(1, ['admin'])).toBe(false);
  });

  it('hasRole returns false when user missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new AuthService(pool);
    expect(await svc.hasRole(1, ['admin'])).toBe(false);
  });

  it('hasRole returns false on DB error', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AuthService(pool);
    expect(await svc.hasRole(1, ['admin'])).toBe(false);
  });
});

describe('AuthService.changePassword', () => {
  it('returns false when user is missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new AuthService(pool);
    expect(await svc.changePassword(1, 'old', 'new')).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('returns false on bad current password', async () => {
    const hash = await bcrypt.hash('right', 4);
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ password_hash: hash }], null]);
    const svc = new AuthService(pool);
    expect(await svc.changePassword(1, 'wrong', 'new')).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('updates password and commits on success', async () => {
    const hash = await bcrypt.hash('right', 4);
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ password_hash: hash }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AuthService(pool);
    expect(await svc.changePassword(1, 'right', 'newpass')).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('AuthService.initiatePasswordReset / completePasswordReset', () => {
  it('initiate returns null for unknown email', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new AuthService(pool);
    expect(await svc.initiatePasswordReset('nobody@x')).toBeNull();
  });

  it('initiate returns reset token for known user', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1 }], null]);
    const svc = new AuthService(pool);
    const t = await svc.initiatePasswordReset('a@b');
    expect(t).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('initiate returns null and rolls back on DB error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new AuthService(pool);
    expect(await svc.initiatePasswordReset('a@b')).toBeNull();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('complete returns false for invalid token', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    expect(await svc.completePasswordReset('garbage', 'np')).toBe(false);
  });

  it('complete returns false for token of wrong purpose', async () => {
    const { pool } = makePool();
    const svc = new AuthService(pool);
    const t = sign({ userId: 1, purpose: 'login' });
    expect(await svc.completePasswordReset(t, 'np')).toBe(false);
  });

  it('complete updates password and commits', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new AuthService(pool);
    const t = sign({ userId: 1, purpose: 'password_reset' });
    expect(await svc.completePasswordReset(t, 'np')).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('AuthService.login error handling', () => {
  it('returns LOGIN_ERROR when DB throws', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('db down'));
    const svc = new AuthService(pool);
    const r = await svc.login({ email: 'a@b', password: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error?.code).toBe('LOGIN_ERROR');
  });
});
