/**
 * Authentication Service for Staff Scheduler Frontend
 *
 * Handles login, session verification, token refresh and logout. This is a
 * pilot for the generated typed client (`../api/client`): the request body of
 * `login` is checked against the OpenAPI contract at compile time, and the
 * auth cookie is carried automatically via the client's `credentials:
 * 'include'`.
 *
 * Note on `login`: the frontend `LoginRequest` carries a `rememberMe` flag
 * that is a purely client-side concern (it does not exist in the backend
 * `loginBody` contract). Only the contract fields are forwarded, so the typed
 * client accepts the call and no ignored field is sent over the wire.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';
import { apiClient } from '../api/client';
import { API_BASE_URL, getAuthHeaders } from './apiUtils';

export const login = (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> =>
  apiClient.post<LoginResponse, '/auth/login'>('/auth/login', {
    email: credentials.email,
    password: credentials.password,
    totpCode: credentials.totpCode,
  });

export const verifyToken = (): Promise<ApiResponse<User>> =>
  apiClient.get<User, '/auth/verify'>('/auth/verify');

export const refreshToken = (): Promise<ApiResponse<LoginResponse>> =>
  apiClient.post<LoginResponse, '/auth/refresh'>('/auth/refresh', undefined);

/**
 * Logout is intentionally fire-and-forget: the server clears the cookie and
 * blacklists the token, but the client should complete its local logout even
 * if that request fails, so this does not go through the throwing client.
 */
export const logout = async (): Promise<void> => {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    ...getAuthHeaders(),
  });
};
