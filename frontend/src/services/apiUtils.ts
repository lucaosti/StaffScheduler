/**
 * Shared API Utilities for Staff Scheduler Frontend
 *
 * Provides common helpers used across all service modules:
 * - ApiError: typed error class carrying the HTTP status code
 * - handleResponse: parses fetch responses and surfaces errors uniformly
 * - getAuthHeaders: builds the Authorization + Content-Type headers from localStorage
 *
 * All service files must import from here instead of defining their own copies.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

/**
 * Custom error class for API-related errors.
 * Carries the HTTP status code alongside the message so callers
 * can distinguish 401 / 403 / 404 / 5xx without parsing strings.
 */
export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Parses a fetch Response into an ApiResponse<T>.
 * Throws ApiError for non-2xx responses.
 *
 * @template T - Expected shape of the `data` field in the API response
 * @param response - Raw fetch Response object
 * @returns Parsed ApiResponse<T>
 * @throws {ApiError} When the server returns a non-2xx status
 */
export const handleResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(
      (data && data.error?.message) || data.message || `HTTP error! status: ${response.status}`,
      response.status
    );
  }

  return data as ApiResponse<T>;
};

/**
 * Fetch wrapper that retries once on 401 by refreshing the JWT.
 *
 * This keeps services thin and provides defence-in-depth against token expiry.
 * Auth flows themselves should call `authService.refreshToken` directly.
 */
const apiFetch = async (path: string, init: RequestInit = {}, retried = false): Promise<Response> => {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });

  const token = localStorage.getItem('token');
  const isAuthRefresh = url.endsWith('/auth/refresh');

  if (response.status === 401 && token && !retried && !isAuthRefresh) {
    // Attempt a token refresh, then retry the original request once.
    const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (refreshRes.ok) {
      const parsed = (await refreshRes.json()) as ApiResponse<{ token: string; user: unknown }>;
      const newToken = parsed.data?.token;
      if (newToken) {
        localStorage.setItem('token', newToken);
        return apiFetch(path, init, true);
      }
    }
  }

  return response;
};

export const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const response = await apiFetch(path, init);
  return handleResponse<T>(response);
};

/**
 * Builds fetch headers including the JWT bearer token if present in localStorage.
 *
 * @returns HeadersInit object with Content-Type and optional Authorization header
 */
export const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};
