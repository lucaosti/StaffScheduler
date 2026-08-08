/**
 * Unit tests for the apiUtils helpers.
 */

import { ApiError, getAuthHeaders, handleResponse } from './apiUtils';
import * as mobileAuthStorage from './mobileAuthStorage';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('handleResponse', () => {
  it('returns the parsed envelope on a 2xx response', async () => {
    const result = await handleResponse<number>(
      jsonResponse(200, { success: true, data: 42 })
    );
    expect(result).toEqual({ success: true, data: 42 });
  });

  it('throws an ApiError carrying the server message and status on a 4xx response', async () => {
    const promise = handleResponse(
      jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Schedule missing' } })
    );

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 404, message: 'Schedule missing' });
  });

  it('falls back to a generic message when the body has no error details', async () => {
    const res = new Response('', { status: 500 });
    await expect(handleResponse(res)).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('500'),
    });
  });
});

describe('getAuthHeaders', () => {
  it('always sets Content-Type', () => {
    const init = getAuthHeaders();
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('includes credentials: include for cookie-based auth', () => {
    const init = getAuthHeaders();
    expect(init.credentials).toBe('include');
  });

  it('does not include an Authorization header', () => {
    const init = getAuthHeaders();
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  describe('on the Capacitor mobile platform', () => {
    const isNativePlatformMock = jest.spyOn(mobileAuthStorage, 'isNativePlatform');
    const getCachedAccessTokenMock = jest.spyOn(mobileAuthStorage, 'getCachedAccessToken');

    afterEach(() => jest.restoreAllMocks());

    it('attaches Authorization: Bearer when a token is cached', () => {
      isNativePlatformMock.mockReturnValue(true);
      getCachedAccessTokenMock.mockReturnValue('cached-access-token');

      const init = getAuthHeaders();
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer cached-access-token');
    });

    it('adds no Authorization header when native but no token is cached yet', () => {
      isNativePlatformMock.mockReturnValue(true);
      getCachedAccessTokenMock.mockReturnValue(null);

      const init = getAuthHeaders();
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('never attaches Authorization on the web platform even if a token happened to be cached (regression guard)', () => {
      isNativePlatformMock.mockReturnValue(false);
      getCachedAccessTokenMock.mockReturnValue('should-be-ignored');

      const init = getAuthHeaders();
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  it('merges extraHeaders on top of the defaults', () => {
    const init = getAuthHeaders({ 'X-Client-Type': 'mobile' });
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Client-Type']).toBe('mobile');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
