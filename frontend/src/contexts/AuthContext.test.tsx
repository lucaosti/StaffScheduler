/**
 * AuthContext unit tests covering:
 *   - useAuth must throw outside provider
 *   - bootstrap via verifyToken (cookie-based, no localStorage)
 *   - login success / failure
 *   - refresh success / failure
 *   - logout calls server and clears state
 *   - a native secure-storage failure at startup still ends loading
 */

import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as authService from '../services/authService';
import * as mobileAuthStorage from '../services/mobileAuthStorage';
import * as translationOverrideService from '../services/translationOverrideService';
import * as organizationOverrides from '../i18n/organizationOverrides';
import * as nativePushService from '../services/nativePushService';
import * as webPushSession from '../services/webPushSession';
import i18n from '../i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onSessionExpired } from '../api/client';

jest.mock('../services/authService');
jest.mock('../services/translationOverrideService');
jest.mock('../services/nativePushService');
jest.mock('../services/webPushSession');
// Captures the listener AuthProvider registers for "the client could not
// refresh an expired session", so a test can fire it.
jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  onSessionExpired: jest.fn(() => () => undefined),
}));
jest.mock('../i18n/organizationOverrides');
// Only the two startup hooks are replaced: every other export keeps its real
// (web-platform) behaviour, so the remaining suites run exactly as before.
jest.mock('../services/mobileAuthStorage', () => ({
  ...jest.requireActual('../services/mobileAuthStorage'),
  isNativePlatform: jest.fn(() => false),
  loadCachedTokens: jest.fn(),
}));

const mockedAuthService = authService as jest.Mocked<typeof authService>;
const mockedOverrideService = translationOverrideService as jest.Mocked<typeof translationOverrideService>;
const mockedIsNativePlatform = mobileAuthStorage.isNativePlatform as jest.Mock;
const mockedLoadCachedTokens = mobileAuthStorage.loadCachedTokens as jest.Mock;
const mockedApplyOverrides = organizationOverrides.applyOrganizationOverrides as jest.Mock;
const mockedUnregisterNativePush = nativePushService.unregisterNativePush as jest.Mock;
const mockedDropWebPush = webPushSession.dropWebPushSubscription as jest.Mock;

// The provider clears the query cache on logout and on a change of user, so it
// needs a QueryClient; one per test, reachable as `queryClient` to assert on.
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

const userA = { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' };
const userB = { id: 2, email: 'b@x', firstName: 'B', lastName: 'C', role: 'employee' };

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockedUnregisterNativePush.mockResolvedValue(undefined);
  mockedDropWebPush.mockResolvedValue(undefined);
  // clearAllMocks keeps implementations, so a refresh one test resolved would
  // otherwise sign the next test's "no session" bootstrap in.
  mockedAuthService.refreshToken.mockRejectedValue(new Error('no session'));
  mockedIsNativePlatform.mockReturnValue(false);
  mockedOverrideService.getMyOverrides.mockResolvedValue({ success: true, data: {} });
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const Probe: React.FC = () => {
      useAuth();
      return null;
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});

