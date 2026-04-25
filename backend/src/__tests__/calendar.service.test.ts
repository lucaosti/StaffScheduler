/**
 * Calendar service tests (F04).
 *
 * Heavy emphasis on the pure ics builder so we lock the RFC 5545 format
 * down without needing a fixture file. DB orchestrator is exercised on
 * the queueable pool fake.
 */

import {
  buildIcs,
  CalendarEvent,
  CalendarService,
  shiftToEventTimes,
} from '../services/CalendarService';

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

describe('CalendarService.getOrCreateToken', () => {
  it('returns the existing token if one is stored', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ token: 'abc' }], null]);
    const service = new CalendarService(pool);
    expect(await service.getOrCreateToken(7)).toBe('abc');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('creates a new 48-hex-char token when none is stored', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]);
    const service = new CalendarService(pool);
    const token = await service.getOrCreateToken(7);
    expect(token).toMatch(/^[a-f0-9]{48}$/);
  });
});

describe('CalendarService.resolveToken', () => {
  it('returns null on an unknown token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new CalendarService(pool);
    expect(await service.resolveToken('nope')).toBeNull();
  });

  it('returns the user id on a known token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 42 }], null]);
    const service = new CalendarService(pool);
    expect(await service.resolveToken('abc')).toBe(42);
  });
});

describe('CalendarService.buildFeed', () => {
  it('emits an empty calendar when the user has no assignments', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new CalendarService(pool);
    const ics = await service.buildFeed(7);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('renders one VEVENT per assignment row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
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
        },
      ],
      null,
    ]);
    const service = new CalendarService(pool);
    const ics = await service.buildFeed(7);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics).toContain('SUMMARY:Emergency (confirmed)');
    expect(ics).toContain('SUMMARY:Emergency (pending)');
  });
});
