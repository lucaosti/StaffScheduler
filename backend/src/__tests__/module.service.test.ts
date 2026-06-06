/**
 * ModuleService unit tests.
 *
 * Covers:
 *   - list: returns all modules mapped correctly
 *   - getByCode: returns null when not found
 *   - getByCode: returns module when found
 *   - setEnabled: throws when module not found (affectedRows === 0)
 *   - setEnabled(enable): updates DB, invalidates cache, returns updated module
 *   - setEnabled(disable): updates DB, invalidates cache, returns updated module
 *   - isEnabled: returns true when DB row has is_enabled = 1
 *   - isEnabled: returns false when DB row has is_enabled = 0
 *   - isEnabled: returns false when code is not in DB
 *   - isEnabled: uses cache after first call (single DB round-trip for two checks)
 *   - isEnabled: cache is invalidated after setEnabled call
 */

import { ModuleService } from '../services/ModuleService';

// ──────────────────────────────────────────────────────────────────────────────
// Pool mock helper
// ──────────────────────────────────────────────────────────────────────────────

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as unknown as import('mysql2/promise').Pool, execute };
};

// Shared row fixtures
const enabledRow = {
  id: 1,
  code: 'delegation',
  name: 'Delegation',
  description: 'Delegation feature',
  is_enabled: 1,
  updated_at: new Date('2026-01-01'),
};

const disabledRow = {
  id: 2,
  code: 'approvals',
  name: 'Approvals',
  description: null,
  is_enabled: 0,
  updated_at: new Date('2026-01-01'),
};

// ──────────────────────────────────────────────────────────────────────────────
// list
// ──────────────────────────────────────────────────────────────────────────────

describe('ModuleService.list', () => {
  it('returns all modules with correct field mapping', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[enabledRow, disabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.list();

    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('delegation');
    expect(result[0].isEnabled).toBe(true);
    expect(result[1].code).toBe('approvals');
    expect(result[1].isEnabled).toBe(false);
    expect(result[1].description).toBeNull();
  });

  it('returns an empty array when the modules table is empty', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ModuleService(pool);
    const result = await svc.list();

    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getByCode
// ──────────────────────────────────────────────────────────────────────────────

describe('ModuleService.getByCode', () => {
  it('returns null when the code is not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ModuleService(pool);
    const result = await svc.getByCode('nonexistent');

    expect(result).toBeNull();
  });

  it('returns the module when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[enabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.getByCode('delegation');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.name).toBe('Delegation');
    expect(result!.isEnabled).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// setEnabled
// ──────────────────────────────────────────────────────────────────────────────

describe('ModuleService.setEnabled', () => {
  it('throws when the module code does not exist (affectedRows = 0)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    const svc = new ModuleService(pool);
    await expect(svc.setEnabled('ghost', true)).rejects.toThrow(/Module not found/);
  });

  it('enables a module, invalidates the cache, and returns the updated module', async () => {
    const { pool, execute } = makePool();
    // UPDATE
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    // getByCode after update
    execute.mockResolvedValueOnce([[enabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.setEnabled('delegation', true);

    expect(execute.mock.calls[0][0]).toContain('UPDATE modules SET is_enabled');
    expect(execute.mock.calls[0][1]).toEqual([1, 'delegation']);
    expect(result.isEnabled).toBe(true);
  });

  it('disables a module, invalidates the cache, and returns the updated module', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[{ ...disabledRow, code: 'delegation', is_enabled: 0 }], null]);

    const svc = new ModuleService(pool);
    const result = await svc.setEnabled('delegation', false);

    expect(execute.mock.calls[0][1]).toEqual([0, 'delegation']);
    expect(result.isEnabled).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isEnabled
// ──────────────────────────────────────────────────────────────────────────────

describe('ModuleService.isEnabled', () => {
  it('returns true when the module row has is_enabled = 1', async () => {
    const { pool, execute } = makePool();
    // buildCache calls list()
    execute.mockResolvedValueOnce([[enabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.isEnabled('delegation');

    expect(result).toBe(true);
  });

  it('returns false when the module row has is_enabled = 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[disabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.isEnabled('approvals');

    expect(result).toBe(false);
  });

  it('returns false when the code is not in the DB', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[enabledRow], null]);

    const svc = new ModuleService(pool);
    const result = await svc.isEnabled('does_not_exist');

    expect(result).toBe(false);
  });

  it('uses the in-process cache — only one DB round-trip for multiple calls', async () => {
    const { pool, execute } = makePool();
    // list() called once to build cache
    execute.mockResolvedValueOnce([[enabledRow, disabledRow], null]);

    const svc = new ModuleService(pool);
    await svc.isEnabled('delegation');
    await svc.isEnabled('approvals');
    await svc.isEnabled('delegation');

    // execute should have been called exactly once (cache hit for calls 2 and 3)
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the cache after setEnabled invalidates it', async () => {
    const { pool, execute } = makePool();
    // First isEnabled → buildCache via list()
    execute.mockResolvedValueOnce([[enabledRow], null]);
    // setEnabled UPDATE
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    // setEnabled getByCode
    execute.mockResolvedValueOnce([[{ ...enabledRow, is_enabled: 0 }], null]);
    // Second isEnabled → cache was nulled → buildCache via list() again
    execute.mockResolvedValueOnce([[{ ...enabledRow, is_enabled: 0 }], null]);

    const svc = new ModuleService(pool);
    const before = await svc.isEnabled('delegation');
    expect(before).toBe(true);

    await svc.setEnabled('delegation', false);

    const after = await svc.isEnabled('delegation');
    expect(after).toBe(false);

    // Total execute calls: list (1) + UPDATE (1) + getByCode (1) + list (1) = 4
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
