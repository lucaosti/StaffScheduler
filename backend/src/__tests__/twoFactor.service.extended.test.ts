/**
 * Extended TwoFactorService tests (#586) — disable (last-method vs. not),
 * isEnabled, hasAnyEnabled, verifyCode/confirmEnable not-found paths, and
 * the JSON-parse failure path in consumeRecoveryCode.
 */

jest.mock('../services/MailerService', () => ({ isEmailConfigured: () => true }));

import { TwoFactorService } from '../services/TwoFactorService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('TwoFactorService.disable', () => {
  it('deletes the method row and clears recovery codes when it was the last enabled method', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // TotpProvider.disable: DELETE
      .mockResolvedValueOnce([[], null]) // hasAnyEnabled: no rows left
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // clear users.two_factor_recovery_codes

    const service = new TwoFactorService(pool);
    await expect(service.disable(7)).resolves.toBeUndefined();

    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM two_factor_methods/);
    expect(execute.mock.calls[2][0]).toMatch(/SET two_factor_recovery_codes = NULL/);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('keeps recovery codes when another method is still enabled', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // TotpProvider.disable: DELETE
      .mockResolvedValueOnce([[{ 1: 1 }], null]); // hasAnyEnabled: another method still enabled

    const service = new TwoFactorService(pool);
    await service.disable(7);

    expect(execute).toHaveBeenCalledTimes(2); // no recovery-code UPDATE issued
  });
});

describe('TwoFactorService.isEnabled', () => {
  it('returns false when the user has no TOTP row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(99)).toBe(false);
  });

  it('returns false when enabled is 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(7)).toBe(false);
  });

  it('returns true when enabled is 1', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.isEnabled(7)).toBe(true);
  });
});

describe('TwoFactorService.hasAnyEnabled', () => {
  it('returns false when no method is enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.hasAnyEnabled(7)).toBe(false);
  });

  it('returns true when at least one method is enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ 1: 1 }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.hasAnyEnabled(7)).toBe(true);
  });
});

describe('TwoFactorService.verifyCode — not-found / corrupt-data paths', () => {
  it('returns false when no method row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(99, '123456')).toBe(false);
  });

  it('returns false when secret_data is unparseable', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: 'not-json' }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '123456')).toBe(false);
  });

  it('accepts secret_data the driver already parsed into an object (not a JSON string)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: { secret: 'JBSWY3DPEHPK3PXP', lastCounter: null } }], null]);

    const service = new TwoFactorService(pool);
    // Not a matching TOTP window, but proves the non-string branch of
    // parseSecretData is exercised (it returns a secretData object rather
    // than null, so we reach matchTotpCounter instead of short-circuiting).
    expect(await service.verifyCode(7, '000000')).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns false when secret_data has no secret field', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ lastCounter: null }) }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.verifyCode(7, '123456')).toBe(false);
  });
});

describe('TwoFactorService.consumeRecoveryCode — JSON parse failure', () => {
  it('returns false when the stored recovery codes are not valid JSON', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ two_factor_recovery_codes: 'not-json' }], null]);

    const service = new TwoFactorService(pool);
    expect(await service.consumeRecoveryCode(7, 'ABCDE-12345')).toBe(false);
  });

  it('returns false when no matching code is found in the list', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ two_factor_recovery_codes: '["$2a$04$wronghash"]' }], null]);

    const service = new TwoFactorService(pool);
    const result = await service.consumeRecoveryCode(7, 'ZZZZZ-ZZZZZ');
    expect(result).toBe(false);
  });

  it('returns false when no user row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    expect(await service.consumeRecoveryCode(99, 'ABCDE-12345')).toBe(false);
  });
});

describe('TwoFactorService.confirmEnable — not-found path', () => {
  it('throws when no method row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new TwoFactorService(pool);
    await expect(service.confirmEnable(99, '123456')).rejects.toThrow('User not found');
  });
});

describe('TwoFactorService.requestChallenge', () => {
  it('delegates to a provider that implements it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 1 }], null]) // EmailCodeProvider.requestChallenge: enabled check
      .mockResolvedValueOnce([[{ email: 'jane@example.com' }], null]) // sendCode: lookup recipient
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // sendCode: INSERT email_outbox
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE secret_data

    const service = new TwoFactorService(pool);
    await expect(service.requestChallenge(7, 'email')).resolves.toBeUndefined();
  });

  it('rejects a method whose provider has no requestChallenge (TOTP)', async () => {
    const { pool } = makePool();
    const service = new TwoFactorService(pool);
    await expect(service.requestChallenge(7, 'totp')).rejects.toThrow(
      "Two-factor method 'totp' does not use a requested challenge"
    );
  });

  it('rejects an unregistered method type', async () => {
    const { pool } = makePool();
    const service = new TwoFactorService(pool);
    await expect(service.requestChallenge(7, 'sms')).rejects.toThrow("Two-factor method 'sms' is not available");
  });
});

describe('TwoFactorService — unregistered method type', () => {
  it('rejects verifyCode/isEnabled/disable/confirmEnable for a method with no registered provider', async () => {
    const { pool } = makePool();
    const service = new TwoFactorService(pool);
    await expect(service.verifyCode(7, '000000', 'sms')).rejects.toThrow("Two-factor method 'sms' is not available");
    await expect(service.isEnabled(7, 'sms')).rejects.toThrow("Two-factor method 'sms' is not available");
    await expect(service.disable(7, 'sms')).rejects.toThrow("Two-factor method 'sms' is not available");
    await expect(service.confirmEnable(7, '000000', 'sms')).rejects.toThrow("Two-factor method 'sms' is not available");
  });
});
