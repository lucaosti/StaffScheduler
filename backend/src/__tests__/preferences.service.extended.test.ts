/**
 * Extended PreferencesService tests — covers:
 *   - `minHoursPerWeek < 0` → 'must be non-negative'.
 *   - parseJsonArray: handling of null, direct arrays, and non-array JSON values.
 */

import { PreferencesService } from '../services/PreferencesService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

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

describe('PreferencesService.upsert — minHoursPerWeek validation', () => {
  it('rejects a negative minHoursPerWeek', async () => {
    const { pool } = makePool();
    const service = new PreferencesService(pool);
    await expect(service.upsert(7, { minHoursPerWeek: -1 })).rejects.toThrow(/must be non-negative/);
  });

  it('accepts minHoursPerWeek of 0 (boundary)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ min_hours_per_week: 0 })], null]);

    const service = new PreferencesService(pool);
    const result = await service.upsert(7, { minHoursPerWeek: 0 });
    expect(result.minHoursPerWeek).toBe(0);
  });
});

describe('parseJsonArray — non-array/non-string fallback', () => {
  it('returns [] for a null preferred_shifts value', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ preferred_shifts: null, avoid_shifts: null })], null]);

    const service = new PreferencesService(pool);
    const out = await service.getByUserId(7);
    expect(out?.preferredShifts).toEqual([]);
    expect(out?.avoidShifts).toEqual([]);
  });

  it('returns [] for an already-parsed array value (direct array from DB)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ preferred_shifts: [10, 20], avoid_shifts: [] })], null]);

    const service = new PreferencesService(pool);
    const out = await service.getByUserId(7);
    expect(out?.preferredShifts).toEqual([10, 20]);
    expect(out?.avoidShifts).toEqual([]);
  });

  it('returns [] when the JSON string parses to a non-array (e.g. an object)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ preferred_shifts: '{"a":1}', avoid_shifts: '42' })], null]);

    const service = new PreferencesService(pool);
    const out = await service.getByUserId(7);
    expect(out?.preferredShifts).toEqual([]);
    expect(out?.avoidShifts).toEqual([]);
  });
});

