/**
 * The Capacitor mobile-client branch of the auth flow.
 *
 * `Capacitor.isNativePlatform()` is mocked per test case to drive the two
 * branches: the mobile branch (mocked `true`) must send the mobile signal
 * header and persist the returned tokens via the storage plugin; the
 * non-mobile branch (mocked `false`, the default in every other test in this
 * project) must be BYTE-FOR-BYTE unchanged from before this feature existed
 * — that regression guard is the point of this file, since a plain web user
 * must never be affected by any of this.
 */

import { apiClient } from '../api/client';
import * as authService from './authService';
import * as mobileAuthStorage from './mobileAuthStorage';
import { ApiError } from './apiUtils';

jest.mock('../api/client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

const isNativePlatformMock = jest.spyOn(mobileAuthStorage, 'isNativePlatform');
const storeTokensMock = jest.spyOn(mobileAuthStorage, 'storeTokens').mockResolvedValue(undefined);
const clearTokensMock = jest.spyOn(mobileAuthStorage, 'clearTokens').mockResolvedValue(undefined);
const getCachedRefreshTokenMock = jest.spyOn(mobileAuthStorage, 'getCachedRefreshToken');

const postMock = apiClient.post as jest.Mock;

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true })) as jest.Mock;
});

describe('login — web platform (regression guard)', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    postMock.mockResolvedValue({ success: true, data: { user: { id: 1 } } });
  });

  it('sends no X-Client-Type header', async () => {
    await authService.login({ email: 'a@x.com', password: 'pw' });
    const [, , options] = postMock.mock.calls[0];
    expect(options.headers).toBeUndefined();
  });

  it('never touches token storage', async () => {
    await authService.login({ email: 'a@x.com', password: 'pw' });
    expect(storeTokensMock).not.toHaveBeenCalled();
  });
});

describe('login — mobile platform', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    postMock.mockResolvedValue({
      success: true,
      data: { user: { id: 1 }, accessToken: 'at-123', refreshToken: 'rt-456' },
    });
  });

  it('sends X-Client-Type: mobile', async () => {
    await authService.login({ email: 'a@x.com', password: 'pw' });
    const [, , options] = postMock.mock.calls[0];
    expect(options.headers).toEqual({ 'X-Client-Type': 'mobile' });
  });

  it('persists the returned token pair via the storage plugin', async () => {
    await authService.login({ email: 'a@x.com', password: 'pw' });
    expect(storeTokensMock).toHaveBeenCalledWith('at-123', 'rt-456');
  });

  it('does not attempt to store tokens when the response carries none', async () => {
    postMock.mockResolvedValue({ success: true, data: { user: { id: 1 } } });
    await authService.login({ email: 'a@x.com', password: 'pw' });
    expect(storeTokensMock).not.toHaveBeenCalled();
  });
});

describe('refreshToken — web platform (regression guard)', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    postMock.mockResolvedValue({ success: true, data: { user: { id: 1 } } });
  });

  it('sends no header and no body, exactly as before mobile support existed', async () => {
    await authService.refreshToken();
    const [, body, options] = postMock.mock.calls[0];
    expect(body).toBeUndefined();
    expect(options.headers).toBeUndefined();
  });
});

describe('refreshToken — mobile platform', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    getCachedRefreshTokenMock.mockReturnValue('cached-refresh-token');
    postMock.mockResolvedValue({
      success: true,
      data: { user: { id: 1 }, accessToken: 'at-new', refreshToken: 'rt-new' },
    });
  });

  it('sends the mobile header and the cached refresh token in the body', async () => {
    await authService.refreshToken();
    const [, body, options] = postMock.mock.calls[0];
    expect(body).toEqual({ refreshToken: 'cached-refresh-token' });
    expect(options.headers).toEqual({ 'X-Client-Type': 'mobile' });
  });

  it('persists the rotated token pair', async () => {
    await authService.refreshToken();
    expect(storeTokensMock).toHaveBeenCalledWith('at-new', 'rt-new');
  });
});

