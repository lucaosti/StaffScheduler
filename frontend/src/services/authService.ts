/**
 * Authentication Service for Staff Scheduler Frontend
 * 
 * Handles all authentication-related API calls including login, logout,
 * token management, and user profile operations.
 * 
 * Features:
 * - JWT token management with localStorage
 * - Error handling with custom ApiError
 * - Automatic header management for authenticated requests
 * - Response parsing and type safety
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';
import { handleResponse, getAuthHeaders } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

/**
 * Authenticates user with username and password
 * @param credentials - User login credentials
 * @returns Promise resolving to login response with token and user data
 * @throws {ApiError} When authentication fails or network error occurs
 * 
 * @example
 * ```typescript
 * const result = await login({ username: 'admin', password: 'password123' });
 * localStorage.setItem('token', result.data.token);
 * ```
 */
export const login = async (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  
  return handleResponse<LoginResponse>(response);
};

/**
 * Verifies JWT token validity and returns user information
 * @param token - JWT token to verify
 * @returns Promise resolving to user data if token is valid
 * @throws {ApiError} When token is invalid or expired
 * 
 * @example
 * ```typescript
 * const user = await verifyToken(storedToken);
 * console.log('Current user:', user.data);
 * ```
 */
export const verifyToken = async (token: string): Promise<ApiResponse<User>> => {
  const response = await fetch(`${API_BASE_URL}/auth/verify`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  return handleResponse<User>(response);
};

/**
 * Refreshes an existing JWT token
 * @param token - Current JWT token to refresh
 * @returns Promise resolving to new token and user data
 * @throws {ApiError} When token refresh fails or token is invalid
 * 
 * @example
 * ```typescript
 * const refreshed = await refreshToken(currentToken);
 * localStorage.setItem('token', refreshed.data.token);
 * ```
 */
export const refreshToken = async (token: string): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  return handleResponse<LoginResponse>(response);
};

/**
 * Logs out the current user and invalidates their session
 * @returns Promise resolving when logout is complete
 * @throws {ApiError} When logout request fails
 * 
 * @example
 * ```typescript
 * await logout();
 * localStorage.removeItem('token');
 * navigate('/login');
 * ```
 */
export const logout = async (): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};
