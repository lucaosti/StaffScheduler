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
 * `mobileAuthStorage.ts` for why); `logout` likewise sends the stored refresh
 * token so the server can revoke it. On the ordinary web platform neither
 * branch runs: no extra header is sent, no token is read from the response
 * body, and behavior is exactly what it was before mobile support existed.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';
import { apiClient, setSessionRefresher } from '../api/client';
import { API_BASE_URL, ApiError, getAuthHeaders } from './apiUtils';
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
const postRefresh = (): Promise<ApiResponse<LoginResponse>> =>
  apiClient.post<LoginResponse, '/auth/refresh'>(
    '/auth/refresh',
    isNativePlatform() ? { refreshToken: getCachedRefreshToken() ?? undefined } : undefined,
    { headers: clientTypeHeaders() }
  );

/**
 * Waits before re-presenting a superseded refresh token. A real delay, not a
 * simulated response: the server answers `REFRESH_SUPERSEDED` when another
 * tab's refresh rotated the same token moments ago, and that refresh's
 * Set-Cookie lands only once it has finished (it still loads the user and
 * signs the access token) — an immediate retry usually re-presents the old
 * token and loses again. Both delays together stay well inside the server's
 * 10-second grace window, after which the old token would count as reuse.
 */
const SUPERSEDED_RETRY_DELAYS_MS = [250, 1000];
const REFRESH_LOCK = 'staff-scheduler-auth-refresh';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isSuperseded = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'REFRESH_SUPERSEDED';

const refreshWithRetry = async (): Promise<ApiResponse<LoginResponse>> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postRefresh();
    } catch (error) {
      if (!isSuperseded(error)) throw error;
      if (attempt === SUPERSEDED_RETRY_DELAYS_MS.length) {
        // Still superseded after every retry: the successor went to a client
        // that is not this one, and is not reaching our jar — the signature
        // of a stolen token rotated first. The server cannot tell that from a
        // slow sibling tab, so it does not revoke inside its grace window;
        // this client can, and ends the family with the token it still holds
        // (logout revokes by family). Done here rather than in AuthContext so
        // every path — the mount-time refresh as much as the proactive one —
        // does it; otherwise a thief would keep the session for 30 days.
        await logout().catch(() => undefined);
        throw error;
      }
      await delay(SUPERSEDED_RETRY_DELAYS_MS[attempt]);
    }
  }
};

/**
 * Runs `work` under a cross-tab Web Lock where the browser has them, so tabs
 * refresh one after another — each presenting the token the previous one
 * left in the shared jar — instead of racing. Without Web Locks (older
 * browsers, the test environment) the retry above is the only remedy.
 */
const acrossTabs = async <T>(work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? // `request` types its result as the callback's return value (a promise
      // of T); awaiting flattens it to the T the lock was held for.
      await navigator.locks.request(REFRESH_LOCK, work)
    : work();

let inFlight: Promise<ApiResponse<LoginResponse>> | null = null;

/**
 * Rotates the session. Concurrent callers in one tab share one request (the
 * mount-time and proactive refreshes, or several 401s at once, would
 * otherwise race each other); tabs are serialised by `acrossTabs`; a
 * supersession that still happens is retried with backoff.
 */
export const refreshToken = (): Promise<ApiResponse<LoginResponse>> => {
  inFlight ??= acrossTabs(async () => {
    const response = await refreshWithRetry();
    if (response.success && response.data) await persistMobileTokens(response.data);
    return response;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

// The client's reactive refresh-and-retry on an expired session (see "SESSION
// RECOVERY" in api/client.ts) runs this same single-flight refresh. A 2xx
// that does not report success is a failed refresh too.
setSessionRefresher(async () => {
  const response = await refreshToken();
  if (!response.success) throw new ApiError('Session refresh failed', 401);
});

/**
 * Logout is intentionally fire-and-forget: the server revokes the session and
 * clears the cookies, but the client should complete its local logout even
 * if that request fails, so this does not go through the throwing client.
 *
 * The endpoint sits beneath `/auth/refresh` so the browser sends it the
 * path-scoped refresh cookie — the credential it revokes. The native client
 * has no reliable cookie jar, so it sends its stored refresh token in the
 * body instead, with the mobile signal that tells the server to read it.
 *
 * On the native platform the stored tokens are cleared regardless of whether
 * the network call succeeds — the device should forget the session either way.
 */
export const logout = async (): Promise<void> => {
  const native = isNativePlatform();
  try {
    await fetch(`${API_BASE_URL}/auth/refresh/logout`, {
      method: 'POST',
      ...getAuthHeaders(clientTypeHeaders()),
      ...(native ? { body: JSON.stringify({ refreshToken: getCachedRefreshToken() ?? undefined }) } : {}),
    });
  } finally {
    if (isNativePlatform()) await clearTokens();
  }
};
