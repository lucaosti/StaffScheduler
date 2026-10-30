/**
 * Authentication Context Provider
 *
 * Manages application-wide authentication state using React Context API.
 * On the web platform, JWTs are stored exclusively in httpOnly cookies set by
 * the server; no token is persisted in localStorage or sessionStorage. Inside
 * the Capacitor mobile app the cookie jar cannot be relied on, so tokens are
 * additionally cached from native secure storage at startup — see
 * `services/mobileAuthStorage.ts` for why and `services/authService.ts` for
 * where they are read from and written to. Neither exists, and neither runs,
 * on the web platform.
 *
 * @author Luca Ostinelli
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User, LoginRequest, LoginResponse, ApiResponse } from '../types';
import * as authService from '../services/authService';
import { getCachedAccessToken, isNativePlatform, loadCachedTokens } from '../services/mobileAuthStorage';
import { isSessionRefusal } from '../services/apiUtils';
import { registerForNativePush, unregisterNativePush } from '../services/nativePushService';
import { dropWebPushSubscription } from '../services/webPushSession';
import { onSessionExpired } from '../api/client';
import i18n, { isSupportedLocale } from '../i18n';
import { applyOrganizationOverrides } from '../i18n/organizationOverrides';
import { getMyOverrides } from '../services/translationOverrideService';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  /**
   * Re-reads the signed-in user.
   *
   * Needed because some of the account's own state changes through endpoints
   * that do not mint a token — enabling two-factor is the first: it flips
   * `twoFactorEnabled` server-side, and without this the page would keep
   * offering "Set up" to someone who had just finished setting it up.
   */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** How long logout waits for push deactivation before revoking anyway. */
