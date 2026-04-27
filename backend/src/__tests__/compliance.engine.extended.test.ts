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
    assignmentRows: Array<{ id: number; date: unknown; start_time: string; end_time: string }>
  ) => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([prefRows, null])
      .mockResolvedValueOnce([settingRows, null])
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
});

