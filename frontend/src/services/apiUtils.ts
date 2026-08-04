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

// Default to the same-origin relative path, on the canonical /api/v1 prefix
// (#319 — the legacy unversioned /api now 308-redirects here rather than
// serving requests itself, so a client should never target it directly). The
// Vite dev server and the production nginx image both proxy /api to the
// backend, so this works on any host without configuration. Set
// REACT_APP_API_URL only to point the SPA at an API on a different origin.
export const API_BASE_URL = process.env.REACT_APP_API_URL || '/api/v1';

/**
 * Custom error class for API-related errors.
 * Carries the HTTP status code and the backend error code alongside the
 * message so callers can distinguish 401 / 403 / 404 / 5xx — and specific
 * conditions such as TWO_FACTOR_REQUIRED — without parsing strings.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    // The response envelope's top-level `data`, when a non-2xx response carries
    // one alongside `error` — e.g. TWO_FACTOR_REQUIRED's `{ methods: [...] }`,
    // which the caller needs to render without a second round trip.
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    // TypeScript + target:es5 breaks the prototype chain for subclasses of
    // built-in types (Error, Array…). Restoring it makes instanceof reliable.
    Object.setPrototypeOf(this, ApiError.prototype);
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
    let errorCode: string | undefined;
    let errorData: unknown;
    if (data !== null && typeof data === 'object') {
      const dataObj = data as Record<string, unknown>;
      const errField = dataObj['error'];
      if (errField !== null && typeof errField === 'object') {
        const msg = (errField as Record<string, unknown>)['message'];
        if (typeof msg === 'string') errorMessage = msg;
        const code = (errField as Record<string, unknown>)['code'];
        if (typeof code === 'string') errorCode = code;
        errorData = dataObj['data'];
      } else if (typeof dataObj['message'] === 'string') {
        errorMessage = dataObj['message'];
      }
    }
    throw new ApiError(errorMessage, response.status, errorCode, errorData);
  }

  return data as ApiResponse<T>;
};

/**
 * Base headers for authenticated API requests.
 *
 * No longer exported: it was public so that services building their own
 * `fetch` could spread it, and there are none left — every service now goes
 * through the typed client, which calls `getAuthHeaders` itself. An export
 * with no consumer is an invitation to rebuild a request by hand and bypass
 * the contract checking, which is precisely what this migration removed.
 */
const AUTH_HEADERS: Record<string, string> = {
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
