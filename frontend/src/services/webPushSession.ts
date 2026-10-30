/**
 * Ends this browser's Web Push subscription when the session ends (#841).
 *
 * WHY AT LOGOUT. A `PushSubscription` belongs to the browser, not to the user
 * who was signed in when it was made, and the backend sends a user's
 * notifications to every endpoint registered for them. Left in place, the
 * next person to sign in on this browser — a shared ward PC is the ordinary
 * case — keeps receiving the previous user's notifications. Re-enabling is
 * one toggle in Settings, so the cost to the user who returns is small.
 *
 * WHY THE BROWSER UNSUBSCRIBES EVEN WHEN THE BACKEND CALL FAILS. The server
 * call needs the session that is ending, and may already have lost it (a
 * refresh failure is one route into logout). Unsubscribing in the browser
 * still stops delivery: the push service then answers the backend's next send
 * with "gone", which is what lets the server retire the endpoint itself.
 *
 * `getRegistration()` rather than `serviceWorker.ready`: `ready` never
 * settles when no worker is registered (every development build — see
 * index.tsx), and logout must not hang on it.
 *
 * @author Luca Ostinelli
 */

import { unsubscribePush } from './notificationService';

export const dropWebPushSubscription = async (signal?: AbortSignal): Promise<void> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  try {
    // Never refreshes: it can still be running as the next user signs in.
    await unsubscribePush(subscription.endpoint, { signal, sessionRecovery: false });
  } catch {
    // See the header: the browser-side unsubscribe below is what matters.
  } finally {
    await subscription.unsubscribe();
  }
};
