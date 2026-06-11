/**
 * Shared API Utilities for Staff Scheduler Frontend
 *
 * Provides common helpers used across all service modules:
 * - ApiError: typed error class carrying the HTTP status code
 * - handleResponse: parses fetch responses and surfaces errors uniformly
 * - getAuthHeaders: builds the base request init for authenticated calls
 *
 * All service files must import from here instead of defining their own copies.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';

export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

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

  const data: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    if (data !== null && typeof data === 'object') {
      const dataObj = data as Record<string, unknown>;
      const errField = dataObj['error'];
      if (errField !== null && typeof errField === 'object') {
        const msg = (errField as Record<string, unknown>)['message'];
        if (typeof msg === 'string') errorMessage = msg;
      } else if (typeof dataObj['message'] === 'string') {
        errorMessage = dataObj['message'];
      }
    }
    throw new ApiError(errorMessage, response.status);
  }

  return data as ApiResponse<T>;
};

/**
 * Base headers for authenticated API requests.
 * Used internally by getAuthHeaders.
 */
export const AUTH_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

/**
 * Returns a RequestInit object for authenticated fetch calls.
 * Uses credentials: 'include' so the httpOnly auth cookie is sent automatically.
 */
export const getAuthHeaders = (): RequestInit => ({
  credentials: 'include',
  headers: { ...AUTH_HEADERS },
});
