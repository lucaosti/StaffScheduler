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

let listenersAttached = false;

/** Test-only: clears the memoised "listeners attached" flag between test cases. */
export function resetNativePushListeners(): void {
  listenersAttached = false;
}

/**
 * Requests push permission, obtains a device token via the plugin, and
 * registers it with the backend. A no-op on the web platform. Failures are
 * swallowed (logged to the console) rather than thrown: a user who declines
 * the permission prompt, or a device without push services, should not break
 * login.
 */
export const registerForNativePush = async (): Promise<void> => {
  if (!isNativePlatform()) return;

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
 * Attaches the plugin's listeners exactly once per app session — called
 * lazily from `registerForNativePush` rather than at module load, so a web
 * session (which never calls it) never touches the native-only plugin.
 */
function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener('registration', (token) => {
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
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
