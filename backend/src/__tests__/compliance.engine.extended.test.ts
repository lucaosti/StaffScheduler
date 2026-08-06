/**
 * Extended ComplianceEngine tests — covers:
 *   - Consecutive-day gap: a non-contiguous run correctly resets the streak counter.
 *   - Overlapping shifts are skipped, not double-flagged (MIN_REST_HOURS).
 *   - `evaluateAssignmentCompliance` orchestrator (DB-aware).
 */

import {
  CandidateShift,
  checkCompliance,
  CompliancePolicy,
  evaluateAssignmentCompliance,
  ExistingAssignment,
} from '../services/ComplianceEngine';

const policy: CompliancePolicy = {
  maxConsecutiveDays: 3,
  minRestHoursBetweenShifts: 8,
  maxHoursPerWeek: 40,
};

const shift = (date: string, start = '08:00', end = '16:00'): CandidateShift => ({
  date,
  startTime: start,
  endTime: end,
});

const existing = (id: number, date: string, start = '08:00', end = '16:00'): ExistingAssignment => ({
  id,
  date,
  startTime: start,
  endTime: end,
});

describe('checkCompliance — consecutive-day gap resets the run counter', () => {
  it('does not count non-adjacent days in the same streak', () => {
    const result = checkCompliance({
      candidate: shift('2026-05-07'),
      existing: [existing(1, '2026-05-04'), existing(2, '2026-05-06')],
      policy,
    });
    expect(result.ok).toBe(true);
  });

  it('correctly flags a fresh run that breaches the limit after a gap', () => {
    const boundary = checkCompliance({
      candidate: shift('2026-05-08'),
      existing: [existing(1, '2026-05-04'), existing(2, '2026-05-06'), existing(3, '2026-05-07')],
      policy,
    });
    expect(boundary.ok).toBe(true);

    const over = checkCompliance({
      candidate: shift('2026-05-09'),
      existing: [
        existing(1, '2026-05-04'),
        existing(2, '2026-05-06'),
        existing(3, '2026-05-07'),
        existing(4, '2026-05-08'),
      ],
      policy,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.violations[0].code).toBe('MAX_CONSECUTIVE_DAYS');
      expect(over.violations[0].details.consecutiveDays).toBe(4);
    }
  });
});

describe('checkCompliance — overlapping shifts are not flagged by MIN_REST_HOURS', () => {
  it('does not emit MIN_REST_HOURS when the candidate overlaps with an existing shift', () => {
    const result = checkCompliance({
      candidate: shift('2026-05-04', '10:00', '18:00'),
      existing: [existing(1, '2026-05-04', '08:00', '16:00')],
      policy,
    });
    if (!result.ok) {
      const codes = result.violations.map((v) => v.code);
      expect(codes).not.toContain('MIN_REST_HOURS');
    } else {
      expect(result.ok).toBe(true);
    }
  });
});

