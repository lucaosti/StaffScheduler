/**
 * Authentication Context Provider
 * 
 * Manages application-wide authentication state using React Context API.
 * Provides authentication methods and user state to all child components.
 * 
 * Features:
 * - JWT token management with localStorage persistence
 * - Automatic token verification on app startup
 * - Login/logout functionality
 * - Token refresh capabilities
 * - Error handling for authentication failures
 * - Loading states for better UX
 * 
 * Security:
 * - Automatic token cleanup on logout
 * - Token verification with backend
 * - Secure token storage practices
 * 
 * @author Luca Ostinelli
 */

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { User, LoginRequest, LoginResponse, ApiResponse } from '../types';
import * as authService from '../services/authService';

/**
 * Authentication State Interface
 * 
 * Defines the structure of authentication state managed by the context.
 * Excludes sensitive user data like password hashes.
 */
interface AuthState {
  user: Omit<User, 'passwordHash' | 'salt'> | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Authentication Context Interface
 * 
 * Extends AuthState with methods for authentication actions.
 * Provides the complete API for authentication management.
 */
interface AuthContextType extends AuthState {
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

/**
 * Create Authentication Context
 * 
 * Creates the React context for authentication state management.
 * Initially undefined to ensure proper error handling.
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Authentication Action Types
 * 
 * Defines all possible actions for the authentication reducer.
 * Uses discriminated unions for type safety.
 */
type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; payload: { user: Omit<User, 'passwordHash' | 'salt'>; token: string } }
  | { type: 'LOGIN_FAILURE' }
  | { type: 'LOGOUT' }
  | { type: 'SET_USER'; payload: Omit<User, 'passwordHash' | 'salt'> }
  | { type: 'SET_LOADING'; payload: boolean };

/**
 * Authentication State Reducer
 * 
 * Manages authentication state transitions based on dispatched actions.
 * Implements immutable state updates for predictable state management.
 * 
 * @param state - Current authentication state
 * @param action - Action to process
 * @returns New authentication state
 */
const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return {
        ...state,
        isLoading: true,
        error: null,
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    case 'LOGIN_FAILURE':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    default:
      return state;
  }
};

const initialState: AuthState = {
  user: null,
  token: null,
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
    // Check for existing token on app load
    const initializeAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const response = await authService.verifyToken(token);
          if (response.success && response.data) {
            dispatch({
              type: 'LOGIN_SUCCESS',
              payload: { user: response.data, token },
            });
          } else {
            localStorage.removeItem('token');
            dispatch({ type: 'LOGIN_FAILURE' });
          }
        } catch (error) {
          localStorage.removeItem('token');
          dispatch({ type: 'LOGIN_FAILURE' });
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    initializeAuth();
  }, []);

  const login = async (credentials: LoginRequest): Promise<void> => {
    dispatch({ type: 'LOGIN_START' });
    
    try {
      const response: ApiResponse<LoginResponse> = await authService.login(credentials);
      
      if (response.success && response.data) {
        const { user, token } = response.data;
        localStorage.setItem('token', token);
        dispatch({
          type: 'LOGIN_SUCCESS',
          payload: { user, token },
        });
      } else {
        throw new Error((response.error as any)?.message || 'Login failed');
      }
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE' });
      throw error;
    }
  };

  const logout = (): void => {
    localStorage.removeItem('token');
    dispatch({ type: 'LOGOUT' });
  };

  const refreshToken = async (): Promise<void> => {
    const token = localStorage.getItem('token');
    if (!token) {
      logout();
      return;
    }

    try {
      const response = await authService.refreshToken(token);
      if (response.success && response.data) {
        localStorage.setItem('token', response.data.token);
        dispatch({
          type: 'LOGIN_SUCCESS',
          payload: response.data,
        });
      } else {
        logout();
      }
    } catch (error) {
      logout();
    }
  };

  const value: AuthContextType = {
    ...state,
    login,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
