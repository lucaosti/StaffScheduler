/**
 * WebAuthnProvider unit tests (#587).
 *
 * `@simplewebauthn/server`'s ceremony functions do real cryptographic
 * verification against a genuine authenticator response, which nothing in
 * a unit test can produce — so the module is mocked wholesale, and these
 * tests exercise the provider's own storage/dispatch logic: what it stores
 * after a successful ceremony, what it refuses before even asking the
 * library, and how it reacts to `verified: false`.
 */

const generateRegistrationOptions = jest.fn();
const verifyRegistrationResponse = jest.fn();
const generateAuthenticationOptions = jest.fn();
const verifyAuthenticationResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args: unknown[]) => generateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) => generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => verifyAuthenticationResponse(...args),
}));

import { WebAuthnProvider } from '../services/WebAuthnProvider';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const enrolledSecretData = (overrides: Record<string, unknown> = {}) => ({
  pendingChallenge: null,
  pendingChallengeExpiresAt: null,
  credentialId: 'cred-1',
  publicKeyBase64: Buffer.from('public-key-bytes').toString('base64'),
  counter: 0,
  transports: ['internal'],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WebAuthnProvider.beginSetup', () => {
  it('generates registration options and persists the pending challenge', async () => {
    generateRegistrationOptions.mockResolvedValueOnce({ challenge: 'reg-challenge', rp: { id: 'localhost' } });
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const provider = new WebAuthnProvider(pool);
    const out = await provider.beginSetup(7, 'jane@example.com');

    expect(out).toEqual({ challenge: 'reg-challenge', rp: { id: 'localhost' } });
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO two_factor_methods/);
    const storedData = JSON.parse(execute.mock.calls[0][1][1]);
    expect(storedData.pendingChallenge).toBe('reg-challenge');
  });
});

describe('WebAuthnProvider.confirmEnable', () => {
  it('refuses if setup has not been started', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: null }], null]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/setup has not been started/);
  });

  it('refuses when the stored secret_data is unparseable', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: 'not-json' }], null]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/setup has not been started/);
  });

  it('accepts secret_data the driver already parsed into an object (not a JSON string)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 0, secret_data: { pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() } }],
      null,
    ]);
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });

    const provider = new WebAuthnProvider(pool);
    // Proves parseSecretData's non-string branch returns the secretData
    // (so we reach verification) rather than treating it as "not started."
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/Invalid registration response/);
  });

  it('treats a stored primitive (not an object) as unparseable', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: '5' }], null]); // valid JSON, but not an object

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/setup has not been started/);
  });

  it('refuses if already enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
      null,
    ]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/already enabled/);
  });

  it('refuses an expired challenge', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() - 1000).toISOString() }) }],
      null,
    ]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/expired/);
  });

  it('refuses an unparseable response', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
      null,
    ]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, 'not-json')).rejects.toThrow(/Invalid registration response/);
  });

  it('refuses when verification fails', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
      null,
    ]);
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/Invalid registration response/);
  });

  it('refuses when the library itself throws', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
      null,
    ]);
    verifyRegistrationResponse.mockRejectedValueOnce(new Error('bad attestation'));

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).rejects.toThrow(/Invalid registration response/);
  });

  it('enables and persists the credential on a valid response', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array(Buffer.from('pk')), counter: 0, transports: ['internal'] },
      },
    });

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(7, '{}')).resolves.toBeUndefined();

    const stored = JSON.parse(execute.mock.calls[1][1][0]);
    expect(stored.credentialId).toBe('cred-1');
    expect(stored.pendingChallenge).toBeNull();
  });

  it('stores null transports when the credential reports none', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 0, secret_data: JSON.stringify({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() }) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array(Buffer.from('pk')), counter: 0 },
      },
    });

    const provider = new WebAuthnProvider(pool);
    await provider.confirmEnable(7, '{}');

    const stored = JSON.parse(execute.mock.calls[1][1][0]);
    expect(stored.transports).toBeNull();
  });

  it('throws NotFoundError when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.confirmEnable(99, '{}')).rejects.toThrow('User not found');
  });
});

