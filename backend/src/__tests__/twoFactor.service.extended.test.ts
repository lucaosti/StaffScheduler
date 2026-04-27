/**
 * Extended TwoFactorService tests — covers the `disable`, `isEnabled`,
 * `verifyCode` (user-not-found), and the JSON-parse failure path in
 * `consumeRecoveryCode`.
 */

import { TwoFactorService } from '../services/TwoFactorService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('TwoFactorService.disable', () => {
  it('clears totp_secret and disables 2FA for the user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new TwoFactorService(pool);
    await expect(service.disable(7)).resolves.toBeUndefined();

    expect(execute.mock.calls[0][0]).toMatch(/SET totp_enabled = 0, totp_secret = NULL/);
    expect(execute.mock.calls[0][1]).toContain(7);
  });
});

describe('TwoFactorService.isEnabled', () => {
  it('returns false when the user does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(99)).toBe(false);
  });

  it('returns false when totp_enabled is 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_enabled: 0 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(7)).toBe(false);
  });

  it('returns true when totp_enabled is 1', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_enabled: 1 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(7)).toBe(true);
  });
});

describe('TwoFactorService.verifyCode — user-not-found path', () => {
  it('returns false when no user row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(99, '123456')).toBe(false);
  });

  it('returns false when totp_secret is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: null, totp_enabled: 1 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '123456')).toBe(false);
  });
});

describe('TwoFactorService.consumeRecoveryCode — JSON parse failure', () => {
  it('returns false when the stored recovery codes are not valid JSON', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_recovery_codes: 'not-json' }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.consumeRecoveryCode(7, 'ABCDE-12345')).toBe(false);
  });

  it('returns false when no matching code is found in the list', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_recovery_codes: '["$2a$04$wronghash"]' }], null]);

    const service = new TwoFactorService(pool);
    const result = await service.consumeRecoveryCode(7, 'ZZZZZ-ZZZZZ');
    expect(result).toBe(false);
  });
});

describe('TwoFactorService.confirmEnable — user-not-found path', () => {
  it('throws when no user row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(99, '123456')).rejects.toThrow('User not found');
  });
});

