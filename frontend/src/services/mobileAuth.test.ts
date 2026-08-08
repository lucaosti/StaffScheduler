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
});

describe('logout — web platform (regression guard)', () => {
  it('never touches token storage', async () => {
    isNativePlatformMock.mockReturnValue(false);
    await authService.logout();
    expect(clearTokensMock).not.toHaveBeenCalled();
  });
});
