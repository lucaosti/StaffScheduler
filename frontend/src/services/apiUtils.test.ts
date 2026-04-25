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
  beforeEach(() => {
    localStorage.clear();
  });

  it('always sets Content-Type', () => {
    const headers = getAuthHeaders() as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('attaches a Bearer token only when one is in localStorage', () => {
    expect((getAuthHeaders() as Record<string, string>).Authorization).toBeUndefined();

    localStorage.setItem('token', 'abc.def.ghi');
    const headers = getAuthHeaders() as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc.def.ghi');
  });
});