describe('WebAuthnProvider.disable', () => {
  it('deletes the method row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const provider = new WebAuthnProvider(pool);
    await provider.disable(7);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM two_factor_methods/);
  });
});

describe('WebAuthnProvider.requestChallenge', () => {
  it('refuses when not enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: JSON.stringify(enrolledSecretData()) }], null]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.requestChallenge(7)).rejects.toThrow(/not enabled/);
  });

  it('refuses when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const provider = new WebAuthnProvider(pool);
    await expect(provider.requestChallenge(7)).rejects.toThrow(/not enabled/);
  });

  it('returns fresh authentication options and persists the challenge', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData()) }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    generateAuthenticationOptions.mockResolvedValueOnce({ challenge: 'auth-challenge', rpId: 'localhost' });

    const provider = new WebAuthnProvider(pool);
    const out = await provider.requestChallenge(7);

    expect(out).toEqual({ challenge: 'auth-challenge', rpId: 'localhost' });
    const stored = JSON.parse(execute.mock.calls[1][1][0]);
    expect(stored.pendingChallenge).toBe('auth-challenge');
    expect(stored.credentialId).toBe('cred-1'); // the existing credential is preserved, not clobbered
  });

  it('passes undefined transports to the library when none were stored', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ transports: null })) }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    generateAuthenticationOptions.mockResolvedValueOnce({ challenge: 'auth-challenge' });

    const provider = new WebAuthnProvider(pool);
    await provider.requestChallenge(7);

    expect(generateAuthenticationOptions.mock.calls[0][0].allowCredentials[0].transports).toBeUndefined();
  });
});

describe('WebAuthnProvider.verifyCode', () => {
  it('returns false when not enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 0, secret_data: null }], null]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });

  it('returns false when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(99, '{}')).toBe(false);
  });

  it('returns false when no challenge was requested', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData()) }], null]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });

  it('returns false when the challenge has expired', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() - 1000).toISOString() })) }],
      null,
    ]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });

  it('returns false on an unparseable response', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() })) }],
      null,
    ]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, 'not-json')).toBe(false);
  });

  it('returns false when the library reports verified: false', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() })) }],
      null,
    ]);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });

  it('returns false when the library itself throws', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() })) }],
      null,
    ]);
    verifyAuthenticationResponse.mockRejectedValueOnce(new Error('bad assertion'));
    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });

  it('returns true and updates the counter on a valid assertion', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() })) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });

    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(true);
    expect(execute.mock.calls[1][0]).toMatch(/JSON_SET/);
  });

  it('defaults counter to 0 and transports to undefined when reconstructing the credential', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{
          enabled: 1,
          secret_data: JSON.stringify(
            enrolledSecretData({
              counter: null,
              transports: null,
              pendingChallenge: 'x',
              pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            })
          ),
        }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 1 } });

    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(true);
    const passedCredential = verifyAuthenticationResponse.mock.calls[0][0].credential;
    expect(passedCredential.counter).toBe(0);
    expect(passedCredential.transports).toBeUndefined();
  });

  it('returns false when a concurrent verification already consumed the challenge', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ enabled: 1, secret_data: JSON.stringify(enrolledSecretData({ pendingChallenge: 'x', pendingChallengeExpiresAt: new Date(Date.now() + 60_000).toISOString() })) }],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });

    const provider = new WebAuthnProvider(pool);
    expect(await provider.verifyCode(7, '{}')).toBe(false);
  });
});

describe('WebAuthnProvider.isEnabled', () => {
  it('returns false when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.isEnabled(99)).toBe(false);
  });

  it('returns true when enabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ enabled: 1 }], null]);
    const provider = new WebAuthnProvider(pool);
    expect(await provider.isEnabled(7)).toBe(true);
  });
});
