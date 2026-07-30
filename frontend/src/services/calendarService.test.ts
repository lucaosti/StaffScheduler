/**
 * Unit tests for calendarService.
 *
 * @author Luca Ostinelli
 */

import { API_BASE_URL } from './apiUtils';
import {
  buildAggregateFeedUrl,
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

/**
 * The aggregate feed URL.
 *
 * What matters here is what is ABSENT: no scope travels in the URL. The server
 * resolves the token owner's org-unit scope on every fetch, so a link cannot
 * widen its own reach and stops publishing a unit when its owner's authority
 * over that unit ends. A builder that "helpfully" pinned the scope at creation
 * time would undo that.
 */
describe('buildAggregateFeedUrl', () => {
  it('carries the token and nothing else by default', () => {
    expect(buildAggregateFeedUrl('abc')).toBe(
      `${API_BASE_URL}/calendar/aggregate.ics?token=abc`
    );
  });

  it('joins id lists with commas, which is what the server parses', () => {
    const url = buildAggregateFeedUrl('abc', { departmentId: [3, 4], roleId: [2] });
    expect(url).toContain('departmentId=3%2C4');
    expect(url).toContain('roleId=2');
  });

  it('omits an empty list rather than sending a blank filter', () => {
    // `departmentId=` is neither a filter nor the absence of one, and the query
    // schema rejects it.
    const url = buildAggregateFeedUrl('abc', { departmentId: [], userId: [] });
    expect(url).not.toContain('departmentId');
    expect(url).not.toContain('userId');
  });

  it('carries an explicit range, including zero days of history', () => {
    const url = buildAggregateFeedUrl('abc', { pastDays: 0, futureDays: 90 });
    expect(url).toContain('pastDays=0');
    expect(url).toContain('futureDays=90');
  });

  it('escapes a token with URL-significant characters', () => {
    expect(buildAggregateFeedUrl('a b&c')).toContain('token=a+b%26c');
  });

  it('never puts a scope in the URL', () => {
    const url = buildAggregateFeedUrl('abc', { departmentId: [1] });
    expect(url).not.toContain('orgUnit');
    expect(url).not.toContain('scope');
  });
});
