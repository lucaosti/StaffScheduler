/**
 * Calendar service tests (F04).
 *
 * Heavy emphasis on the pure ics builder so we lock the RFC 5545 format
 * down without needing a fixture file. DB orchestrator is exercised on
 * the queueable pool fake.
 */

import { createHash } from 'crypto';
import {
  buildIcs,
  CalendarEvent,
  CalendarService,
  shiftToEventTimes,
} from '../services/CalendarService';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const sampleEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'assignment-1@staffscheduler',
  summary: 'Emergency (confirmed)',
  description: 'Demo schedule',
  start: new Date('2026-05-01T07:00:00Z'),
  end: new Date('2026-05-01T15:00:00Z'),
  location: 'Emergency',
  ...overrides,
});

describe('shiftToEventTimes', () => {
  it('rolls overnight shifts into the next day', () => {
    const { start, end } = shiftToEventTimes('2026-05-01', '22:00', '06:00');
    expect(end.getTime() - start.getTime()).toBe(8 * 60 * 60 * 1000);
    expect(end.toISOString().slice(0, 10)).toBe('2026-05-02');
  });

  it('handles HH:mm:ss inputs', () => {
    const { start, end } = shiftToEventTimes('2026-05-01', '07:00:00', '15:00:00');
    expect(end.getTime() - start.getTime()).toBe(8 * 60 * 60 * 1000);
  });
});

describe('buildIcs', () => {
  it('produces a valid VCALENDAR envelope with CRLF line endings', () => {
    const ics = buildIcs([sampleEvent()]);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Staff Scheduler//EN');
    expect(ics.split('\r\n').length).toBeGreaterThan(1);
  });

  it('escapes special characters in summary, description, and location', () => {
    const ics = buildIcs([
      sampleEvent({
        summary: 'Shift; with, commas',
        description: 'multi\nline; here',
        location: 'A, B',
      }),
    ]);
    expect(ics).toContain('SUMMARY:Shift\\; with\\, commas');
    expect(ics).toContain('DESCRIPTION:multi\\nline\\; here');
    expect(ics).toContain('LOCATION:A\\, B');
  });

  it('includes one VEVENT per event', () => {
    const ics = buildIcs([sampleEvent({ uid: 'a' }), sampleEvent({ uid: 'b' })]);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect((ics.match(/END:VEVENT/g) || []).length).toBe(2);
  });
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

/**
 * Feed tokens.
 *
 * The behaviour that matters is that creating one is ADDITIVE. The old shape
 * held a single token per person keyed on `user_id`, so obtaining a new one
 * overwrote the hash and silently broke every device already subscribed — the
 * opposite of what a calendar subscription is for.
 */
describe('CalendarService.createToken', () => {
  it('returns a 48-hex-char raw token and stores only its digest', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }, null]);

    const created = await new CalendarService(pool).createToken(7, 'Phone');

    expect(created.token).toMatch(/^[a-f0-9]{48}$/);
    expect(created.id).toBe(5);
    // The raw value exists in this response and nowhere else, ever.
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual([7, 'Phone', sha256(created.token)]);
    expect(params).not.toContain(created.token);
  });

  it('inserts rather than overwriting, so existing feeds keep working', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 6, affectedRows: 1 }, null]);

    await new CalendarService(pool).createToken(7, 'Laptop');

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain('INSERT INTO calendar_tokens');
    // The old implementation used ON DUPLICATE KEY UPDATE on a user_id primary
    // key, which is exactly how adding a second device broke the first.
    expect(sql).not.toContain('ON DUPLICATE KEY');
  });
});

describe('CalendarService.listTokens', () => {
  it('never returns the raw value, because it is not stored', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 1, label: 'Phone', created_at: 'x', revoked_at: null }],
      null,
    ]);

    const tokens = await new CalendarService(pool).listTokens(7);

    expect(tokens[0]).toEqual({ id: 1, label: 'Phone', createdAt: 'x', revokedAt: null });
    expect(JSON.stringify(tokens)).not.toContain('token_hash');
  });

  it('includes revoked tokens', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 1, label: 'Lost phone', created_at: 'x', revoked_at: 'y' }],
      null,
    ]);

    const tokens = await new CalendarService(pool).listTokens(7);
    // A feed that vanished from the list is indistinguishable from one that
    // was never created, so a revoked row stays visible with its date.
    expect(tokens[0].revokedAt).toBe('y');
    expect(String(execute.mock.calls[0][0])).not.toContain('revoked_at IS NULL');
  });
});

