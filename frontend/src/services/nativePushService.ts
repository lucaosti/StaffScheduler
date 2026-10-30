/**
 * Native (Capacitor) push registration.
 *
 * ONLY runs inside the Capacitor native shell (`isNativePlatform()`); the web
 * SPA has no Push API for a device token to come from, and this module is a
 * no-op there. Mirrors the mobile auth flow's shape: `registerForNativePush`
 * is called once, right after a successful login (see `AuthContext.tsx`),
 * the same lifecycle point `mobileAuthStorage`'s token persistence hooks
 * into — a device token is only worth registering for a signed-in user, and
 * login is the first point the app knows who that is.
 *
 * WHY REGISTER ON EVERY LOGIN RATHER THAN ONCE AT INSTALL. The OS can reissue
 * a fresh token for the same physical device (app reinstall, token
 * rotation), and the backend's upsert-by-token registration
 * (`NativePushService.registerToken`) makes re-registering the same token a
 * no-op — so unconditionally registering on every login costs nothing and
 * covers the rotation case without a separate "did this change" check.
 *
 * WHY NATIVE PUSH IS OPT-IN AT BUILD TIME (`REACT_APP_NATIVE_PUSH=true`). The
 * plugin's native `register()` needs the platform's push configuration: on
 * Android it calls Firebase Messaging unconditionally, and without a
 * `google-services.json` that throws inside the native bridge, which turns it
 * into a crash of the whole app — a JavaScript `try` around the call never
 * sees it. Whether that configuration exists is a property of the build, not
 * of the device, so the build decides. Detecting Firebase at runtime was
 * rejected: the plugin exposes no such probe, and the probe would be the same
 * crashing call. Defaulting to on was rejected too: a build without the
 * configuration would crash right after the first login.
 *
 * WHY THE NOTIFICATION-TAP HANDLER IS THIS MINIMAL. The design deliberately
 * keeps deep-linking out of this first version: `pushNotificationActionPerformed`
 * always navigates to the notifications list rather than routing per
 * notification type, which is tracked as its own fast-follow. A full
 * navigation (`navigateBrowser`, see `utils/navigateBrowser.ts`) rather than
 * a React Router `navigate()` call is used because this module runs outside
 * any component tree — there is no router context to call into from a
 * plugin listener registered once at app startup.
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiClient } from '../api/client';
import { navigateBrowser } from '../utils/navigateBrowser';
import { isNativePlatform } from './mobileAuthStorage';

const NOTIFICATIONS_PATH = '/notifications';

/**
 * True only for a build made with `REACT_APP_NATIVE_PUSH=true` (injected by
 * vite.config.ts). Read at call time, not captured at module load, so the
 * value the bundle was built with is the only thing deciding it.
 */
const isNativePushEnabled = (): boolean => process.env.REACT_APP_NATIVE_PUSH === 'true';

let listenersAttached = false;

/**
 * The device token this session registered with the backend, so logout can
 * deactivate exactly that row. Held in memory only: a cold start re-registers
 * on login anyway (see the file header), and a token from a previous process
 * whose session ended without a logout is the server's to expire.
 */
let registeredToken: string | null = null;

/** Test-only: clears the memoised listener flag and registered token between test cases. */
export function resetNativePushListeners(): void {
  listenersAttached = false;
  registeredToken = null;
}

/**
 * Requests push permission, obtains a device token via the plugin, and
 * registers it with the backend. A no-op on the web platform and on a native
 * build that did not enable push (see the file header). Failures are
 * swallowed (logged to the console) rather than thrown: a user who declines
 * the permission prompt, or a device without push services, should not break
 * login.
 */
export const registerForNativePush = async (): Promise<void> => {
  if (!isNativePlatform() || !isNativePushEnabled()) return;

  attachListeners();

  try {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;
    await PushNotifications.register();
  } catch (err) {
    console.error('Native push registration failed', err);
  }
};

/**
 * Deactivates this device's token before the session ends (#841).
 *
 * The backend delivers a user's notifications to every active token it holds
 * for them, and a token identifies the device, not the person — so without
 * this, whoever signs in next on the device receives the previous user's
 * notifications. Called by `AuthContext.logout` BEFORE the session is
 * revoked, because the DELETE is an authenticated call. Best-effort like
 * registration: a failure is logged, never thrown, so logout always finishes.
 */
export const unregisterNativePush = async (signal?: AbortSignal): Promise<void> => {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await apiClient.delete<undefined, '/notifications/push/device-token'>(
      '/notifications/push/device-token',
      // Never refreshes: it can still be running as the next user signs in.
      { body: { token }, signal, sessionRecovery: false }
    );
  } catch (err) {
    console.error('Failed to deactivate device push token', err);
  }
};

/**
 * Attaches the plugin's listeners exactly once per app session — called
 * lazily from `registerForNativePush` rather than at module load, so a web
 * session (which never calls it) never touches the native-only plugin.
 */
function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener('registration', (token) => {
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    registeredToken = token.value;
    apiClient
      .post<undefined, '/notifications/push/device-token'>('/notifications/push/device-token', {
        platform,
        token: token.value,
      })
      .catch((err) => {
        console.error('Failed to register device push token', err);
      });
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('Native push registration error', err);
  });

  // Deliberately minimal (see file header): any tap navigates to the
  // notifications list rather than a per-notification-type destination.
  PushNotifications.addListener('pushNotificationActionPerformed', () => {
    navigateBrowser(NOTIFICATIONS_PATH);
  });
}
