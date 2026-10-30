/**
 * Session recovery in the typed client (#842).
 *
 * The session used to be kept alive by a timer alone: an access token that
 * expired anyway (a laptop waking from sleep, a background tab whose timer the
 * browser throttled, a `JWT_EXPIRES_IN` shorter than the timer) turned every
 * request into a 401 the user could only escape by reloading. The client now
 * refreshes once and retries. These run the real client and the real
 * `authService.refreshToken` against MSW, so the single-flight guarantee is
 * the production one, not a stub's.
 */

import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { apiClient, onSessionExpired } from './client';
import '../services/authService';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api/v1';

const expired = (code = 'INVALID_TOKEN') =>
  HttpResponse.json({ success: false, error: { code, message: 'Invalid or expired token' } }, { status: 401 });

let refreshCalls = 0;
let sessionValid = false;

const withSessionHandlers = (refreshResponse: () => Response) => {
  server.use(
    http.post(`${API_URL}/auth/refresh`, () => {
      refreshCalls++;
      return refreshResponse();
    }),
    http.get(`${API_URL}/departments`, () =>
      sessionValid ? HttpResponse.json({ success: true, data: [{ id: 1, name: 'ER' }] }) : expired()
    )
  );
};

const refreshOk = () => {
  sessionValid = true;
  return HttpResponse.json({ success: true, data: { user: { id: 1 } } });
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  refreshCalls = 0;
  sessionValid = false;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('apiClient — an expired access token', () => {
  it('refreshes once and retries the request', async () => {
    withSessionHandlers(refreshOk);

    const response = await apiClient.get<unknown[], '/departments'>('/departments');

    expect(response.data).toEqual([{ id: 1, name: 'ER' }]);
    expect(refreshCalls).toBe(1);
  });

  it('shares one refresh between concurrent 401s', async () => {
    withSessionHandlers(refreshOk);

    const results = await Promise.all([
      apiClient.get<unknown[], '/departments'>('/departments'),
      apiClient.get<unknown[], '/departments'>('/departments'),
      apiClient.get<unknown[], '/departments'>('/departments'),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('also recovers when the browser already dropped the expired cookie', async () => {
    server.use(
      http.post(`${API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return refreshOk();
      }),
      http.get(`${API_URL}/departments`, () =>
        sessionValid ? HttpResponse.json({ success: true, data: [] }) : expired('MISSING_TOKEN')
      )
    );

    await expect(apiClient.get('/departments')).resolves.toMatchObject({ success: true });
    expect(refreshCalls).toBe(1);
  });

  it('reports the session as ended, and surfaces the 401, when the refresh fails', async () => {
    withSessionHandlers(() =>
      HttpResponse.json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'no' } }, { status: 401 })
    );
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(apiClient.get('/departments')).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  /**
   * Review of #842: any refresh failure used to end the session, so a 502
   * during a rolling deploy or a dropped connection signed everyone out.
   * Only a definitive refusal ends it; a transient failure is the request's
   * error, and the next request tries again.
   */
  it.each([
    ['a 503 during a deploy', () => HttpResponse.json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }, { status: 503 })],
    ['a dropped connection', () => HttpResponse.error()],
  ])('keeps the session when the refresh fails transiently (%s)', async (_label, response) => {
    withSessionHandlers(response as () => Response);
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(apiClient.get('/departments')).rejects.toBeDefined();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('reports a refused refresh once, however many requests were waiting on it', async () => {
    withSessionHandlers(() =>
      HttpResponse.json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'no' } }, { status: 401 })
    );
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);

    await Promise.allSettled([
      apiClient.get('/departments'),
      apiClient.get('/departments'),
      apiClient.get('/departments'),
    ]);

    expect(refreshCalls).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('retries only once: a second 401 after a successful refresh is returned as is', async () => {
    server.use(
      http.post(`${API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json({ success: true, data: { user: { id: 1 } } });
      }),
      http.get(`${API_URL}/departments`, () => expired())
    );

    await expect(apiClient.get('/departments')).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
  });

  it('does not refresh on a 401 that is not about the session', async () => {
    server.use(
      http.post(`${API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return refreshOk();
      }),
      http.get(`${API_URL}/departments`, () =>
        HttpResponse.json({ success: false, error: { code: 'TOTP_REQUIRED', message: 'code' } }, { status: 401 })
      )
    );

    await expect(apiClient.get('/departments')).rejects.toMatchObject({ code: 'TOTP_REQUIRED' });
    expect(refreshCalls).toBe(0);
  });

  // #841 re-review: logout's push cleanup must never refresh — by then the
  // cookie in the jar may already be the next user's.
  it('does not refresh a request that opts out of session recovery', async () => {
    withSessionHandlers(refreshOk);

    await expect(
      apiClient.get('/departments', { sessionRecovery: false })
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(0);
  });

  it('does not refresh on the auth endpoints themselves', async () => {
    server.use(
      http.post(`${API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return expired();
      }),
      http.get(`${API_URL}/auth/verify`, () => expired())
    );

    await expect(apiClient.get('/auth/verify')).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(0);
  });
});
