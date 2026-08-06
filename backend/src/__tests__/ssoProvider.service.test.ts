/**
 * SsoProviderService unit tests.
 */

import { SsoProviderService } from '../services/SsoProviderService';
import { NotFoundError } from '../errors';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const providerRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  organization_name: null,
  name: 'Company Google Workspace',
  issuer: 'https://accounts.google.com',
  client_id: 'client-123',
  client_secret: 'secret-abc',
  authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_url: 'https://oauth2.googleapis.com/token',
  jwks_url: 'https://www.googleapis.com/oauth2/v3/certs',
  is_active: 1,
  jit_provisioning_enabled: 0,
  default_role_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('SsoProviderService.list', () => {
  it('maps every column, including the client secret', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[providerRow()], null] as Tuple);
    const providers = await new SsoProviderService(pool).list();
    expect(providers).toHaveLength(1);
    expect(providers[0].clientSecret).toBe('secret-abc');
    expect(providers[0].jitProvisioningEnabled).toBe(false);
  });
});

describe('SsoProviderService.listPublic', () => {
  it('returns only id and name, never the secret', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 1, name: 'Company Google Workspace' }], null] as Tuple);
    const providers = await new SsoProviderService(pool).listPublic(null);
    expect(providers).toEqual([{ id: 1, name: 'Company Google Workspace' }]);
    expect(providers[0]).not.toHaveProperty('clientSecret');
  });

  it('scopes the query to the caller organization plus platform-wide providers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    await new SsoProviderService(pool).listPublic('Acme Inc');
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('organization_name IS NULL OR organization_name = ?');
    expect(params).toEqual(['Acme Inc']);
  });
});

describe('SsoProviderService.getById', () => {
  it('returns null for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    expect(await new SsoProviderService(pool).getById(99)).toBeNull();
  });
});

describe('SsoProviderService.create', () => {
  it('inserts and re-reads the created provider', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[providerRow({ id: 5 })], null] as Tuple);

    const created = await new SsoProviderService(pool).create({
      name: 'Company Google Workspace',
      issuer: 'https://accounts.google.com',
      clientId: 'client-123',
      clientSecret: 'secret-abc',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    });

    expect(created.id).toBe(5);
    // jitProvisioningEnabled defaults to false, never assumed true.
    const [, params] = execute.mock.calls[0];
    expect(params[8]).toBe(false);
  });

  it('throws if the row cannot be re-read right after insert (defensive guard)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    await expect(
      new SsoProviderService(pool).create({
        name: 'x',
        issuer: 'https://idp.example.com',
        clientId: 'c',
        clientSecret: 's',
        authorizationUrl: 'https://idp.example.com/authorize',
        tokenUrl: 'https://idp.example.com/token',
        jwksUrl: 'https://idp.example.com/jwks',
      })
    ).rejects.toThrow(/Failed to create SSO provider/);
  });
});

describe('SsoProviderService.update', () => {
  it('throws NotFoundError for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    await expect(new SsoProviderService(pool).update(99, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('keeps existing values for fields the patch omits', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[providerRow()], null] as Tuple) // current
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[providerRow({ name: 'Renamed' })], null] as Tuple);

    await new SsoProviderService(pool).update(1, { name: 'Renamed' });

    const [, params] = execute.mock.calls[1];
    expect(params[0]).toBe('Renamed');
    // issuer unchanged
    expect(params[1]).toBe('https://accounts.google.com');
  });

  it('throws if the row cannot be re-read right after update (defensive guard)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[providerRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    await expect(new SsoProviderService(pool).update(1, { name: 'x' })).rejects.toThrow(
      /Failed to refresh SSO provider/
    );
  });

  it('can clear defaultRoleId back to null explicitly', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[providerRow({ default_role_id: 3 })], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[providerRow({ default_role_id: null })], null] as Tuple);

    await new SsoProviderService(pool).update(1, { defaultRoleId: null });

    const [, params] = execute.mock.calls[1];
    expect(params[9]).toBeNull();
  });
});

describe('SsoProviderService.remove', () => {
  it('throws NotFoundError for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    await expect(new SsoProviderService(pool).remove(99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes an existing provider', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[providerRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);
    await new SsoProviderService(pool).remove(1);
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM sso_providers/);
  });
});
