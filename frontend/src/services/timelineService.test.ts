/**
 * Unit tests for timelineService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { getTimeline, getTimelineSources } from './timelineService';

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errJson = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true, data: [] })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('getTimeline', () => {
  it('GETs /timeline with the given query params', async () => {
    await getTimeline({ from: '2026-01-01', to: '2026-01-31' } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/timeline\?/);
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-01-31');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getTimeline({} as never)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getTimelineSources', () => {
  it('GETs /timeline/sources', async () => {
    await getTimelineSources();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/timeline\/sources$/);
  });
});
