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

interface AuthState {
  user: Omit<User, 'passwordHash' | 'salt'> | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: { user: Omit<User, 'passwordHash' | 'salt'> } }
  | { type: 'LOGIN_FAILURE'; payload?: string }
  | { type: 'LOGOUT' }
  | { type: 'SET_USER'; payload: Omit<User, 'passwordHash' | 'salt'> }
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
    const initializeAuth = async () => {
      try {
        const response = await authService.verifyToken();
        if (response.success && response.data) {
          dispatch({
            type: 'LOGIN_SUCCESS',
            payload: { user: response.data },
          });
        } else {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch {
        dispatch({ type: 'LOGOUT' });
      }
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

  const value: AuthContextType = useMemo(
    () => ({
      ...state,
      login,
      logout,
      refreshToken,
    }),
    [state, login, logout, refreshToken]
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
