/**
 * SmsCodeProvider unit tests.
 *
 * `isSmsConfigured` is mocked per describe block since the provider gates
 * every send-capable operation on it. Most of the suite runs with it forced
 * true (and a stub `SmsProvider` injected) to exercise the delivery path the
 * same way the email-code provider's tests do; a dedicated block asserts the
 * real, always-false default fails cleanly with `ConflictError`.
 */

import { SmsCodeProvider } from '../services/SmsCodeProvider';
import type { SmsProvider } from '../services/SmsService';

const isSmsConfigured = jest.fn().mockReturnValue(true);
jest.mock('../services/SmsService', () => ({
  isSmsConfigured: () => isSmsConfigured(),
}));

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const makeSmsProvider = (): { provider: SmsProvider; send: jest.Mock } => {
  const send = jest.fn().mockResolvedValue(undefined);
  return { provider: { send }, send };
};

beforeEach(() => {
  isSmsConfigured.mockReturnValue(true);
});

describe('SmsCodeProvider.beginSetup', () => {
  it('sends a code and persists its hash + expiry', async () => {
    const { pool, execute } = makePool();
    const { provider: smsProvider, send } = makeSmsProvider();
    execute
      .mockResolvedValueOnce([[{ phone: '+15551234567' }], null]) // sendCode: lookup recipient
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT two_factor_methods

    const provider = new SmsCodeProvider(pool, smsProvider);
    const out = await provider.beginSetup(7, 'jane@example.com');

    expect(out).toEqual({});
    expect(send).toHaveBeenCalledWith('+15551234567', expect.stringContaining('verification code'));
    expect(execute.mock.calls[1][0]).toMatch(/INSERT INTO two_factor_methods/);
  });

  it('throws when SMS is not configured, without touching the database', async () => {
    isSmsConfigured.mockReturnValue(false);
    const { pool, execute } = makePool();

    const provider = new SmsCodeProvider(pool);
    await expect(provider.beginSetup(7, 'jane@example.com')).rejects.toThrow(/not configured/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws when configured but no SmsProvider was injected', async () => {
    const { pool, execute } = makePool();

    const provider = new SmsCodeProvider(pool);
    await expect(provider.beginSetup(7, 'jane@example.com')).rejects.toThrow(/no SmsProvider was injected/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the user does not exist', async () => {
    const { pool, execute } = makePool();
    const { provider: smsProvider } = makeSmsProvider();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new SmsCodeProvider(pool, smsProvider);
    await expect(provider.beginSetup(99, 'nobody')).rejects.toThrow('User not found');
  });

  it('throws ConflictError when the user has no phone number on file', async () => {
    const { pool, execute } = makePool();
    const { provider: smsProvider } = makeSmsProvider();
    execute.mockResolvedValueOnce([[{ phone: null }], null]);

    const provider = new SmsCodeProvider(pool, smsProvider);
    await expect(provider.beginSetup(7, 'jane@example.com')).rejects.toThrow(/No phone number on file/);
  });
});

describe('SmsCodeProvider.confirmEnable', () => {
  const freshRow = (code: string, msFromNow = 5 * 60_000) => ({
    enabled: 0,
    secret_data: JSON.stringify({
      codeHash: require('crypto').createHash('sha256').update(code).digest('hex'),
      expiresAt: new Date(Date.now() + msFromNow).toISOString(),
    }),
  });

  it('refuses if setup has not been started', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: null }], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(7, '123456')).rejects.toThrow(/setup has not been started/);
  });

  it('refuses if already enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ ...freshRow('123456'), enabled: 1 }], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(7, '123456')).rejects.toThrow(/already enabled/);
  });

  it('refuses an expired code', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[freshRow('123456', -1000)], null]); // expired 1s ago

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(7, '123456')).rejects.toThrow(/Invalid or expired/);
  });

  it('refuses a wrong code', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[freshRow('123456')], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(7, '000000')).rejects.toThrow(/Invalid or expired/);
  });

  it('enables on a valid, unexpired code', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[freshRow('123456')], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(7, '123456')).resolves.toBeUndefined();
    expect(execute.mock.calls[1][0]).toMatch(/SET enabled = 1, secret_data = NULL/);
  });

  it('throws NotFoundError when no row exists at all', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.confirmEnable(99, '123456')).rejects.toThrow('User not found');
  });
});