describe('logout — mobile platform', () => {
  it('clears stored tokens even when the network call fails', async () => {
    isNativePlatformMock.mockReturnValue(true);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as jest.Mock;

    await expect(authService.logout()).rejects.toThrow('offline');
    expect(clearTokensMock).toHaveBeenCalled();
  });

  it('clears stored tokens on a successful logout', async () => {
    isNativePlatformMock.mockReturnValue(true);
    await authService.logout();
    expect(clearTokensMock).toHaveBeenCalled();
  });

  it('hands the server its refresh token so the session is revoked, not merely forgotten', async () => {
    isNativePlatformMock.mockReturnValue(true);
    getCachedRefreshTokenMock.mockReturnValue('device-refresh-token');
    await authService.logout();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/auth\/refresh\/logout$/);
    expect((init.headers as Record<string, string>)['X-Client-Type']).toBe('mobile');
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'device-refresh-token' });
  });
});

describe('logout — web platform (regression guard)', () => {
  it('never touches token storage', async () => {
    isNativePlatformMock.mockReturnValue(false);
    await authService.logout();
    expect(clearTokensMock).not.toHaveBeenCalled();
  });

  it('posts to the refresh path with no body: the refresh cookie is the credential', async () => {
    isNativePlatformMock.mockReturnValue(false);
    await authService.logout();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/auth\/refresh\/logout$/);
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['X-Client-Type']).toBeUndefined();
  });
});

describe('refreshToken — a concurrent refresh superseded this one', () => {
  const superseded = new ApiError('Session was refreshed concurrently; retry', 409, 'REFRESH_SUPERSEDED');

  const ok = { success: true, data: { user: { id: 1 } } };
  const logoutCalls = () =>
    (global.fetch as jest.Mock).mock.calls.filter(([url]) => /\/auth\/refresh\/logout$/.test(url));

  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('backs off and retries until the winning refresh has landed: 409, 409, then success', async () => {
    postMock.mockRejectedValueOnce(superseded).mockRejectedValueOnce(superseded).mockResolvedValueOnce(ok);
    const pending = authService.refreshToken();

    await jest.advanceTimersByTimeAsync(249);
    expect(postMock).toHaveBeenCalledTimes(1); // waits, rather than re-presenting the old token at once
    await jest.advanceTimersByTimeAsync(1);
    expect(postMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual(ok);
    expect(postMock).toHaveBeenCalledTimes(3);
    expect(logoutCalls()).toHaveLength(0);
  });

  it('gives up after its retries and revokes the family: someone else holds the live successor', async () => {
    postMock.mockRejectedValue(superseded);
    const pending = authService.refreshToken();
    const settled = expect(pending).rejects.toBe(superseded);
    await jest.advanceTimersByTimeAsync(1250);
    await settled;
    expect(postMock).toHaveBeenCalledTimes(3);
    expect(logoutCalls()).toHaveLength(1);
  });

  it('does not retry, or revoke, on any other failure', async () => {
    const invalid = new ApiError('Session expired', 401, 'REFRESH_INVALID');
    postMock.mockRejectedValue(invalid);
    await expect(authService.refreshToken()).rejects.toBe(invalid);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(logoutCalls()).toHaveLength(0);
  });
});

describe('refreshToken — one refresh at a time', () => {
  const ok = { success: true, data: { user: { id: 1 } } };
  beforeEach(() => isNativePlatformMock.mockReturnValue(false));
  afterEach(() => {
    delete (navigator as unknown as { locks?: unknown }).locks;
  });

  it('shares one in-flight request between concurrent callers in a tab', async () => {
    let resolve!: (v: unknown) => void;
    postMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const a = authService.refreshToken();
    const b = authService.refreshToken();
    resolve(ok);
    await expect(Promise.all([a, b])).resolves.toEqual([ok, ok]);
    expect(postMock).toHaveBeenCalledTimes(1);

    // Once settled, the next call is a new refresh.
    postMock.mockResolvedValueOnce(ok);
    await authService.refreshToken();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('serialises across tabs through a Web Lock when the browser has them', async () => {
    const request = jest.fn((_name: string, work: () => Promise<unknown>) => work());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    postMock.mockResolvedValueOnce(ok);
    await expect(authService.refreshToken()).resolves.toEqual(ok);
    expect(request).toHaveBeenCalledWith('staff-scheduler-auth-refresh', expect.any(Function));
  });
});
