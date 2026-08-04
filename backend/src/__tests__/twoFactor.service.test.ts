/**
 * TwoFactorService unit tests (F15) — dispatcher + TOTP provider (#586).
 *
 * TwoFactorService delegates to TotpProvider, which stores its enrollment
 * data as JSON in `two_factor_methods.secret_data`; TwoFactorService itself
 * owns recovery codes on `users.two_factor_recovery_codes`. Each test queues
 * the execute() calls in the ORDER the dispatcher and provider issue them —
 * see the inline comments for which call belongs to which layer.
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
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO two_factor_methods/);
    expect(execute.mock.calls[0][1][0]).toBe(7);
  });
});

describe('TwoFactorService.confirmEnable', () => {
  it('refuses if setup has not been started', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: null }], null]); // TotpProvider.confirmEnable's SELECT

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '123456')).rejects.toThrow(/setup has not been started/);
  });

  it('refuses if 2FA is already enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ secret: 'X', lastCounter: null }) }], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '123456')).rejects.toThrow(/already enabled/);
  });

  it('refuses an invalid code', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(7, '000000')).rejects.toThrow(/Invalid verification code/);
  });

  it('enables 2FA and emits 10 recovery codes on a valid code (first method enabled)', async () => {
    const secret = generateSecret();
    const code = totp(secret);
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 0, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null]) // TotpProvider: SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // TotpProvider: UPDATE enabled = 1
      .mockResolvedValueOnce([[{ two_factor_recovery_codes: null }], null]) // TwoFactorService: SELECT existing recovery codes -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // TwoFactorService: UPDATE users SET two_factor_recovery_codes

    const service = new TwoFactorService(pool);
    const out = await service.confirmEnable(7, code);
    expect(out.recoveryCodes).toHaveLength(10);
    for (const c of out.recoveryCodes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    // The UPDATE stores hashed codes, so the plaintext we returned is not in the SQL.
    const storedHashed = JSON.parse(execute.mock.calls[3][1]?.[0] as string) as string[];
    expect(storedHashed).toHaveLength(10);
    for (const h of storedHashed) expect(h).toMatch(/^\$2[ab]\$/); // bcrypt prefix
  });

  it('returns no recovery codes when the user already has some (a second method enrolling)', async () => {
    const secret = generateSecret();
    const code = totp(secret);
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 0, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[{ two_factor_recovery_codes: JSON.stringify(['$2a$04$existing']) }], null]);

    const service = new TwoFactorService(pool);
    const out = await service.confirmEnable(7, code);
    expect(out.recoveryCodes).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(3); // no fourth call — nothing to write
  });
});

describe('TwoFactorService.consumeRecoveryCode', () => {
  it('returns false when no codes are stored', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ two_factor_recovery_codes: null }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.consumeRecoveryCode(7, 'ABCDE-12345')).toBe(false);
  });

  it('removes the consumed code from the stored list on a match', async () => {
    const code = 'AAAAA-22222';
    const hash = await bcrypt.hash(code, 4);
    const stored = JSON.stringify([hash, '$2a$04$other']);
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ two_factor_recovery_codes: stored }], null])
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
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: JSON.stringify({ secret: 'X', lastCounter: null }) }], null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '123456')).toBe(false);
  });

  it('returns true on a fresh TOTP code and persists the matched counter', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, totp(secret))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[1][0])).toContain('secret_data');
  });

  it('returns false when the code matches no time window', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '000000')).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1); // no compare-and-set UPDATE for a non-matching code
  });

  it('rejects a replayed code (counter already recorded)', async () => {
    const secret = generateSecret();
    const currentCounter = Math.floor(Date.now() / 1000 / 30);
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify({ secret, lastCounter: currentCounter + 1 }) }],
      null,
    ]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, totp(secret))).toBe(false);
    // No UPDATE issued: the replay is rejected before the compare-and-set.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects the code when a concurrent login wins the compare-and-set', async () => {
    const secret = generateSecret();
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ secret, lastCounter: null }) }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, totp(secret))).toBe(false);
  });
});

describe('TwoFactorService — unregistered method type', () => {
  it('rejects beginSetup for a method with no registered provider', async () => {
    const { pool } = makePool();
    const service = new TwoFactorService(pool);
    await expect(service.beginSetup(7, 'jane@example.com', 'sms')).rejects.toThrow(
      "Two-factor method 'sms' is not available"
    );
  });
});
