/**
 * Mobile (Capacitor) auth-token storage.
 *
 * WHY THIS EXISTS AT ALL. The web SPA never sees its JWTs: the httpOnly
 * `token`/`refresh_token` cookies are the only place they live, and the
 * browser's same-origin cookie jar attaches them automatically. That breaks
 * down inside a Capacitor WebView: the app's own content is served from a
 * local/custom-scheme origin (`capacitor://localhost` or similar) while API
 * calls go to the real backend domain — a cross-origin relationship from the
 * WebView's perspective, where SameSite cookie behavior and WKWebView/Android
 * WebView third-party-cookie handling are unreliable and vary by OS version.
 * The mitigation the mobile OWASP guidance and the Capacitor/Ionic ecosystem
 * both converge on: capture the token values explicitly (the backend's
 * mobile-client response mode — see `backend/src/routes/auth.ts` — puts them
 * in the JSON body precisely for this) and store them in native secure
 * storage, then send them as an `Authorization: Bearer` header instead of
 * depending on the cookie jar.
 *
 * WHY `@capacitor/preferences` AND NOT SOMETHING HARDWARE-BACKED. Preferences
 * is the simplest official Capacitor storage plugin, but it is NOT, by
 * itself, iOS Keychain/Android Keystore *hardware-backed* encryption on every
 * platform — on Android it is backed by SharedPreferences (encrypted at the
 * filesystem level by the OS, not per-entry hardware-backed like Keystore);
 * on iOS it does use UserDefaults, not Keychain. A plugin such as
 * `capacitor-secure-storage-plugin`, which wraps Keychain/Keystore directly,
 * is the harder-guarantee option. This first version deliberately accepts
 * Preferences' weaker-than-Keychain guarantee rather than take on a native
 * dependency this environment cannot build and verify end-to-end — the
 * tradeoff to revisit if the token's on-device exposure needs hardening
 * further (tracked as a fast-follow alongside biometric unlock, which gates
 * access to whatever is stored here rather than changing what stores it).
 *
 * WHY AN IN-MEMORY CACHE ALONGSIDE THE ASYNC STORE. `Preferences.get` is
 * async, but headers are attached synchronously on every outgoing request
 * (see `apiUtils.getAuthHeaders`). `loadCachedTokens` populates the cache
 * once at startup; every read after that is synchronous.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Header + value the mobile client sends to opt into the token-in-body response mode. */
export const MOBILE_CLIENT_HEADER = 'X-Client-Type';
export const MOBILE_CLIENT_VALUE = 'mobile';

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const REFRESH_TOKEN_KEY = 'auth.refreshToken';

/** True only inside the Capacitor native shell (iOS/Android); false for the ordinary web SPA. */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

let cachedAccessToken: string | null = null;
let cachedRefreshToken: string | null = null;

/** Synchronous read of the last-loaded/stored access token, for attaching to outgoing requests. */
export const getCachedAccessToken = (): string | null => cachedAccessToken;

/** Synchronous read of the last-loaded/stored refresh token, for the refresh call's body. */
export const getCachedRefreshToken = (): string | null => cachedRefreshToken;

/** Loads both tokens from secure storage into the in-memory cache — call once, on app startup. */
export const loadCachedTokens = async (): Promise<void> => {
  const [access, refresh] = await Promise.all([
    Preferences.get({ key: ACCESS_TOKEN_KEY }),
    Preferences.get({ key: REFRESH_TOKEN_KEY }),
  ]);
  cachedAccessToken = access.value ?? null;
  cachedRefreshToken = refresh.value ?? null;
};

/** Persists both tokens to secure storage and updates the in-memory cache. */
export const storeTokens = async (accessToken: string, refreshToken: string): Promise<void> => {
  cachedAccessToken = accessToken;
  cachedRefreshToken = refreshToken;
  await Promise.all([
    Preferences.set({ key: ACCESS_TOKEN_KEY, value: accessToken }),
    Preferences.set({ key: REFRESH_TOKEN_KEY, value: refreshToken }),
  ]);
};

/** Clears both tokens from secure storage and the in-memory cache — call on logout. */
export const clearTokens = async (): Promise<void> => {
  cachedAccessToken = null;
  cachedRefreshToken = null;
  await Promise.all([
    Preferences.remove({ key: ACCESS_TOKEN_KEY }),
    Preferences.remove({ key: REFRESH_TOKEN_KEY }),
  ]);
};
