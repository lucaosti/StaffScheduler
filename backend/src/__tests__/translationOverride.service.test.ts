/**
 * Translation override CRUD, and the org-scoped resolution
 * `GET /api/i18n/overrides` reads through.
 *
 * The behaviour worth testing here is the NULL-fallback resolution order —
 * the organization's own row wins over the platform-wide one, same shape as
 * `SsoProviderService.listPublic` — and the upsert-by-(organizationName,
 * locale) semantics the unique key enforces.
 *
 * @author Luca Ostinelli
 */

import { TranslationOverrideService } from '../services/TranslationOverrideService';
import { NotFoundError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const overrideRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  organization_name: null,
  locale: 'en',
  overrides: JSON.stringify({ 'auth.signIn': 'Sign in' }),
  created_at: new Date('2026-08-01T00:00:00Z'),
  updated_at: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

describe('TranslationOverrideService.list', () => {
  it('returns every row, most specific first per the SQL ordering', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [overrideRow(), overrideRow({ id: 2, organization_name: 'Acme', overrides: JSON.stringify({ a: 'b' }) })],
      undefined,
    ]);

    const rows = await new TranslationOverrideService(pool).list();
    expect(rows).toHaveLength(2);
    expect(rows[1].organizationName).toBe('Acme');
    expect(rows[1].overrides).toEqual({ a: 'b' });
  });
});

describe('TranslationOverrideService.resolveForOrganization', () => {
  it('returns the organization-specific row when one exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [overrideRow({ organization_name: 'Acme', overrides: JSON.stringify({ a: 'b' }) })],
      undefined,
    ]);

    const result = await new TranslationOverrideService(pool).resolveForOrganization('Acme', 'en');
    expect(result).toEqual({ a: 'b' });
  });

  it('falls back to the platform-wide row when the organization has none', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);

    const result = await new TranslationOverrideService(pool).resolveForOrganization('Acme', 'en');
    expect(result).toEqual({ 'auth.signIn': 'Sign in' });
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain('organization_name IS NULL OR organization_name = ?');
    expect(params).toEqual(['en', 'Acme']);
  });

  it('returns an empty map when neither row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], undefined]);

    const result = await new TranslationOverrideService(pool).resolveForOrganization(null, 'en');
    expect(result).toEqual({});
  });
});

describe('TranslationOverrideService.getById', () => {
  it('returns null for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], undefined]);
    await expect(new TranslationOverrideService(pool).getById(99)).resolves.toBeNull();
  });

  it('accepts the JSON column already parsed into an object by the driver', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[overrideRow({ overrides: { a: 'b' } })], undefined]);
    const found = await new TranslationOverrideService(pool).getById(1);
    expect(found?.overrides).toEqual({ a: 'b' });
  });
});

describe('TranslationOverrideService.create', () => {
  it('inserts a row and returns it, parsing the JSON column', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, undefined]);
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);

    const created = await new TranslationOverrideService(pool).create({
      organizationName: null,
      locale: 'en',
      overrides: { 'auth.signIn': 'Sign in' },
    });

    expect(created.overrides).toEqual({ 'auth.signIn': 'Sign in' });
    expect(created.organizationName).toBeNull();
  });

  it('upserts on the (organizationName, locale) unique key', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, undefined]);
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);

    await new TranslationOverrideService(pool).create({
      organizationName: 'Acme',
      locale: 'en',
      overrides: { a: 'b' },
    });

    const [sql] = execute.mock.calls[0];
    expect(String(sql)).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('throws when the row cannot be re-read right after the insert', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, undefined]);
    execute.mockResolvedValueOnce([[], undefined]);

    await expect(
      new TranslationOverrideService(pool).create({ organizationName: null, locale: 'en', overrides: {} })
    ).rejects.toThrow('Failed to create translation override');
  });
});

describe('TranslationOverrideService.update', () => {
  it('404s when there is nothing to update', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], undefined]);
    await expect(new TranslationOverrideService(pool).update(99, {})).rejects.toThrow(NotFoundError);
  });

  it('updates the overrides map and returns the refreshed row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    execute.mockResolvedValueOnce([[overrideRow({ overrides: JSON.stringify({ a: 'c' }) })], undefined]);

    const updated = await new TranslationOverrideService(pool).update(1, { a: 'c' });
    expect(updated.overrides).toEqual({ a: 'c' });
  });

  it('throws when the row cannot be re-read right after the update', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    execute.mockResolvedValueOnce([[], undefined]);

    await expect(new TranslationOverrideService(pool).update(1, { a: 'c' })).rejects.toThrow(
      'Failed to refresh translation override'
    );
  });
});

describe('TranslationOverrideService.remove', () => {
  it('404s when there is nothing to delete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], undefined]);
    await expect(new TranslationOverrideService(pool).remove(99)).rejects.toThrow(NotFoundError);
  });

  it('deletes the row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[overrideRow()], undefined]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    await expect(new TranslationOverrideService(pool).remove(1)).resolves.toBeUndefined();
  });
});
