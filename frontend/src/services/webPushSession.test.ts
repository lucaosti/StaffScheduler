/**
 * Dropping this browser's Web Push subscription at logout (#841).
 *
 * A subscription belongs to the browser, not to the user signed in when it
 * was made, so leaving it in place sends the signed-out user's notifications
 * to whoever signs in next on the same browser.
 */

import { dropWebPushSubscription } from './webPushSession';
import * as notificationService from './notificationService';

jest.mock('./notificationService', () => ({ unsubscribePush: jest.fn() }));

const unsubscribePush = notificationService.unsubscribePush as jest.Mock;

const installServiceWorker = (subscription: { endpoint: string; unsubscribe: jest.Mock } | null) => {
  const getSubscription = jest.fn().mockResolvedValue(subscription);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: jest.fn().mockResolvedValue({ pushManager: { getSubscription } }),
    },
  });
};

afterEach(() => {
  jest.clearAllMocks();
  // Restore the jsdom default: no service worker support at all.
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('dropWebPushSubscription', () => {
  it('tells the backend and unsubscribes the browser', async () => {
    const subscription = { endpoint: 'https://push.example/abc', unsubscribe: jest.fn().mockResolvedValue(true) };
    installServiceWorker(subscription);
    unsubscribePush.mockResolvedValue({ success: true });

    const controller = new AbortController();
    await dropWebPushSubscription(controller.signal);

    // Abortable and never a trigger for a session refresh (#841 re-review).
    expect(unsubscribePush).toHaveBeenCalledWith('https://push.example/abc', {
      signal: controller.signal,
      sessionRecovery: false,
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('still unsubscribes the browser when the backend call fails', async () => {
    const subscription = { endpoint: 'https://push.example/abc', unsubscribe: jest.fn().mockResolvedValue(true) };
    installServiceWorker(subscription);
    unsubscribePush.mockRejectedValue(new Error('401'));

    await expect(dropWebPushSubscription()).resolves.toBeUndefined();

    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('does nothing when the browser has no subscription', async () => {
    installServiceWorker(null);
    await dropWebPushSubscription();
    expect(unsubscribePush).not.toHaveBeenCalled();
  });

  it('does nothing without service worker support', async () => {
    await expect(dropWebPushSubscription()).resolves.toBeUndefined();
    expect(unsubscribePush).not.toHaveBeenCalled();
  });
});