const PUSH_CLEANUP_BUDGET_MS = 1500;
/** The web client's proactive refresh period (80% of the default 15m). */
const WEB_REFRESH_INTERVAL_MS = 12 * 60 * 1000;
/** Floor for a native refresh scheduled from a token about to expire. */
const MIN_REFRESH_DELAY_MS = 10_000;
/** On resume, a native token closer than this to expiry is refreshed at once. */
const RESUME_REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** The `exp` of a JWT in ms, or null when there is no readable one. */
const jwtExpiresAt = (token: string | null): number | null => {
  try {
    const payload = token?.split('.')[1];
    if (!payload) return null;
    const exp = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** When to refresh next: from the native token's `exp`, else the web period. */
const nextRefreshDelayMs = (): number => {
  const expiresAt = isNativePlatform() ? jwtExpiresAt(getCachedAccessToken()) : null;
  if (expiresAt === null) return WEB_REFRESH_INTERVAL_MS;
  return Math.max(MIN_REFRESH_DELAY_MS, (expiresAt - Date.now()) * 0.8);
};

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: { user: User } }
  | { type: 'LOGIN_FAILURE'; payload?: string }
  | { type: 'LOGOUT' }
  | { type: 'SET_USER'; payload: User }
  | { type: 'SET_LOADING'; payload: boolean };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, isLoading: true, error: null };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'LOGIN_FAILURE':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload || 'Authentication failed',
      };
    case 'LOGOUT':
      return { ...state, user: null, isAuthenticated: false, isLoading: false };
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    default:
      return state;
  }
};

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // One user's cached server state must never be shown to the next (#841).
  // The cache is app-wide and outlives a session. Every sign-in goes through
  // `establishSession`, which clears it BEFORE dispatching when the user
  // differs from the last one this tab saw (a silent switch: another tab
  // signed in as B and this tab's refresh picked up B's cookie). Doing it in
  // an effect, as first written, ran after B's tree had rendered, so a
  // mounted observer painted A's data under B's name for a frame. A logout
  // (A → none) is cleared in the effect below instead, after the protected
  // pages have unmounted: cleared while they are mounted, their observers
  // would refetch with the session not yet revoked and repopulate the cache.
  // A refresh for the SAME user keeps the cache.
  const queryClient = useQueryClient();
  const lastUserId = useRef<number | null>(null);
  const establishSession = useCallback(
    (user: User) => {
      if (lastUserId.current !== null && lastUserId.current !== user.id) queryClient.clear();
      lastUserId.current = user.id;
      dispatch({ type: 'LOGIN_SUCCESS', payload: { user } });
    },
    [queryClient]
  );
  const userId = state.user?.id ?? null;
  useEffect(() => {
    if (userId === null && lastUserId.current !== null) {
      queryClient.clear();
      lastUserId.current = null;
    }
  }, [userId, queryClient]);

  useEffect(() => {
    // On mount, try the access token first. Because access tokens are now
    // short-lived (~15m), a page reload after that window would otherwise log
    // the user out despite a still-valid refresh token — so a failed verify
    // falls back to a silent refresh (which rotates the refresh cookie and
    // mints a new access token) before giving up.
    const initializeAuth = async () => {
      // Native only: populate the in-memory token cache from secure storage
      // before the first API call, so `getAuthHeaders` has an access token to
      // attach. A no-op on the web platform (isNativePlatform() is false).
      // Inside the try on purpose: a storage rejection must end in the same
      // logged-out state as any other failed bootstrap. Awaited outside it, the
      // rejection skipped every dispatch below and left `isLoading` true, so
      // the protected routes spun forever instead of showing the login page.
      // A restored session registers native push exactly like a fresh login
      // (#841 review): the device token logout deactivates is recorded only
      // when this runs, so after a cold start with a restored session logout
      // had no token and the device kept receiving the signed-out user's
      // notifications. Registration is idempotent server-side.
      const restored = (user: User) => {
        establishSession(user);
        void registerForNativePush();
      };
      try {
        if (isNativePlatform()) await loadCachedTokens();
        const response = await authService.verifyToken();
        if (response.success && response.data) {
          restored(response.data);
          return;
        }
      } catch {
        // fall through to a refresh attempt
      }
      try {
        const refreshed = await authService.refreshToken();
        if (refreshed.success && refreshed.data) {
          restored(refreshed.data.user);
          return;
        }
      } catch {
        // no valid session
      }
      dispatch({ type: 'SET_LOADING', payload: false });
    };

    initializeAuth();
  }, [establishSession]);

  // The logout still in flight, if any — see `logout`.
  const pendingLogout = useRef<Promise<void> | null>(null);

  const login = useCallback(async (credentials: LoginRequest): Promise<void> => {
    dispatch({ type: 'LOGIN_START' });

    try {
      // A previous user's revocation must land before this sign-in: on the
      // web the revocation authenticates with whatever refresh cookie the jar
      // holds when it is sent, so sent after B's login it would revoke B.
      await pendingLogout.current;
      const response: ApiResponse<LoginResponse> = await authService.login(credentials);

      if (response.success && response.data) {
        establishSession(response.data.user);
        // Native only: obtain a device token and register it with the
        // backend. A no-op on the web platform. Fire-and-forget — a push
        // registration failure (permission declined, no push services on
        // the device) must never block login.
        void registerForNativePush();
      } else {
        throw new Error(response.error?.message || 'Login failed');
      }
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE', payload: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    }
  }, [establishSession]);

  /**
   * Ends the session and everything tied to it (#841).
   *
   * Deactivating the push registrations is an authenticated call, so it goes
   * before the revocation — but bounded by PUSH_CLEANUP_BUDGET_MS (#841
   * review): an unbounded wait meant closing the tab right after Logout never
   * sent the revocation and left the 30-day refresh cookie live. For the same
   * reason a `pagehide` during the wait revokes at once, and the revocation
   * itself is a keepalive request (authService). A push registration the
   * budget cuts short stays the server's to retire when delivery fails.
   *
   * One logout at a time: a second call while one is in flight (several
   * requests reporting the same dead session, a double click) only updates
   * the state. And `login` waits for this to finish, so a revocation can
   * never land after — and revoke — the next user's sign-in.
   *
   * The state flips immediately; the calls finish in the background.
   */
  const logout = useCallback((): void => {
    if (!pendingLogout.current) {
      let revocation: Promise<void> | null = null;
      const revoke = () => (revocation ??= authService.logout().catch(() => undefined));
      const onPageHide = () => void revoke();
      window.addEventListener('pagehide', onPageHide);
      pendingLogout.current = (async () => {
        await Promise.race([
          Promise.allSettled([unregisterNativePush(), dropWebPushSubscription()]),
          new Promise((resolve) => setTimeout(resolve, PUSH_CLEANUP_BUDGET_MS)),
        ]);
        await revoke();
      })().finally(() => {
        window.removeEventListener('pagehide', onPageHide);
        pendingLogout.current = null;
      });
    }
    dispatch({ type: 'LOGOUT' });
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    // Deliberately silent on failure: this runs after an action that already
    // succeeded, and turning a stale display into a logout would be a worse
    // answer than a stale display.
    try {
      const response = await authService.verifyToken();
      if (response.success && response.data) {
        dispatch({ type: 'SET_USER', payload: response.data });
      }
    } catch {
      // keep whatever we had
    }
  }, []);

  // Only a refused refresh ends the session (#842 review): a 5xx during a
  // rolling deploy or a dropped connection used to sign the user out too.
  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      const response = await authService.refreshToken();
      if (response.success && response.data) {
        establishSession(response.data.user);
      } else {
        logout();
      }
    } catch (error) {
      if (isSessionRefusal(error)) logout();
    }
  }, [logout, establishSession]);

  // Organization translation overrides: fetched once the authenticated user
  // (and therefore their organization) is known, and re-fetched whenever the
  // locale changes. Not run before login — an unauthenticated visitor has no
  // organization yet, so the Login page stays on the shipped base catalog.
  //
  // `lastLocale` is scoped to this effect run (reset on every login/logout
  // transition) rather than held in a ref, because it exists to break a
  // feedback loop: `applyOrganizationOverrides` re-emits i18next's own
  // 'languageChanged' event to make already-mounted `useTranslation()` calls
  // pick up the merged strings, and that synthetic re-emit carries the SAME
  // locale — without this guard it would re-trigger this handler and
  // re-fetch forever.
  useEffect(() => {
    if (!state.isAuthenticated) return;
    let lastLocale: string | null = null;

    const fetchAndApply = (locale: string): void => {
      if (locale === lastLocale || !isSupportedLocale(locale)) return;
      lastLocale = locale;
      getMyOverrides(locale)
        .then((response) => {
          if (response.success) applyOrganizationOverrides(locale, response.data ?? {});
        })
        .catch(() => {
          // Non-fatal: the shipped base catalog stands on its own.
        });
    };

    fetchAndApply(i18n.language);
    i18n.on('languageChanged', fetchAndApply);
    return () => {
      i18n.off('languageChanged', fetchAndApply);
    };
  }, [state.isAuthenticated]);

  // The client refreshes an expired session on a 401 and retries (#842); when
  // that refresh fails the session is over, and the UI signs out rather than
  // leaving the user on a page whose every request fails. Ignored while signed
  // out: logout's own push-deactivation calls may 401 on an already-dead
  // session, and must not start another logout.
  const authenticatedRef = useRef(false);
  authenticatedRef.current = state.isAuthenticated;
  useEffect(
    () =>
      onSessionExpired(() => {
        if (authenticatedRef.current) logout();
      }),
    [logout]
  );

  // Proactive refresh: rotate the session before the access token expires, so
  // an active user is not made to wait on a refresh-and-retry mid-session. It
  // is an optimisation, not what keeps the session alive — an expiry it misses
  // is caught by the client's refresh on 401.
  //
  // On the web the token lives in an httpOnly cookie, so its lifetime is not
  // visible: refresh every 12 minutes, 80% of the default 15. The native app
  // holds the token itself, so there the next refresh is scheduled at 80% of
  // the remaining lifetime read from its `exp` (#842 review), following
  // whatever `JWT_EXPIRES_IN` the server uses. A native app is also suspended
  // in the background, where no timer runs, so on returning to the foreground
  // it refreshes at once if the token is near expiry. The WebView's
  // `visibilitychange` is that signal — it fires on Capacitor's resume — so
  // no `@capacitor/app` dependency is added for it. Torn down on logout or
  // unmount.
  useEffect(() => {
    if (!state.isAuthenticated) return;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await refreshToken();
        schedule();
      }, nextRefreshDelayMs());
    };
    schedule();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !isNativePlatform()) return;
      const expiresAt = jwtExpiresAt(getCachedAccessToken());
      if (expiresAt !== null && expiresAt - Date.now() < RESUME_REFRESH_MARGIN_MS) void refreshToken();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [state.isAuthenticated, refreshToken]);

  const value: AuthContextType = useMemo(
    () => ({
      ...state,
      login,
      logout,
      refreshToken,
      refreshUser,
    }),
    [state, login, logout, refreshToken, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