describe('CalendarService.revokeToken', () => {
  it('scopes the update by owner in the statement itself', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    expect(await new CalendarService(pool).revokeToken(7, 3)).toBe(true);

    const [sql, params] = execute.mock.calls[0];
    // Checking ownership beforehand would leave a window between the check and
    // the write; one statement leaves none.
    expect(String(sql)).toContain('user_id = ?');
    expect(params).toEqual([3, 7]);
  });

  it('reports a miss rather than a revocation that did not happen', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    // Unknown id, someone else's, or already revoked — the caller learns only
    // that nothing changed.
    expect(await new CalendarService(pool).revokeToken(7, 999)).toBe(false);
  });

  it('does not re-revoke an already revoked token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    await new CalendarService(pool).revokeToken(7, 3);
    // Otherwise the recorded revocation time would move every time someone
    // clicked again, losing when access actually stopped.
    expect(String(execute.mock.calls[0][0])).toContain('revoked_at IS NULL');
  });
});

describe('CalendarService.resolveToken', () => {
  it('returns null on an unknown token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new CalendarService(pool);
    expect(await service.resolveToken('nope')).toBeNull();
    // Must query by hash, not by the raw token.
    expect(execute.mock.calls[0][1][0]).toBe(sha256('nope'));
  });

  it('returns the user id on a known token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 42 }], null]);
    const service = new CalendarService(pool);
    expect(await service.resolveToken('abc')).toBe(42);
    expect(execute.mock.calls[0][1][0]).toBe(sha256('abc'));
  });
});

describe('CalendarService.buildFeed (per-user, with on-call + colleagues)', () => {
  it('emits an empty calendar when the user has no assignments', async () => {
    const { pool, execute } = makePool();
    // Service order: shifts → colleagues (skipped if shifts empty) → on-call
    execute
      .mockResolvedValueOnce([[], null]) // shift assignments
      .mockResolvedValueOnce([[], null]); // on-call assignments
    const service = new CalendarService(pool);
    const ics = await service.buildFeed(7);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('renders one VEVENT per assignment row, with colleagues in DESCRIPTION', async () => {
    const { pool, execute } = makePool();
    // Service order: shifts query → loadColleagues query → on-call query.
    execute
      .mockResolvedValueOnce([
        [
          {
            assignment_id: 1,
            status: 'confirmed',
            shift_id: 10,
            date: '2026-05-01',
            start_time: '07:00',
            end_time: '15:00',
            notes: 'Full ward',
            schedule_name: 'May Schedule',
            department_name: 'Emergency',
            shift_updated: '2026-04-26T12:00:00Z',
          },
          {
            assignment_id: 2,
            status: 'pending',
            shift_id: 11,
            date: '2026-05-02',
            start_time: '15:00',
            end_time: '23:00',
            notes: null,
            schedule_name: 'May Schedule',
            department_name: 'Emergency',
            shift_updated: '2026-04-26T12:00:00Z',
          },
        ],
        null,
      ])
      .mockResolvedValueOnce([
        [
          { shift_id: 10, full_name: 'Bruno Demo' },
          { shift_id: 10, full_name: 'Carla Demo' },
        ],
        null,
      ]) // colleagues
      .mockResolvedValueOnce([[], null]); // on-call (none)
    const service = new CalendarService(pool);
    const ics = await service.buildFeed(7);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics).toContain('SUMMARY:Emergency (confirmed)');
    expect(ics).toContain('SUMMARY:Emergency (pending)');
    expect(ics).toContain('Working with: Bruno Demo\\, Carla Demo');
  });

  it('emits a CATEGORIES:ON-CALL line for on-call periods', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null]) // no shifts
      .mockResolvedValueOnce([
        [
          {
            assignment_id: 5,
            period_id: 9,
            date: '2026-05-01',
            start_time: '20:00',
            end_time: '08:00',
            notes: 'pager #1',
            department_name: 'Emergency',
            period_updated: '2026-04-26T12:00:00Z',
          },
        ],
        null,
      ]);
    const service = new CalendarService(pool);
    const ics = await service.buildFeed(7);
    expect(ics).toContain('CATEGORIES:ON-CALL');
    expect(ics).toContain('SUMMARY:Emergency (on-call)');
  });

  it('builds a department feed with assignee names in DESCRIPTION', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          shift_id: 10,
          date: '2026-05-01',
          start_time: '07:00',
          end_time: '15:00',
          notes: '',
          schedule_name: 'May',
          department_name: 'Emergency',
          shift_updated: '2026-04-26T12:00:00Z',
          assignees: 'Anna Demo,Bruno Demo',
        },
      ],
      null,
    ]);
    const service = new CalendarService(pool);
    const out = await service.buildDepartmentFeed(3);
    expect(out.body).toContain('Assigned: Anna Demo\\, Bruno Demo');
    expect(out.etag).toMatch(/^"[a-f0-9]+"$/);
  });
});
