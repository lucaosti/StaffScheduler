/**
 * SystemSettingsService unit tests.
 */

import { SystemSettingsService } from '../services/SystemSettingsService';

const buildSetting = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  category: 'general',
  key: 'currency',
  value: 'EUR',
  type: 'string',
  defaultValue: 'EUR',
  description: 'Default currency',
  isEditable: 1,
  createdAt: '2026-04-26',
  updatedAt: '2026-04-26',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

describe('SystemSettingsService.getAllSettings', () => {
  it('returns rows ordered by category and key', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSetting()], null]);
    const service = new SystemSettingsService(pool);
    const rows = await service.getAllSettings();
    expect(rows).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toMatch(/ORDER BY category/);
  });
});

describe('SystemSettingsService.getSettingsByCategory', () => {
  it('passes the category in the WHERE clause', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new SystemSettingsService(pool);
    await service.getSettingsByCategory('scheduling');
    expect(execute.mock.calls[0][1]).toEqual(['scheduling']);
  });
});

describe('SystemSettingsService.getSetting', () => {
  it('throws when the setting does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new SystemSettingsService(pool);
    await expect(service.getSetting('general', 'nope')).rejects.toThrow(/not found/);
  });

  it('returns the value, falling back to defaultValue when value is empty', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ value: '', defaultValue: 'EUR' }], null]);
    const service = new SystemSettingsService(pool);
    const out = await service.getSetting('general', 'currency');
    expect(out).toBe('EUR');
  });
});

describe('SystemSettingsService.updateSetting', () => {
  it('rolls back on a non-editable setting', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1, isEditable: 0 }], null]);
    const service = new SystemSettingsService(pool);
    await expect(service.updateSetting('general', 'currency', 'USD')).rejects.toThrow(/not editable/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('updates the row and returns the persisted setting', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, isEditable: 1 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildSetting({ value: 'USD' })], null]);
    const service = new SystemSettingsService(pool);
    const updated = await service.updateSetting('general', 'currency', 'USD');
    expect((updated as { value: string }).value).toBe('USD');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('SystemSettingsService.resetSetting', () => {
  it('writes the default value back into value', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ defaultValue: 'EUR' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildSetting()], null]);
    const service = new SystemSettingsService(pool);
    await service.resetSetting('general', 'currency');
    // Second SQL call is the UPDATE; verify the value parameter is the default.
    expect(conn.execute.mock.calls[1][1]).toEqual(['EUR', 'general', 'currency']);
  });
});

describe('SystemSettingsService convenience getters', () => {
  it('getCurrency returns default EUR when the row is missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // getSetting empty
    const service = new SystemSettingsService(pool);
    expect(await service.getCurrency()).toBe('EUR');
  });

  it('getTimePeriod returns default monthly when the row is missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new SystemSettingsService(pool);
    expect(await service.getTimePeriod()).toBe('monthly');
  });
});

describe('SystemSettingsService.initializeDefaults', () => {
  it('inserts each default if missing and commits', async () => {
    const { pool, conn } = makePool();
    // Each default triggers a SELECT (missing) + INSERT. There are several
    // defaults; we generously return [] for every SELECT and { affectedRows: 1 }
    // for every INSERT.
    conn.execute.mockImplementation(async (sql: string) => {
      if (/^SELECT/i.test(sql)) return [[], null];
      return [{ affectedRows: 1 }, null];
    });
    const service = new SystemSettingsService(pool);
    await service.initializeDefaults();
    expect(conn.commit).toHaveBeenCalled();
  });
});
