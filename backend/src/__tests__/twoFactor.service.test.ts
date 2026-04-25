/**
 * TwoFactorService unit tests (F15).
 */

import bcrypt from 'bcrypt';
import { TwoFactorService } from '../services/TwoFactorService';
import { generateSecret, totp } from '../utils/totp';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('TwoFactorService.beginSetup', () => {
  it('persists a fresh secret and returns a provisioning URI', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new TwoFactorService(pool);
    const out = await service.beginSetup(7, 'jane@example.com');

    expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(out.otpauthUri).toContain('otpauth://totp/Staff%20Scheduler:jane%40example.com');
    expect(execute.mock.calls[0][0]).toMatch(/UPDATE users SET totp_secret/);
  });
});

describe('TwoFactorService.confirmEnable', () => {
  it('refuses if setup has not been started', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: null, totp_enabled: 0 }], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '123456')).rejects.toThrow(/setup has not been started/);
  });

  it('refuses if 2FA is already enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: 'X', totp_enabled: 1 }], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '123456')).rejects.toThrow(/already enabled/);
  });

  it('refuses an invalid code', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: secret, totp_enabled: 0 }], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '000000')).rejects.toThrow(/Invalid verification code/);
  });

  it('enables 2FA and emits 10 recovery codes on a valid code', async () => {
    const secret = generateSecret();
    const code = totp(secret);
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ totp_secret: secret, totp_enabled: 0 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new TwoFactorService(pool);
    const out = await service.confirmEnable(7, code);
    expect(out.recoveryCodes).toHaveLength(10);
    for (const c of out.recoveryCodes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    // The UPDATE stores hashed codes, so the plaintext we returned is not in the SQL.
    const storedHashed = JSON.parse(execute.mock.calls[1][1]?.[0] as string) as string[];
    expect(storedHashed).toHaveLength(10);
    for (const h of storedHashed) expect(h).toMatch(/^\$2[ab]\$/); // bcrypt prefix
  });
});

describe('TwoFactorService.consumeRecoveryCode', () => {
  it('returns false when no codes are stored', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_recovery_codes: null }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.consumeRecoveryCode(7, 'ABCDE-12345')).toBe(false);
  });

  it('removes the consumed code from the stored list on a match', async () => {
    const code = 'AAAAA-22222';
    const hash = await bcrypt.hash(code, 4);
    const stored = JSON.stringify([hash, '$2a$04$other']);
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ totp_recovery_codes: stored }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new TwoFactorService(pool);
    const ok = await service.consumeRecoveryCode(7, code);
    expect(ok).toBe(true);
    const updatedJson = execute.mock.calls[1][1]?.[0] as string;
    const remaining = JSON.parse(updatedJson) as string[];
    expect(remaining).toEqual(['$2a$04$other']);
  });
});

describe('TwoFactorService.verifyCode', () => {
  it('returns false when 2FA is disabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: 'X', totp_enabled: 0 }], null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '123456')).toBe(false);
  });

  it('returns true on a fresh TOTP code', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ totp_secret: secret, totp_enabled: 1 }], null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, totp(secret))).toBe(true);
  });
});
