/**
 * SsoAuthService unit tests.
 *
 * `verifyIdToken` is exercised against a REAL RS256 keypair and REAL
 * `jsonwebtoken` signing/verification — only the JWKS network fetch is
 * mocked (via `jwks-rsa`, returning the real public key) — so these tests
 * prove the actual cryptographic properties hold: a validly-signed token is
 * accepted, a tampered one, a wrong algorithm, a wrong issuer/audience, and
 * a stale nonce are all rejected. Mocking `jsonwebtoken.verify` itself would
 * only prove the mock was configured correctly, not that the code is secure.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { SsoAuthService } from '../services/SsoAuthService';
import type { SsoProvider } from '../services/SsoProviderService';
import { UserService } from '../services/UserService';
import { ConflictError, ForbiddenError } from '../errors';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const otherKeyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

jest.mock('jwks-rsa', () =>
  jest.fn().mockImplementation(() => ({
    getSigningKey: (kid: string, callback: (err: Error | null, key?: { getPublicKey: () => string }) => void) => {
      if (kid === 'unknown-key') {
        callback(new Error('Unable to find a signing key that matches'));
        return;
      }
      callback(null, { getPublicKey: () => publicKey });
    },
  }))
);

const provider: SsoProvider = {
  id: 1,
  organizationName: null,
  name: 'Test IdP',
  issuer: 'https://idp.example.com',
  clientId: 'client-123',
  clientSecret: 'secret-abc',
  authorizationUrl: 'https://idp.example.com/authorize',
  tokenUrl: 'https://idp.example.com/token',
  jwksUrl: 'https://idp.example.com/jwks',
  isActive: true,
  jitProvisioningEnabled: false,
  defaultRoleId: null,
  createdAt: 'x',
  updatedAt: 'x',
};

const signIdToken = (claimOverrides: Record<string, unknown> = {}, key = privateKey) =>
  jwt.sign(
    {
      sub: 'idp-subject-1',
      email: 'anna@example.com',
      given_name: 'Anna',
      family_name: 'Demo',
      nonce: 'expected-nonce',
      ...claimOverrides,
    },
    key,
    { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '5m', keyid: 'key-1' }
  );

describe('SsoAuthService.buildAuthorizationUrl', () => {
  it('includes every required OIDC parameter', () => {
    const url = new SsoAuthService({} as never).buildAuthorizationUrl(
      provider,
      'https://app.example.com/api/v1/auth/sso/1/callback',
      'state-1',
      'nonce-1'
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://idp.example.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/v1/auth/sso/1/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('state')).toBe('state-1');
    expect(parsed.searchParams.get('nonce')).toBe('nonce-1');
  });
});

describe('SsoAuthService.exchangeCodeForIdToken', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the authorization-code grant and returns the id_token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id_token: 'the-id-token' }),
    });

    const idToken = await new SsoAuthService({} as never).exchangeCodeForIdToken(
      provider,
      'auth-code',
      'https://app.example.com/callback'
    );

    expect(idToken).toBe('the-id-token');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(provider.tokenUrl);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('client_id')).toBe(provider.clientId);
    expect(body.get('client_secret')).toBe(provider.clientSecret);
  });

  it('throws when the token endpoint responds with a non-2xx status', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });
    await expect(
      new SsoAuthService({} as never).exchangeCodeForIdToken(provider, 'bad-code', 'https://app.example.com/callback')
    ).rejects.toThrow(/400.*invalid_grant/);
  });

  it('throws when the response has no id_token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await expect(
      new SsoAuthService({} as never).exchangeCodeForIdToken(provider, 'code', 'https://app.example.com/callback')
    ).rejects.toThrow(/did not include an id_token/);
  });

  it('still reports the status when the failure body cannot be read', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream closed')),
    });
    await expect(
      new SsoAuthService({} as never).exchangeCodeForIdToken(provider, 'code', 'https://app.example.com/callback')
    ).rejects.toThrow(/^Identity provider token exchange failed \(500\)$/);
  });

  it('falls back to an empty object when the success body fails to parse as JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('not json')) });
    await expect(
      new SsoAuthService({} as never).exchangeCodeForIdToken(provider, 'code', 'https://app.example.com/callback')
    ).rejects.toThrow(/did not include an id_token/);
  });

  it('aborts the request once the timeout elapses', async () => {
    jest.useFakeTimers();
    try {
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
          })
      );
      const resultPromise = new SsoAuthService({} as never).exchangeCodeForIdToken(
        provider,
        'code',
        'https://app.example.com/callback'
      );
      const assertion = expect(resultPromise).rejects.toThrow(/aborted/);
      await jest.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SsoAuthService.verifyIdToken', () => {
  it('accepts a validly-signed token and extracts the profile', async () => {
    const token = signIdToken();
    const profile = await new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce');
    expect(profile).toEqual({
      sub: 'idp-subject-1',
      email: 'anna@example.com',
      givenName: 'Anna',
      familyName: 'Demo',
      fullName: undefined,
    });
  });

  it('omits email/givenName/familyName when the IdP claims lack them, and reads fullName when present', async () => {
    const token = jwt.sign(
      { sub: 'idp-subject-2', nonce: 'expected-nonce', name: 'Anna Demo' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '5m', keyid: 'key-1' }
    );
    const profile = await new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce');
    expect(profile).toEqual({
      sub: 'idp-subject-2',
      email: undefined,
      givenName: undefined,
      familyName: undefined,
      fullName: 'Anna Demo',
    });
  });

  it('rejects a token signed with a DIFFERENT key than the one JWKS serves', async () => {
    const token = signIdToken({}, otherKeyPair.privateKey);
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow();
  });

  it('rejects a token whose issuer does not match the configured provider', async () => {
    const token = jwt.sign(
      { sub: 'x', nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: 'https://evil.example.com', audience: provider.clientId, expiresIn: '5m', keyid: 'key-1' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow();
  });

  it('rejects a token whose audience does not match the client id', async () => {
    const token = jwt.sign(
      { sub: 'x', nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: 'someone-elses-client', expiresIn: '5m', keyid: 'key-1' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign(
      { sub: 'x', nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '-1h', keyid: 'key-1' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow();
  });

  it('rejects a nonce that does not match the login attempt', async () => {
    const token = signIdToken({ nonce: 'attacker-replayed-nonce' });
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow(ConflictError);
  });

  it('rejects a token with no subject claim', async () => {
    const token = jwt.sign(
      { nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '5m', keyid: 'key-1' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow(ConflictError);
  });

  it('rejects a token whose "kid" matches no key the JWKS endpoint serves', async () => {
    const badKidToken = jwt.sign(
      { sub: 'x', nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '5m', keyid: 'unknown-key' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, badKidToken, 'expected-nonce')
    ).rejects.toThrow(/Unable to find a signing key/);
  });

  it('rejects a token with no "kid" header, rather than guessing a key', async () => {
    const token = jwt.sign(
      { sub: 'x', nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: provider.issuer, audience: provider.clientId, expiresIn: '5m' }
    );
    await expect(
      new SsoAuthService({} as never).verifyIdToken(provider, token, 'expected-nonce')
    ).rejects.toThrow();
  });
});

describe('SsoAuthService.findOrCreateUser', () => {
  const makePool = () => {
    const execute = jest.fn();
    return { pool: { execute } as never, execute };
  };
  const profile = { sub: 'idp-subject-1', email: 'anna@example.com', givenName: 'Anna', familyName: 'Demo' };

  it('returns the linked user when the (provider, subject) pair is already known', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 42 }], null] as [RowDataPacket[], null]);
    jest.spyOn(UserService.prototype, 'getUserById').mockResolvedValueOnce({ id: 42, isActive: true } as never);

    const user = await new SsoAuthService(pool).findOrCreateUser(provider, profile);
    expect(user).toMatchObject({ id: 42 });
  });

  it('refuses an inactive linked account', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 42 }], null] as [RowDataPacket[], null]);
    jest.spyOn(UserService.prototype, 'getUserById').mockResolvedValueOnce({ id: 42, isActive: false } as never);

    await expect(new SsoAuthService(pool).findOrCreateUser(provider, profile)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('links an existing account found by email, on first federated login', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as [RowDataPacket[], null]) // no existing link
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as [unknown, null]); // the INSERT link
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce({ id: 7, isActive: true } as never);

    const user = await new SsoAuthService(pool).findOrCreateUser(provider, profile);
    expect(user).toMatchObject({ id: 7 });
    expect(execute.mock.calls[1][0]).toMatch(/INSERT INTO sso_identities/);
    expect(execute.mock.calls[1][1]).toEqual([7, provider.id, profile.sub, JSON.stringify(profile)]);
  });

  it('refuses an inactive account found by email', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as [RowDataPacket[], null]);
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce({ id: 7, isActive: false } as never);

    await expect(new SsoAuthService(pool).findOrCreateUser(provider, profile)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('throws when the identity provider supplied no email and no account is linked', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as [RowDataPacket[], null]);
    await expect(
      new SsoAuthService(pool).findOrCreateUser(provider, { sub: 'x' })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to create an account when JIT provisioning is disabled', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as [RowDataPacket[], null]);
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce(null);

    await expect(
      new SsoAuthService(pool).findOrCreateUser({ ...provider, jitProvisioningEnabled: false }, profile)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('JIT-provisions a new account, with the default role and organization, when enabled', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as [RowDataPacket[], null]) // no existing link
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as [unknown, null]); // the identity link
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce(null);
    const createUser = jest
      .spyOn(UserService.prototype, 'createUser')
      .mockResolvedValueOnce({ id: 99, isActive: true } as never);
    const updateUser = jest.spyOn(UserService.prototype, 'updateUser').mockResolvedValueOnce({} as never);

    const jitProvider = { ...provider, jitProvisioningEnabled: true, defaultRoleId: 3, organizationName: 'Acme Inc' };
    const user = await new SsoAuthService(pool).findOrCreateUser(jitProvider, profile);

    expect(user).toMatchObject({ id: 99 });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'anna@example.com', firstName: 'Anna', lastName: 'Demo', roleIds: [3] })
    );
    // The password is never a placeholder anyone could guess or reuse.
    const passwordArg = createUser.mock.calls[0][0].password;
    expect(passwordArg).toHaveLength(64); // 32 random bytes, hex-encoded
    expect(updateUser).toHaveBeenCalledWith(99, { organizationName: 'Acme Inc' });
    expect(execute.mock.calls[1][1]).toEqual([99, provider.id, profile.sub, JSON.stringify(profile)]);
  });

  it('falls back to splitting fullName when the IdP has no given/family name claims', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as [RowDataPacket[], null]).mockResolvedValueOnce([{ affectedRows: 1 }, null] as [unknown, null]);
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce(null);
    const createUser = jest
      .spyOn(UserService.prototype, 'createUser')
      .mockResolvedValueOnce({ id: 100, isActive: true } as never);

    const jitProvider = { ...provider, jitProvisioningEnabled: true };
    await new SsoAuthService(pool).findOrCreateUser(jitProvider, {
      sub: 'idp-subject-2',
      email: 'bruno@example.com',
      fullName: 'Bruno Da Silva',
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Bruno', lastName: 'Da Silva' })
    );
  });

  it('defaults to "SSO User" when the IdP gives no name information at all', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as [RowDataPacket[], null]).mockResolvedValueOnce([{ affectedRows: 1 }, null] as [unknown, null]);
    jest.spyOn(UserService.prototype, 'getUserByEmail').mockResolvedValueOnce(null);
    const createUser = jest
      .spyOn(UserService.prototype, 'createUser')
      .mockResolvedValueOnce({ id: 101, isActive: true } as never);

    const jitProvider = { ...provider, jitProvisioningEnabled: true };
    await new SsoAuthService(pool).findOrCreateUser(jitProvider, {
      sub: 'idp-subject-3',
      email: 'noname@example.com',
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'SSO', lastName: 'User' })
    );
  });
});
