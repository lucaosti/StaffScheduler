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
 * MOBILE (CAPACITOR) BRANCH. `login` and `refreshToken` each check
 * `isNativePlatform()` and, only when true, send `X-Client-Type: mobile` and
 * persist the token values the backend's mobile-client response mode then
 * includes in the body (see `backend/src/routes/auth.ts` and
 * `mobileAuthStorage.ts` for why). On the ordinary web platform neither
 * branch runs: no extra header is sent, no token is read from the response
 * body, and behavior is exactly what it was before mobile support existed.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';
import { apiClient } from '../api/client';
import { API_BASE_URL, getAuthHeaders } from './apiUtils';
import {
  MOBILE_CLIENT_HEADER,
  MOBILE_CLIENT_VALUE,
  clearTokens,
  getCachedRefreshToken,
  isNativePlatform,
  storeTokens,
} from './mobileAuthStorage';

/** `X-Client-Type: mobile` when running inside Capacitor; no extra headers otherwise. */
const clientTypeHeaders = (): Record<string, string> | undefined =>
  isNativePlatform() ? { [MOBILE_CLIENT_HEADER]: MOBILE_CLIENT_VALUE } : undefined;

/**
 * Persists the token pair to native secure storage when the mobile response
 * mode returned one. A web response never carries these fields (see
 * `LoginResponse`), so this is a no-op there even if called unconditionally.
 */
const persistMobileTokens = async (data: LoginResponse): Promise<void> => {
  if (isNativePlatform() && data.accessToken && data.refreshToken) {
    await storeTokens(data.accessToken, data.refreshToken);
  }
};

export const login = async (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> => {
  const response = await apiClient.post<LoginResponse, '/auth/login'>(
    '/auth/login',
    {
      email: credentials.email,
      password: credentials.password,
      code: credentials.code,
      methodType: credentials.methodType,
    },
    { headers: clientTypeHeaders() }
  );
  if (response.success && response.data) await persistMobileTokens(response.data);
  return response;
};

export const verifyToken = (): Promise<ApiResponse<User>> =>
  apiClient.get<User, '/auth/verify'>('/auth/verify');

/**
 * On the web platform this is unchanged: no header, no body — the refresh
 * cookie is the sole credential, exactly as before mobile support existed.
 *
 * On the native platform, the mobile signal is sent so the server accepts
 * (and returns) tokens by value; the current refresh token, read from the
 * in-memory cache `loadCachedTokens` populates at startup, is sent in the
 * body as a fallback source for a WebView that may not have the cookie.
 */
export const refreshToken = async (): Promise<ApiResponse<LoginResponse>> => {
  const native = isNativePlatform();
  const response = await apiClient.post<LoginResponse, '/auth/refresh'>(
    '/auth/refresh',
    native ? { refreshToken: getCachedRefreshToken() ?? undefined } : undefined,
    { headers: clientTypeHeaders() }
  );
  if (response.success && response.data) await persistMobileTokens(response.data);
  return response;
};

/**
 * Logout is intentionally fire-and-forget: the server clears the cookie and
 * blacklists the token, but the client should complete its local logout even
 * if that request fails, so this does not go through the throwing client.
 *
 * On the native platform the stored tokens are cleared regardless of whether
 * the network call succeeds — the device should forget the session either way.
 */
export const logout = async (): Promise<void> => {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      ...getAuthHeaders(),
    });
  } finally {
    if (isNativePlatform()) await clearTokens();
  }
};
