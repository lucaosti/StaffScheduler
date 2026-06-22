/**
 * Unit tests for calendarService.
 *
 * @author Luca Ostinelli
 */

import {
  getOrCreateCalendarToken,
  rotateCalendarToken,
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

describe('getOrCreateCalendarToken', () => {
  it('POSTs to /calendar/token and returns the token', async () => {
    const result = await getOrCreateCalendarToken();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/calendar\/token$/);
    expect(init?.method).toBe('POST');
    expect(result).toEqual({ token: 'tok-abc' });
  });
});

describe('rotateCalendarToken', () => {
  it('POSTs to /calendar/token/rotate and returns the new token', async () => {
    const result = await rotateCalendarToken();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/calendar\/token\/rotate$/);
    expect(init?.method).toBe('POST');
    expect(result).toEqual({ token: 'tok-abc' });
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
