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
import { getCachedAccessToken, isNativePlatform } from './mobileAuthStorage';

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
 *
 * `credentials: 'include'` still sends the httpOnly auth cookie whenever the
 * browser has one — harmless on every platform, and the ONLY mechanism for
 * the ordinary web SPA, unchanged from before mobile support existed.
 *
 * Inside the Capacitor app (`isNativePlatform()`), the cookie jar cannot be
 * relied on (see `mobileAuthStorage.ts`), so when a token has been loaded
 * into the in-memory cache — after login/refresh, or at startup once
 * `loadCachedTokens` resolves — it is also attached as `Authorization:
 * Bearer`, which `authenticate` middleware already accepts as an alternative
 * to the cookie. A web request never has a cached token (the cache is only
 * ever populated on the native platform), so this branch is a no-op there.
 *
 * `extraHeaders` merges in call-specific headers on top of the defaults —
 * currently only used to send `X-Client-Type: mobile` from the auth service
 * when running inside the Capacitor app, so that opt-in stays a per-call
 * decision rather than something every request carries.
 */
export const getAuthHeaders = (extraHeaders?: Record<string, string>): RequestInit => {
  const bearer = isNativePlatform() ? getCachedAccessToken() : null;
  return {
    credentials: 'include',
    headers: {
      ...AUTH_HEADERS,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...extraHeaders,
    },
  };
};
