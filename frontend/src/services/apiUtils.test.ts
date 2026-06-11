/**
 * Unit tests for the apiUtils helpers.
 */

import { ApiError, getAuthHeaders, handleResponse } from './apiUtils';

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
});
