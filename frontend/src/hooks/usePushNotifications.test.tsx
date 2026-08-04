/**
 * usePushNotifications tests (#310).
 *
 * jsdom implements none of the Push API, so `navigator.serviceWorker` and
 * `Notification` are stubbed the same way Attendance.test.tsx stubs
 * `navigator.geolocation`: Object.defineProperty on the real navigator/window,
 * removed in afterEach so it never leaks into an unrelated suite.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePushNotifications } from './usePushNotifications';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const getPushPublicKey = jest.fn();
const subscribePush = jest.fn();
const unsubscribePush = jest.fn();
jest.mock('../services/notificationService', () => ({
  __esModule: true,
  getPushPublicKey: (...a: unknown[]) => getPushPublicKey(...a),
  subscribePush: (...a: unknown[]) => subscribePush(...a),
  unsubscribePush: (...a: unknown[]) => unsubscribePush(...a),
}));

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const setBrowserSupport = (subscription: unknown) => {
  const pushManager = {
    getSubscription: jest.fn().mockResolvedValue(subscription),
    subscribe: jest.fn().mockResolvedValue({
      endpoint: 'https://push.example/new',
      toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }),
    }),
  };
  const registration = { pushManager };
  Object.defineProperty(global.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  Object.defineProperty(global.window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(global.window, 'Notification', {
    configurable: true,
    value: { requestPermission: jest.fn().mockResolvedValue('granted') },
  });
  return { pushManager, registration };
};

const clearBrowserSupport = () => {
  delete (global.navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (global.window as { PushManager?: unknown }).PushManager;
  delete (global.window as { Notification?: unknown }).Notification;
};

beforeEach(() => {
  jest.clearAllMocks();
  getPushPublicKey.mockResolvedValue(okResponse({ enabled: true, publicKey: 'cHVibGljLWtleQ' }));
});

afterEach(() => {
  clearBrowserSupport();
});

describe('usePushNotifications', () => {
  it('reports unsupported when the browser has no Push API', () => {
    clearBrowserSupport();
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    expect(result.current.state).toBe('unsupported');
  });

  it('reports unsubscribed when the browser has no existing subscription', async () => {
    setBrowserSupport(null);
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'));
  });

  it('reports subscribed when the browser already has a subscription', async () => {
    setBrowserSupport({ endpoint: 'https://push.example/existing' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('subscribed'));
  });

  it('subscribes: requests permission, calls pushManager.subscribe, and posts to the backend', async () => {
    const { pushManager } = setBrowserSupport(null);
    subscribePush.mockResolvedValue(okResponse(undefined));
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'));

    await act(async () => {
      await result.current.subscribe();
    });

    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'p', auth: 'a' },
    });
    expect(result.current.state).toBe('subscribed');
  });

  it('sets an error and does not subscribe when permission is denied', async () => {
    setBrowserSupport(null);
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unsubscribed'));
    (window.Notification.requestPermission as jest.Mock).mockResolvedValue('denied');

    await act(async () => {
      await result.current.subscribe();
    });

    expect(subscribePush).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/not granted/);
    expect(result.current.state).toBe('unsubscribed');
  });

  it('unsubscribes: calls the backend and the browser subscription', async () => {
    const existing = { endpoint: 'https://push.example/existing', unsubscribe: jest.fn().mockResolvedValue(true) };
    setBrowserSupport(existing);
    unsubscribePush.mockResolvedValue(okResponse(undefined));
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('subscribed'));

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(unsubscribePush).toHaveBeenCalledWith('https://push.example/existing');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(result.current.state).toBe('unsubscribed');
  });

  it('exposes whether the server has Web Push configured at all', async () => {
    getPushPublicKey.mockResolvedValue(okResponse({ enabled: false, publicKey: null }));
    setBrowserSupport(null);
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.serverEnabled).toBe(false));
  });
});
