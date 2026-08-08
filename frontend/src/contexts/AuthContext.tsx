/**
 * Authentication Context Provider
 *
 * Manages application-wide authentication state using React Context API.
 * JWT tokens are stored exclusively in httpOnly cookies set by the server;
 * no token is persisted in localStorage or sessionStorage.
 *
 * @author Luca Ostinelli
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { User, LoginRequest, LoginResponse, ApiResponse } from '../types';
import * as authService from '../services/authService';
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

  useEffect(() => {
    // On mount, try the access token first. Because access tokens are now
    // short-lived (~15m), a page reload after that window would otherwise log
    // the user out despite a still-valid refresh token — so a failed verify
    // falls back to a silent refresh (which rotates the refresh cookie and
    // mints a new access token) before giving up.
    const initializeAuth = async () => {
      try {
        const response = await authService.verifyToken();
        if (response.success && response.data) {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { user: response.data } });
          return;
        }
      } catch {
        // fall through to a refresh attempt
      }
      try {
        const refreshed = await authService.refreshToken();
        if (refreshed.success && refreshed.data) {
          dispatch({ type: 'LOGIN_SUCCESS', payload: refreshed.data });
          return;
        }
      } catch {
        // no valid session
      }
      dispatch({ type: 'SET_LOADING', payload: false });
    };

    initializeAuth();
  }, []);

  const login = useCallback(async (credentials: LoginRequest): Promise<void> => {
    dispatch({ type: 'LOGIN_START' });

    try {
      const response: ApiResponse<LoginResponse> = await authService.login(credentials);

      if (response.success && response.data) {
        const { user } = response.data;
        dispatch({
          type: 'LOGIN_SUCCESS',
          payload: { user },
        });
      } else {
        throw new Error(response.error?.message || 'Login failed');
      }
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE', payload: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    }
  }, []);

  const logout = useCallback((): void => {
    authService.logout().catch(() => {});
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

  const refreshToken = useCallback(async (): Promise<void> => {
    try {
      const response = await authService.refreshToken();
      if (response.success && response.data) {
        dispatch({
          type: 'LOGIN_SUCCESS',
          payload: response.data,
        });
      } else {
        logout();
      }
    } catch {
      logout();
    }
  }, [logout]);

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

  // Proactive refresh: rotate the session before the ~15m access token expires,
  // so an active user is never interrupted by an expired token mid-session.
  // Refreshing at 12m (80% of the lifetime) leaves margin for clock skew and
  // request latency. Only runs while authenticated; the interval is torn down
  // on logout or unmount.
  useEffect(() => {
    if (!state.isAuthenticated) return;
    const ACCESS_REFRESH_INTERVAL_MS = 12 * 60 * 1000;
    const id = window.setInterval(() => {
      void refreshToken();
    }, ACCESS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
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
