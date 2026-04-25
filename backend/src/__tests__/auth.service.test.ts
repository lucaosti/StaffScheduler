/**
 * AuthService unit tests.
 *
 * Exercises the login state machine with a fake mysql2 Pool. The fake exposes
 * only the surface AuthService.login uses (pool.execute) and is configured per
 * test with a sequence of result tuples.
 */

import bcrypt from 'bcrypt';
import { AuthService } from '../services/AuthService';

type ExecuteResult = [unknown[], unknown];

interface FakePool {
  execute: jest.Mock<Promise<ExecuteResult>, [string, unknown[]?]>;
}

const makePool = (results: ExecuteResult[]): FakePool => {
  const execute = jest.fn();
  for (const result of results) {
    execute.mockResolvedValueOnce(result);
  }
  return { execute };
};

const buildUserRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  email: 'manager@example.com',
  password_hash: '',
  first_name: 'Mara',
  last_name: 'Manager',
  role: 'manager',
  employee_id: 'E-042',
  phone: null,
  is_active: 1,
  last_login: null,
  ...overrides,
});

describe('AuthService.login', () => {
  it('rejects missing credentials with VALIDATION_ERROR before touching the database', async () => {
    const pool = makePool([]);
    const service = new AuthService(pool as never);

    const result = await service.login({ email: '', password: '' });

    expect(result).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' },
    });
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('returns LOGIN_FAILED when the email is unknown without leaking which field was wrong', async () => {
    const pool = makePool([[[], null]]);
    const service = new AuthService(pool as never);

    const result = await service.login({ email: 'ghost@example.com', password: 'whatever' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('LOGIN_FAILED');
      expect(result.error?.message).toBe('Invalid email or password');
    }
  });

  it('returns ACCOUNT_INACTIVE for a deactivated user without comparing the password', async () => {
    const compareSpy = jest.spyOn(bcrypt, 'compare');
    const pool = makePool([[[buildUserRow({ is_active: 0 })], null]]);
    const service = new AuthService(pool as never);

    const result = await service.login({ email: 'manager@example.com', password: 'irrelevant' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('ACCOUNT_INACTIVE');
    }
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('returns LOGIN_FAILED on a bad password and does not update last_login', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const pool = makePool([[[buildUserRow({ password_hash: passwordHash })], null]]);
    const service = new AuthService(pool as never);

    const result = await service.login({ email: 'manager@example.com', password: 'wrong' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('LOGIN_FAILED');
    }
    // Only the SELECT ran; no UPDATE for last_login on a failed attempt.
    expect(pool.execute).toHaveBeenCalledTimes(1);
  });

  it('issues a JWT and updates last_login on a valid login', async () => {
    process.env.JWT_SECRET = 'test-secret-please-rotate';
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const pool = makePool([
      [[buildUserRow({ password_hash: passwordHash })], null],
      [[], null], // last_login UPDATE
    ]);
    const service = new AuthService(pool as never);

    const result = await service.login({
      email: 'manager@example.com',
      password: 'correct-password',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(result.data?.user.email).toBe('manager@example.com');
      expect(result.data?.user.role).toBe('manager');
      // The hash must never leak through the response.
      expect(JSON.stringify(result.data?.user)).not.toContain(passwordHash);
    }
    expect(pool.execute).toHaveBeenCalledTimes(2);
  });

  it('reads from the password_hash column, not the legacy password column', async () => {
    const pool = makePool([[[], null]]);
    const service = new AuthService(pool as never);

    await service.login({ email: 'anyone@example.com', password: 'x' });

    const sql = pool.execute.mock.calls[0]?.[0] ?? '';
    expect(sql).toMatch(/password_hash/);
    expect(sql).not.toMatch(/SELECT[^;]*\bpassword\b(?!_hash)/i);
  });
});
