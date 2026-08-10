/**
 * Unit tests for preferencesService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { getMyPreferences, updateMyPreferences } from './preferencesService';

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
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true, data: {} })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('getMyPreferences', () => {
  it('GETs /preferences/me', async () => {
    await getMyPreferences();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/preferences\/me$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(401, 'UNAUTHORIZED', 'no session'));
    await expect(getMyPreferences()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('updateMyPreferences', () => {
  it('PUTs the input to /preferences/me', async () => {
    const input = { preferredShifts: [1, 2], avoidShifts: [3] } as never;
    await updateMyPreferences(input);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/preferences\/me$/);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('propagates ApiError on a validation failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(400, 'VALIDATION_ERROR', 'bad input'));
    await expect(updateMyPreferences({} as never)).rejects.toBeInstanceOf(ApiError);
  });
});