describe('AuthProvider bootstrap', () => {
  it('finishes loading=false when verify fails', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('authenticates when verify succeeds', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  });

  it('sets loading=false when verify returns success:false', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('sets loading=false when verify rejects', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('sets loading=false when the native token cache fails to load', async () => {
    // Preferences can reject (storage unavailable, corrupted entry). The app
    // must land on the login screen, not spin on the loading guard forever.
    mockedIsNativePlatform.mockReturnValue(true);
    mockedLoadCachedTokens.mockRejectedValue(new Error('storage unavailable'));
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    mockedAuthService.refreshToken.mockRejectedValue(new Error('no session'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('AuthProvider actions', () => {
  it('login success sets user and isAuthenticated', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    mockedAuthService.login.mockResolvedValue({
      success: true,
      data: {
        user: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' },
      } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.login({ email: 'a@x', password: 'pw' } as never);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('a@x');
  });

  it('login failure dispatches LOGIN_FAILURE', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    mockedAuthService.login.mockResolvedValue({ success: false, error: { message: 'no' } } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      try {
        await result.current.login({ email: 'a@x', password: 'pw' } as never);
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout calls authService.logout and sets unauthenticated', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refreshToken happy path updates state', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.refreshToken.mockResolvedValue({
      success: true,
      data: {
        user: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' },
      } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('refreshToken failure logs out', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.logout.mockResolvedValue();
    mockedAuthService.refreshToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('keeps callback identities stable across renders', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = {
      login: result.current.login,
      logout: result.current.logout,
      refreshToken: result.current.refreshToken,
    };
    rerender();
    expect(result.current.login).toBe(first.login);
    expect(result.current.logout).toBe(first.logout);
    expect(result.current.refreshToken).toBe(first.refreshToken);
  });
});

/**
 * One user's data must not survive into the next session in the same tab
 * (#841). The query cache is app-wide and outlives the session, so without a
 * clear the next user to sign in is served the previous user's cached pages
 * until each query happens to refetch; push registrations belong to the
 * device or browser, so they keep delivering the previous user's
 * notifications.
 */
describe('session isolation', () => {
  const warmCache = () => queryClient.setQueryData(['employees'], [{ id: 99, name: 'A-only' }]);

  it('logout empties the query cache', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    warmCache();

    act(() => result.current.logout());

    await waitFor(() => expect(queryClient.getQueryData(['employees'])).toBeUndefined());
  });

  it('logout drops the push registrations before ending the session', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    const order: string[] = [];
    mockedUnregisterNativePush.mockImplementation(async () => { order.push('native'); });
    mockedDropWebPush.mockImplementation(async () => { order.push('web'); });
    mockedAuthService.logout.mockImplementation(async () => { order.push('logout'); });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => result.current.logout());

    // The push calls need the session the logout call revokes, so they go first.
    await waitFor(() => expect(order).toHaveLength(3));
    expect(order.slice(0, 2).sort()).toEqual(['native', 'web']);
    expect(order[2]).toBe('logout');
  });

  it('a failed push unregistration does not stop the logout', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    mockedDropWebPush.mockRejectedValue(new Error('offline'));
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => result.current.logout());

    expect(result.current.isAuthenticated).toBe(false);
    await waitFor(() => expect(mockedAuthService.logout).toHaveBeenCalled());
  });

  it('a refresh that returns a different user empties the cache', async () => {
    // Another tab signed in as B; this tab's next refresh carries B's cookie.
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    mockedAuthService.refreshToken.mockResolvedValue({ success: true, data: { user: userB } as never });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    warmCache();

    await act(async () => {
      await result.current.refreshToken();
    });

    expect(result.current.user?.id).toBe(2);
    expect(queryClient.getQueryData(['employees'])).toBeUndefined();
  });

  it('a refresh for the same user keeps the cache', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    mockedAuthService.refreshToken.mockResolvedValue({ success: true, data: { user: userA } as never });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    warmCache();

    await act(async () => {
      await result.current.refreshToken();
    });

    expect(queryClient.getQueryData(['employees'])).toEqual([{ id: 99, name: 'A-only' }]);
  });
});

// #842: when the client's reactive refresh fails the session is over, and the
// UI must say so instead of leaving the user on a page whose requests all 401.
describe('an expired session the client could not refresh', () => {
  const fireSessionExpired = () => {
    const calls = (onSessionExpired as jest.Mock).mock.calls;
    const listener = calls[calls.length - 1][0] as () => void;
    act(() => listener());
  };

  it('signs the user out', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: true, data: userA as never });
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    fireSessionExpired();

    expect(result.current.isAuthenticated).toBe(false);
    await waitFor(() => expect(mockedAuthService.logout).toHaveBeenCalledTimes(1));
  });

  it('is ignored when nobody is signed in, so logout cannot re-trigger itself', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fireSessionExpired();

    expect(mockedAuthService.logout).not.toHaveBeenCalled();
  });
});

describe('organization translation overrides', () => {
  it('does not fetch overrides before authentication', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockedOverrideService.getMyOverrides).not.toHaveBeenCalled();
  });

  it('fetches and applies overrides for the active locale once the user is known', async () => {
    mockedOverrideService.getMyOverrides.mockResolvedValue({
      success: true,
      data: { 'auth.signIn': 'Enter' },
    });
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin', organizationName: 'Acme' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await waitFor(() => expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledWith(i18n.language));
    await waitFor(() =>
      expect(mockedApplyOverrides).toHaveBeenCalledWith(i18n.language, { 'auth.signIn': 'Enter' })
    );
  });

  it('re-fetches and re-applies overrides when the locale changes', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin', organizationName: 'Acme' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledTimes(1));

    act(() => {
      i18n.emit('languageChanged', 'it');
    });

    await waitFor(() => expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledWith('it'));
  });

  it('does not re-fetch on the synthetic languageChanged re-emit applyOrganizationOverrides fires for the same locale', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin', organizationName: 'Acme' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledTimes(1));

    act(() => {
      // The same locale as already applied — this is what
      // applyOrganizationOverrides' own re-emit looks like.
      i18n.emit('languageChanged', i18n.language);
    });

    expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledTimes(1);
  });

  it('stops listening for locale changes on logout', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin', organizationName: 'Acme' } as never,
    });
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(mockedOverrideService.getMyOverrides).toHaveBeenCalledTimes(1));

    act(() => result.current.logout());

    mockedOverrideService.getMyOverrides.mockClear();
    act(() => {
      i18n.emit('languageChanged', 'ar');
    });
    expect(mockedOverrideService.getMyOverrides).not.toHaveBeenCalled();
  });
});
