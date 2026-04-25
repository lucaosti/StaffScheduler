/**
 * Pure-function tests for the ComplianceEngine (F19).
 *
 * Each rule is exercised with three shapes: well-under, exact-boundary, and
 * over-the-limit. Boundary tests pin down the inclusivity decisions
 * (`maxConsecutiveDays = 5` allows 5, rejects 6).
 */

import {
  CandidateShift,
  CompliancePolicy,
  DEFAULT_COMPLIANCE_POLICY,
  ExistingAssignment,
  checkCompliance,
} from '../services/ComplianceEngine';

const makeShift = (
  date: string,
  startTime = '08:00',
  endTime = '16:00'
): CandidateShift => ({ date, startTime, endTime });

const makeExisting = (
  id: number,
  date: string,
  startTime = '08:00',
  endTime = '16:00'
): ExistingAssignment => ({ id, date, startTime, endTime });

const tightPolicy: CompliancePolicy = {
  maxConsecutiveDays: 5,
  minRestHoursBetweenShifts: 8,
  maxHoursPerWeek: 40,
};

describe('checkCompliance — passes when there are no violations', () => {
  it('accepts a candidate with no existing assignments', () => {
    const result = checkCompliance({
      candidate: makeShift('2026-05-04'),
      existing: [],
      policy: DEFAULT_COMPLIANCE_POLICY,
    });
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('accepts a candidate that lands exactly on the consecutive-day boundary', () => {
    // Existing: Mon-Thu (4 days). Candidate: Fri (the 5th). Limit 5 → accepted.
    const result = checkCompliance({
      candidate: makeShift('2026-05-08'),
      existing: [
        makeExisting(1, '2026-05-04'),
        makeExisting(2, '2026-05-05'),
        makeExisting(3, '2026-05-06'),
        makeExisting(4, '2026-05-07'),
      ],
      policy: tightPolicy,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkCompliance — MAX_CONSECUTIVE_DAYS', () => {
  it('rejects when the candidate would create a 6-day run with limit 5', () => {
    const result = checkCompliance({
      candidate: makeShift('2026-05-09'),
      existing: [
        makeExisting(1, '2026-05-04'),
        makeExisting(2, '2026-05-05'),
        makeExisting(3, '2026-05-06'),
        makeExisting(4, '2026-05-07'),
        makeExisting(5, '2026-05-08'),
      ],
      policy: tightPolicy,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]).toMatchObject({
        code: 'MAX_CONSECUTIVE_DAYS',
        details: { consecutiveDays: 6, limit: 5 },
      });
    }
  });
});

describe('checkCompliance — MIN_REST_HOURS', () => {
  it('rejects when only 4 hours separate the candidate from an existing shift', () => {
    // Existing 22:00-06:00 (overnight ending 2026-05-05 06:00). Candidate
    // starts at 10:00 same day → 4h rest, limit 8h.
    const result = checkCompliance({
      candidate: makeShift('2026-05-05', '10:00', '18:00'),
      existing: [makeExisting(1, '2026-05-04', '22:00', '06:00')],
      policy: tightPolicy,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]).toMatchObject({
        code: 'MIN_REST_HOURS',
        details: { restHours: 4, limit: 8, conflictingDate: '2026-05-04' },
      });
    }
  });

  it('accepts when rest is exactly at the 8-hour boundary', () => {
    const result = checkCompliance({
      candidate: makeShift('2026-05-05', '14:00', '22:00'),
      existing: [makeExisting(1, '2026-05-05', '00:00', '06:00')],
      policy: tightPolicy,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkCompliance — MAX_WEEKLY_HOURS', () => {
  it('rejects when the rolling 7-day window would exceed the limit', () => {
    // Five existing 8h shifts in the same week + an 8h candidate = 48h, limit 40.
    const existing = [
      makeExisting(1, '2026-05-04'),
      makeExisting(2, '2026-05-05'),
      makeExisting(3, '2026-05-06'),
      makeExisting(4, '2026-05-07'),
      makeExisting(5, '2026-05-08'),
    ];
    const result = checkCompliance({
      candidate: makeShift('2026-05-09'),
      existing,
      policy: tightPolicy,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.violations.map((v) => v.code);
      expect(codes).toContain('MAX_WEEKLY_HOURS');
      const weekly = result.violations.find((v) => v.code === 'MAX_WEEKLY_HOURS')!;
      expect(weekly.details).toMatchObject({ totalHours: 48, limit: 40 });
    }
  });

  it('accepts when total hours are below the limit', () => {
    const result = checkCompliance({
      candidate: makeShift('2026-05-04'),
      existing: [makeExisting(1, '2026-05-05')],
      policy: tightPolicy,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkCompliance — multiple violations are surfaced together', () => {
  it('returns every violating rule when several apply', () => {
    // 6 consecutive days + 4h rest + 56h weekly all simultaneously.
    const existing = [
      makeExisting(1, '2026-05-04', '08:00', '16:00'),
      makeExisting(2, '2026-05-05', '08:00', '16:00'),
      makeExisting(3, '2026-05-06', '08:00', '16:00'),
      makeExisting(4, '2026-05-07', '08:00', '16:00'),
      makeExisting(5, '2026-05-08', '08:00', '16:00'),
      makeExisting(6, '2026-05-09', '00:00', '06:00'),
    ];
    const result = checkCompliance({
      candidate: makeShift('2026-05-09', '10:00', '18:00'),
      existing,
      policy: tightPolicy,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.violations.map((v) => v.code).sort();
      expect(codes).toEqual(['MAX_CONSECUTIVE_DAYS', 'MAX_WEEKLY_HOURS', 'MIN_REST_HOURS']);
    }
  });
});
