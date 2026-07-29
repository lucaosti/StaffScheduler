/**
 * Unit tests for calendarService.
 *
 * @author Luca Ostinelli
 */

import {
  createCalendarToken,
  listCalendarTokens,
  revokeCalendarToken,
  buildFeedUrl,
} from './calendarService';

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(
    okJson({ success: true, data: { token: 'tok-abc' } })
  ) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('createCalendarToken', () => {
  it('POSTs the label to /calendar/tokens and returns the raw token', async () => {
    const result = await createCalendarToken('Phone');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/calendar\/tokens$/);
    expect(init?.method).toBe('POST');
    // The label travels because revoking the right one later requires knowing
    // which is which, and creation is the only moment the caller knows.
    expect(JSON.parse(String(init?.body))).toEqual({ label: 'Phone' });
    expect(result).toEqual({ token: 'tok-abc' });
  });
});

describe('listCalendarTokens', () => {
  it('GETs /calendar/tokens', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okJson({ success: true, data: [{ id: 1, label: 'Phone', createdAt: 'x', revokedAt: null }] })
    );
    const tokens = await listCalendarTokens();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/calendar\/tokens$/);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(tokens).toHaveLength(1);
  });

  it('returns an empty list rather than undefined', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ success: true }));
    // Callers map over this; `undefined` would be a crash rather than "none".
    await expect(listCalendarTokens()).resolves.toEqual([]);
  });
});

describe('revokeCalendarToken', () => {
  it('DELETEs the one token', async () => {
    await revokeCalendarToken(3);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/calendar\/tokens\/3$/);
    expect(init?.method).toBe('DELETE');
  });
});

describe('buildFeedUrl', () => {
  it('builds a URL containing the encoded token', () => {
    const url = buildFeedUrl('my token=special');
    expect(url).toContain('/calendar/feed.ics');
    expect(url).toContain(encodeURIComponent('my token=special'));
  });

  it('returns a string', () => {
    expect(typeof buildFeedUrl('x')).toBe('string');
  });
});
