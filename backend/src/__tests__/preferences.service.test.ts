/**
 * PreferencesService unit tests (F07).
 */

import { PreferencesService } from '../services/PreferencesService';

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: 7,
  max_hours_per_week: 40,
  min_hours_per_week: 0,
  max_consecutive_days: 5,
  preferred_shifts: '[1,2]',
  avoid_shifts: '[]',
  notes: null,
  updated_at: '2026-04-26T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('PreferencesService.getByUserId', () => {
  it('returns null when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new PreferencesService(pool);
    expect(await service.getByUserId(7)).toBeNull();
  });

  it('parses JSON arrays from preferred_shifts and avoid_shifts', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ preferred_shifts: '[3,4]', avoid_shifts: '[5]' })], null]);
    const service = new PreferencesService(pool);
    const out = await service.getByUserId(7);
    expect(out?.preferredShifts).toEqual([3, 4]);
    expect(out?.avoidShifts).toEqual([5]);
  });

  it('handles malformed JSON gracefully (defaults to empty array)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ preferred_shifts: '{not json}' })], null]);
    const service = new PreferencesService(pool);
    const out = await service.getByUserId(7);
    expect(out?.preferredShifts).toEqual([]);
  });
});

describe('PreferencesService.upsert', () => {
  it('rejects negative max hours per week', async () => {
    const { pool } = makePool();
    const service = new PreferencesService(pool);
    await expect(service.upsert(7, { maxHoursPerWeek: -1 })).rejects.toThrow(/positive/);
  });

  it('rejects when min > max', async () => {
    const { pool } = makePool();
    const service = new PreferencesService(pool);
    await expect(
      service.upsert(7, { maxHoursPerWeek: 30, minHoursPerWeek: 40 })
    ).rejects.toThrow(/cannot exceed/);
  });

  it('rejects out-of-range maxConsecutiveDays', async () => {
    const { pool } = makePool();
    const service = new PreferencesService(pool);
    await expect(service.upsert(7, { maxConsecutiveDays: 0 })).rejects.toThrow(/between 1 and 14/);
    await expect(service.upsert(7, { maxConsecutiveDays: 99 })).rejects.toThrow(/between 1 and 14/);
  });

  it('inserts a fresh row with defaults when none exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null]) // first getByUserId
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]) // INSERT
      .mockResolvedValueOnce([[buildRow()], null]); // refreshed get

    const service = new PreferencesService(pool);
    const result = await service.upsert(7, { maxHoursPerWeek: 40 });
    expect(result.userId).toBe(7);
    expect(execute.mock.calls[1][0]).toMatch(/INSERT INTO user_preferences/);
  });

  it('updates an existing row in place', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ max_hours_per_week: 36 })], null]);

    const service = new PreferencesService(pool);
    const result = await service.upsert(7, { maxHoursPerWeek: 36 });
    expect(result.maxHoursPerWeek).toBe(36);
    expect(execute.mock.calls[1][0]).toMatch(/UPDATE user_preferences/);
  });
});