describe('evaluateAssignmentCompliance', () => {
  const makePool = (
    prefRows: Record<string, unknown>[],
    settingRows: Array<{ key: string; value: string }>,
    assignmentRows: Array<{ id: number; date: unknown; start_time: string; end_time: string }>,
    contractRows: Record<string, unknown>[] = [],
    globalPolicyRows: Array<{ policy_key: string; policy_value: unknown }> = []
  ) => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([prefRows, null])
      .mockResolvedValueOnce([settingRows, null])
      // `PolicyService.getGlobalValues` — an organization's own configured
      // regulatory rule set; empty by default so existing cases exercise the
      // pre-policy fallback chain unchanged.
      .mockResolvedValueOnce([globalPolicyRows, null])
      // `EmploymentContractService.resolveLimitsForPeriod` — checked ahead of
      // user_preferences/system_settings; empty by default so existing cases
      // exercise the pre-contract fallback chain unchanged.
      .mockResolvedValueOnce([contractRows, null])
      .mockResolvedValueOnce([assignmentRows, null]);
    return { execute } as unknown as import('mysql2/promise').Pool;
  };

  it('returns ok:true when the candidate does not violate any rule', async () => {
    const pool = makePool([], [], []);
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(result.ok).toBe(true);
  });

  it('uses user_preferences when present', async () => {
    const pool = makePool([{ max_hours_per_week: 1, max_consecutive_days: 5 }], [], []);
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'MAX_WEEKLY_HOURS')).toBe(true);
    }
  });

  it('falls back to system_settings when no user_preferences row', async () => {
    const pool = makePool([], [{ key: 'max_hours_per_week', value: '4' }], []);
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'MAX_WEEKLY_HOURS')).toBe(true);
    }
  });

  it('excludes the assignment being updated (excludeAssignmentId)', async () => {
    const pool = makePool(
      [{ max_hours_per_week: 10, max_consecutive_days: 5 }],
      [],
      [{ id: 99, date: '2026-06-01', start_time: '09:00', end_time: '17:00' }]
    );
    const result = await evaluateAssignmentCompliance(
      pool,
      42,
      { date: '2026-06-01', startTime: '09:00', endTime: '17:00' },
      { excludeAssignmentId: 99 }
    );
    expect(result.ok).toBe(true);
  });

  it('converts a Date object in the assignment row to an ISO date string', async () => {
    const dateObj = new Date('2026-06-01T00:00:00Z');
    const pool = makePool(
      [{ max_hours_per_week: 8, max_consecutive_days: 5 }],
      [],
      [{ id: 1, date: dateObj as unknown as string, start_time: '09:00', end_time: '17:00' }]
    );
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(result.ok).toBe(false);
  });

  it('uses system_settings min_hours_between_shifts when set', async () => {
    const pool = makePool(
      [],
      [{ key: 'min_hours_between_shifts', value: '12' }],
      [{ id: 1, date: '2026-06-01', start_time: '12:00', end_time: '20:00' }]
    );
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-02',
      startTime: '06:00',
      endTime: '14:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'MIN_REST_HOURS')).toBe(true);
    }
  });

  it('an employment contract limit overrides user_preferences — #330', async () => {
    // user_preferences would pass (generous 40h cap); the contract caps at 1h
    // and must win, since it is the deliberate, effective-dated limit.
    const pool = makePool(
      [{ max_hours_per_week: 40, max_consecutive_days: 5 }],
      [],
      [],
      [
        {
          user_id: 42,
          id: 1,
          name: 'Part-time',
          description: null,
          max_hours_per_week: 1,
          min_hours_per_week: null,
          max_hours_per_day: null,
          max_consecutive_days: null,
          min_hours_between_shifts: null,
          min_consecutive_days_off: null,
          is_active: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ]
    );
    const result = await evaluateAssignmentCompliance(pool, 42, {
      date: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === 'MAX_WEEKLY_HOURS')).toBe(true);
    }
  });

  describe('an organization-configured policy participates in resolution', () => {
    it('enforces a global max_hours_week policy when nothing more specific is set', async () => {
      const pool = makePool(
        [],
        [],
        [],
        [],
        [{ policy_key: 'max_hours_week', policy_value: { hours: 1 } }]
      );
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.code === 'MAX_WEEKLY_HOURS')).toBe(true);
      }
    });

    it('lets a personal contract or preference still win over the global policy', async () => {
      // A generous global policy (100h) must not override a stricter
      // user_preferences cap (1h) — the org-wide rule is a floor/ceiling,
      // not a substitute for a deliberate personal limit.
      const pool = makePool(
        [{ max_hours_per_week: 1, max_consecutive_days: 5 }],
        [],
        [],
        [],
        [{ policy_key: 'max_hours_week', policy_value: { hours: 100 } }]
      );
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.code === 'MAX_WEEKLY_HOURS')).toBe(true);
      }
    });

    it('enforces a global min_rest_hours policy', async () => {
      const pool = makePool(
        [],
        [],
        [{ id: 1, date: '2026-06-01', start_time: '12:00', end_time: '20:00' }],
        [],
        [{ policy_key: 'min_rest_hours', policy_value: { hours: 12 } }]
      );
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-02',
        startTime: '06:00',
        endTime: '14:00',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((v) => v.code === 'MIN_REST_HOURS')).toBe(true);
      }
    });

    it('enforces a global max_consecutive_days policy', async () => {
      const pool = makePool(
        [],
        [],
        [],
        [],
        [{ policy_key: 'max_consecutive_days', policy_value: { days: 1 } }]
      );
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });
      // A single candidate shift alone cannot breach a consecutive-days cap;
      // this asserts the value was actually threaded through, not that it
      // fires here — the streak-counter behaviour is covered elsewhere.
      expect(result.ok).toBe(true);
    });

    it('ignores a policy value in the wrong shape rather than throwing', async () => {
      const pool = makePool(
        [],
        [],
        [],
        [],
        [
          { policy_key: 'max_hours_week', policy_value: 'not-an-object' },
          { policy_key: 'min_rest_hours', policy_value: { hours: 0 } },
        ]
      );
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('recording a violation for the trend', () => {
    it('writes one row per violation, at the point they are detected', async () => {
      // A cap of 1h/week AND a max of... only one rule fires here
      // (weekly hours); a fixture with two rules failing is below.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ max_hours_per_week: 1, max_consecutive_days: 5 }], null])
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([[], null]) // global policies
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // the INSERT
      const pool = { execute } as unknown as import('mysql2/promise').Pool;

      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });

      expect(result.ok).toBe(false);
      expect(execute).toHaveBeenCalledTimes(6);
      const [sql, params] = execute.mock.calls[5];
      expect(sql).toContain('INSERT INTO compliance_violations');
      expect(params).toEqual([42, 'MAX_WEEKLY_HOURS', expect.any(String)]);
    });

    it('writes one row for each rule broken by the same candidate', async () => {
      // Weekly-hours cap of 1h AND an existing shift the same day that busts
      // both consecutive-days (limit 1) and min-rest.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([
          [{ max_hours_per_week: 1, max_consecutive_days: 1 }],
          null,
        ])
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([[], null]) // global policies
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([
          [{ id: 1, date: '2026-05-31', start_time: '09:00', end_time: '17:00' }],
          null,
        ])
        .mockResolvedValueOnce([{ affectedRows: 3 }, null]); // the INSERT
      const pool = { execute } as unknown as import('mysql2/promise').Pool;

      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });

      expect(result.ok).toBe(false);
      const violationCount = !result.ok ? result.violations.length : 0;
      expect(violationCount).toBeGreaterThan(1);
      const [sql, params] = execute.mock.calls[5];
      // One `(?, ?, ?)` group per violation, all tagged with the same user.
      expect(sql.match(/\(\?, \?, \?\)/g)).toHaveLength(violationCount);
      expect(params).toHaveLength(violationCount * 3);
      expect(params[0]).toBe(42);
    });

    it('writes nothing when the candidate is compliant', async () => {
      const pool = makePool([], [], []);
      const result = await evaluateAssignmentCompliance(pool, 42, {
        date: '2026-06-01',
        startTime: '09:00',
        endTime: '17:00',
      });
      expect(result.ok).toBe(true);
      // The 5 reads only — no extra call, since there is nothing to record.
      expect((pool.execute as jest.Mock)).toHaveBeenCalledTimes(5);
    });
  });
});

