/**
 * Extended SystemSettingsService coverage:
 *   - error bubbling on read methods
 *   - getSetting "not found" + value vs defaultValue selection
 *   - updateSetting "not found" + non-editable + happy path
 *   - resetSetting "not found" + happy path
 *   - getCurrency / getTimePeriod default fallbacks + setters bubbling
 *   - initializeDefaults happy + rollback path
 *
 * @author Luca Ostinelli
 */

import { SystemSettingsService } from '../services/SystemSettingsService';

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

describe('SystemSettingsService read methods', () => {
  it('getAllSettings + getSettingsByCategory bubble errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom1')).mockRejectedValueOnce(new Error('boom2'));
    const svc = new SystemSettingsService(pool);
    await expect(svc.getAllSettings()).rejects.toThrow(/boom1/);
    await expect(svc.getSettingsByCategory('general')).rejects.toThrow(/boom2/);
  });

  it('getSetting throws on missing + returns value or defaultValue', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[{ value: 'EUR', defaultValue: 'USD' }], null])
      .mockResolvedValueOnce([[{ value: null, defaultValue: 'USD' }], null]);
    const svc = new SystemSettingsService(pool);
    await expect(svc.getSetting('general', 'currency')).rejects.toThrow(/not found/);
    expect(await svc.getSetting('general', 'currency')).toBe('EUR');
    expect(await svc.getSetting('general', 'currency')).toBe('USD');
  });
});

describe('SystemSettingsService.updateSetting paths', () => {
  it('not found / not editable / happy path', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new SystemSettingsService(pool);
    await expect(svc.updateSetting('a', 'b', 'c')).rejects.toThrow(/not found/);

    conn.execute.mockResolvedValueOnce([[{ id: 1, isEditable: 0 }], null]);
    await expect(svc.updateSetting('a', 'b', 'c')).rejects.toThrow(/not editable/);

    conn.execute
      .mockResolvedValueOnce([[{ id: 1, isEditable: 1 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[{ id: 1, value: 'c' }], null]);
    expect((await svc.updateSetting('a', 'b', 'c')).value).toBe('c');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('SystemSettingsService.resetSetting paths', () => {
  it('not found / happy path', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new SystemSettingsService(pool);
    await expect(svc.resetSetting('a', 'b')).rejects.toThrow(/not found/);

    conn.execute
      .mockResolvedValueOnce([[{ defaultValue: 'EUR' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[{ id: 1, value: 'EUR' }], null]);
    expect((await svc.resetSetting('a', 'b')).value).toBe('EUR');
  });
});

describe('SystemSettingsService convenience getters/setters', () => {
  it('getCurrency / getTimePeriod fall back on errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('y'));
    const svc = new SystemSettingsService(pool);
    expect(await svc.getCurrency()).toBe('EUR');
    expect(await svc.getTimePeriod()).toBe('monthly');
  });

  it('setCurrency / setTimePeriod re-throw on update errors', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new SystemSettingsService(pool);
    await expect(svc.setCurrency('EUR')).rejects.toThrow(/not found/);

    conn.execute.mockResolvedValueOnce([[], null]);
    await expect(svc.setTimePeriod('monthly')).rejects.toThrow(/not found/);
  });
});

describe('SystemSettingsService.initializeDefaults', () => {
  it('inserts each default and commits', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);
    const svc = new SystemSettingsService(pool);
    await svc.initializeDefaults();
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back on insert failure', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new SystemSettingsService(pool);
    await expect(svc.initializeDefaults()).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});
