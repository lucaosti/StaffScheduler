/**
 * Tests for WebPushToggle (Settings → Personal, #310).
 */

import { render, screen, waitFor } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import WebPushToggle from './WebPushToggle';

const getPushPublicKey = jest.fn();
const subscribePush = jest.fn();
const unsubscribePush = jest.fn();
jest.mock('../../services/notificationService', () => ({
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
  Object.defineProperty(global.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(global.window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(global.window, 'Notification', {
    configurable: true,
    value: { requestPermission: jest.fn().mockResolvedValue('granted') },
  });
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

describe('<WebPushToggle />', () => {
  it('renders nothing when the browser has no Push API support', () => {
    clearBrowserSupport();
    const { container } = render(<WebPushToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a disabled note when the server has Web Push unconfigured', async () => {
    getPushPublicKey.mockResolvedValue(okResponse({ enabled: false, publicKey: null }));
    setBrowserSupport(null);
    render(<WebPushToggle />);
    expect(await screen.findByText(/not configured for this deployment/i)).toBeInTheDocument();
  });

  it('shows the toggle unchecked when the browser has no existing subscription', async () => {
    setBrowserSupport(null);
    render(<WebPushToggle />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();
  });

  it('shows the toggle checked when the browser already has a subscription', async () => {
    setBrowserSupport({ endpoint: 'https://push.example/existing' });
    render(<WebPushToggle />);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('subscribes when the toggle is switched on', async () => {
    setBrowserSupport(null);
    subscribePush.mockResolvedValue(okResponse(undefined));
    render(<WebPushToggle />);
    const toggle = await screen.findByRole('switch');

    await userEvent.click(toggle);

    await waitFor(() => expect(subscribePush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('unsubscribes when the toggle is switched off', async () => {
    setBrowserSupport({ endpoint: 'https://push.example/existing', unsubscribe: jest.fn().mockResolvedValue(true) });
    unsubscribePush.mockResolvedValue(okResponse(undefined));
    render(<WebPushToggle />);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).toBeChecked());

    await userEvent.click(toggle);

    await waitFor(() => expect(unsubscribePush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('shows an error message when subscribing fails', async () => {
    setBrowserSupport(null);
    subscribePush.mockRejectedValue(new Error('network down'));
    render(<WebPushToggle />);
    const toggle = await screen.findByRole('switch');

    await userEvent.click(toggle);

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });
});
