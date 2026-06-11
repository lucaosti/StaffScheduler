/**
 * Authentication Service for Staff Scheduler Frontend
 *
 * Handles all authentication-related API calls including login, logout,
 * token management, and user profile operations.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';
import { handleResponse, API_BASE_URL } from './apiUtils';

export const login = async (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  return handleResponse<LoginResponse>(response);
};

export const verifyToken = async (): Promise<ApiResponse<User>> => {
  const response = await fetch(`${API_BASE_URL}/auth/verify`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<User>(response);
};

export const refreshToken = async (): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<LoginResponse>(response);
};

export const logout = async (): Promise<void> => {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