describe('SmsCodeProvider.disable', () => {
  it('deletes the method row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const provider = new SmsCodeProvider(pool);
    await provider.disable(7);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM two_factor_methods/);
  });
});

describe('SmsCodeProvider.requestChallenge', () => {
  it('refuses when the method is not enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0 }], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.requestChallenge(7)).rejects.toThrow(/not enabled/);
  });

  it('refuses when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new SmsCodeProvider(pool);
    await expect(provider.requestChallenge(7)).rejects.toThrow(/not enabled/);
  });

  it('sends a fresh code and overwrites the stored hash', async () => {
    const { pool, execute } = makePool();
    const { provider: smsProvider, send } = makeSmsProvider();
    execute
      .mockResolvedValueOnce([[{ enabled: 1 }], null]) // enabled check
      .mockResolvedValueOnce([[{ phone: '+15551234567' }], null]) // sendCode: lookup recipient
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE secret_data

    const provider = new SmsCodeProvider(pool, smsProvider);
    await provider.requestChallenge(7);
    expect(send).toHaveBeenCalledWith('+15551234567', expect.stringContaining('verification code'));
    expect(execute.mock.calls[2][0]).toMatch(/UPDATE two_factor_methods SET secret_data/);
  });

  it('fails cleanly with ConflictError while SMS is unconfigured', async () => {
    isSmsConfigured.mockReturnValue(false);
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1 }], null]); // enabled check

    const provider = new SmsCodeProvider(pool);
    await expect(provider.requestChallenge(7)).rejects.toThrow(/not configured/);
  });
});

describe('SmsCodeProvider.verifyCode', () => {
  it('returns false when the method is disabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: null }], null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(false);
  });

  it('returns false when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(99, '123456')).toBe(false);
  });

  it('returns false on an unparseable secret_data', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: 'not-json' }], null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(false);
  });

  it('returns false when secret_data is missing the expiresAt field', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify({ codeHash: 'x' }) }], null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(false);
  });

  it('accepts secret_data the driver already parsed into an object (not a JSON string)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: { codeHash: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString() } }],
      null,
    ]);

    const provider = new SmsCodeProvider(pool);
    // Wrong code, but proves the non-string branch of parseSecretData is
    // exercised (it returns a secretData object rather than null).
    expect(await provider.verifyCode(7, '000000')).toBe(false);
  });

  it('returns false on an expired code', async () => {
    const codeHash = require('crypto').createHash('sha256').update('123456').digest('hex');
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify({ codeHash, expiresAt: new Date(Date.now() - 1000).toISOString() }) }],
      null,
    ]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(false);
  });

  it('returns false on a wrong code, without consuming it', async () => {
    const codeHash = require('crypto').createHash('sha256').update('123456').digest('hex');
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify({ codeHash, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
      null,
    ]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '000000')).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns true and consumes the code on a match', async () => {
    const codeHash = require('crypto').createHash('sha256').update('123456').digest('hex');
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 1, secret_data: JSON.stringify({ codeHash, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(true);
  });

  it('returns false when a concurrent verification already consumed the code', async () => {
    const codeHash = require('crypto').createHash('sha256').update('123456').digest('hex');
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 1, secret_data: JSON.stringify({ codeHash, expiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    const provider = new SmsCodeProvider(pool);
    expect(await provider.verifyCode(7, '123456')).toBe(false);
  });
});

describe('SmsCodeProvider.isEnabled', () => {
  it('returns false when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const provider = new SmsCodeProvider(pool);
    expect(await provider.isEnabled(99)).toBe(false);
  });

  it('returns true when enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1 }], null]);
    const provider = new SmsCodeProvider(pool);
    expect(await provider.isEnabled(7)).toBe(true);
  });
});
