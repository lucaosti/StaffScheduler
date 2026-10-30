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

  it('falls back to a generic message when a 4xx body has no error details', async () => {
    const res = new Response('', { status: 400 });
    await expect(handleResponse(res)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('400'),
    });
  });

  // #895: whatever a 5xx body says, the message every call site shows is the
  // friendly fallback; the request id is kept so the UI can quote it.
  it('replaces a 5xx message with the friendly fallback and keeps the request id', async () => {
    const promise = handleResponse(
      jsonResponse(500, {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Incorrect arguments to mysqld_stmt_execute', requestId: 'req-123' },
      })
    );
    await expect(promise).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: 'req-123',
      message: expect.stringContaining('req-123'),
    });
    await expect(promise).rejects.toHaveProperty(
      'message',
      expect.not.stringContaining('mysqld')
    );
  });

  it('takes the request id from the X-Request-Id header when the body has none', async () => {
    const res = new Response('<html>Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'hdr-456' },
    });
    await expect(handleResponse(res)).rejects.toMatchObject({
      status: 502,
      requestId: 'hdr-456',
      message: expect.stringMatching(/Something went wrong on our side.*hdr-456/),
    });
  });

  it('gives a 5xx with no request id the fallback without a reference', async () => {
    const err = await handleResponse(new Response('', { status: 503 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).requestId).toBeUndefined();
    expect((err as ApiError).message).toBe(
      'Something went wrong on our side. Please try again in a moment.'
    );
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
