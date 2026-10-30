/**
 * WorkingTimeLimitsService: how the layers combine.
 *
 * Two rules are pinned here, both found in review of #838/#883:
 *   - the global policy is a ceiling that a contract or preference may only
 *     tighten — every `user_preferences` row carries 40 h / 5 days by default,
 *     so "the preference wins" loosened any stricter policy for everyone;
 *   - a contract covering only part of the period governs only that part, so
 *     the tighter of it and what applies without it is used.
 *
 * The pool answers by query fragment, so the four reads may come in any order.
 */

import { WorkingTimeLimitsService } from '../services/WorkingTimeLimitsService';

type Rows = Array<Record<string, unknown>>;

const poolWith = (fixtures: { preferences?: Rows; settings?: Rows; policies?: Rows; contracts?: Rows }) => {
  const execute = jest.fn(async (sql: string) => {
    if (sql.includes('FROM user_preferences')) return [fixtures.preferences ?? [], null];
    if (sql.includes('FROM system_settings')) return [fixtures.settings ?? [], null];
    if (sql.includes('FROM policies')) return [fixtures.policies ?? [], null];
    if (sql.includes('user_employment_contracts')) return [fixtures.contracts ?? [], null];
    throw new Error(`unexpected query: ${sql}`);
  });
  return { execute } as unknown as import('mysql2/promise').Pool;
};

const contract = (limits: Record<string, number | null>, from = '2026-10-01', to: string | null = null) => ({
  user_id: 7,
  assignment_from: from,
  assignment_to: to,
  id: 1,
  name: 'c',
  is_active: 1,
  max_hours_per_week: null,
  min_hours_per_week: null,
  max_hours_per_day: null,
  max_consecutive_days: null,
  min_hours_between_shifts: null,
  min_consecutive_days_off: null,
  min_days_off_per_period: null,
  ...limits,
});

const policy = (key: string, value: Record<string, number>) => ({ policy_key: key, policy_value: JSON.stringify(value) });

const resolve = async (fixtures: Parameters<typeof poolWith>[0]) =>
  (await new WorkingTimeLimitsService(poolWith(fixtures)).resolve([7], '2026-10-01', '2026-10-31')).limits.get(7)!;

describe('the global policy is a ceiling', () => {
  it('is not loosened by the 40 h / 5-day values every preferences row carries', async () => {
    const limits = await resolve({
      preferences: [{ user_id: 7, max_hours_per_week: 40, max_consecutive_days: 5 }],
      policies: [policy('max_hours_week', { hours: 36 }), policy('max_consecutive_days', { days: 4 })],
    });
    expect(limits).toMatchObject({ maxHoursPerWeek: 36, maxConsecutiveDays: 4 });
  });

  it('is not loosened by a contract either', async () => {
    const limits = await resolve({
      contracts: [contract({ max_hours_per_week: 48, min_hours_between_shifts: 8 })],
      policies: [policy('max_hours_week', { hours: 36 }), policy('min_rest_hours', { hours: 11 })],
    });
    expect(limits).toMatchObject({ maxHoursPerWeek: 36, minRestHoursBetweenShifts: 11 });
  });

  it('is tightened by a stricter preference or contract', async () => {
    const limits = await resolve({
      preferences: [{ user_id: 7, max_hours_per_week: 20, max_consecutive_days: 3 }],
      contracts: [contract({ min_hours_between_shifts: 12 })],
      policies: [
        policy('max_hours_week', { hours: 36 }),
        policy('max_consecutive_days', { days: 4 }),
        policy('min_rest_hours', { hours: 11 }),
      ],
    });
    expect(limits).toEqual({ maxHoursPerWeek: 20, maxConsecutiveDays: 3, minRestHoursBetweenShifts: 12 });
  });

  it("lets a contract matching the policy stand over the preference row's 40 h / 5-day defaults", async () => {
    // The EU preset (48 h, 6 days) with full-time 48 h / 6-day contracts: the
    // default preferences row must not quietly tighten everyone to 40 h / 5.
    // The contract and the preference are one personal layer, contract first;
    // only the policy sits above it.
    const limits = await resolve({
      preferences: [{ user_id: 7, max_hours_per_week: 40, max_consecutive_days: 5 }],
      contracts: [contract({ max_hours_per_week: 48, max_consecutive_days: 6 })],
      policies: [policy('max_hours_week', { hours: 48 }), policy('max_consecutive_days', { days: 6 })],
    });
    expect(limits).toMatchObject({ maxHoursPerWeek: 48, maxConsecutiveDays: 6 });
  });

  it('still applies a stricter preference under the policy when no contract states the limit', async () => {
    const limits = await resolve({
      preferences: [{ user_id: 7, max_hours_per_week: 40, max_consecutive_days: 5 }],
      policies: [policy('max_hours_week', { hours: 48 })],
    });
    expect(limits.maxHoursPerWeek).toBe(40);
  });

  it('leaves the old order in place when no policy exists: contract, preference, setting', async () => {
    const limits = await resolve({
      preferences: [{ user_id: 7, max_hours_per_week: 40, max_consecutive_days: null }],
      settings: [
        { key: 'max_hours_per_week', value: '30' },
        { key: 'max_consecutive_days', value: '6' },
      ],
      contracts: [contract({ min_hours_between_shifts: 9 })],
    });
    expect(limits).toEqual({ maxHoursPerWeek: 40, maxConsecutiveDays: 6, minRestHoursBetweenShifts: 9 });
  });
});

describe('a contract covering only part of the period', () => {
  it('cannot loosen the days it does not cover', async () => {
    // A 48 h contract that ends mid-month, with the setting at 30 h for the
    // rest of it: the month is planned at 30 h.
    const limits = await resolve({
      contracts: [contract({ max_hours_per_week: 48 }, '2026-09-01', '2026-10-15')],
      settings: [{ key: 'max_hours_per_week', value: '30' }],
    });
    expect(limits.maxHoursPerWeek).toBe(30);
  });

  it('governs the whole period when it covers it', async () => {
    const limits = await resolve({
      contracts: [contract({ max_hours_per_week: 48 }, '2026-09-01', '2026-10-31')],
      settings: [{ key: 'max_hours_per_week', value: '30' }],
    });
    expect(limits.maxHoursPerWeek).toBe(48);
  });

  it('counts back-to-back contracts as covering the period, and a gap as not', async () => {
    const contiguous = await resolve({
      contracts: [
        contract({ max_hours_per_week: 48 }, '2026-09-01', '2026-10-15'),
        contract({ max_hours_per_week: 45 }, '2026-10-16', null),
      ],
      settings: [{ key: 'max_hours_per_week', value: '30' }],
    });
    expect(contiguous.maxHoursPerWeek).toBe(45);

    const gap = await resolve({
      contracts: [
        contract({ max_hours_per_week: 48 }, '2026-09-01', '2026-10-15'),
        contract({ max_hours_per_week: 45 }, '2026-10-17', null),
      ],
      settings: [{ key: 'max_hours_per_week', value: '30' }],
    });
    expect(gap.maxHoursPerWeek).toBe(30);
  });

  it('starting after the period begins does not cover it', async () => {
    const limits = await resolve({
      contracts: [contract({ min_hours_between_shifts: 6 }, '2026-10-10', null)],
    });
    // Before the 10th the 8 h default applies, and it is the tighter.
    expect(limits.minRestHoursBetweenShifts).toBe(8);
  });
});
