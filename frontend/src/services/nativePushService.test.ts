/**
 * The Capacitor native-push branch.
 *
 * `isNativePlatform()` (from `mobileAuthStorage`) is mocked per test case to
 * drive the two branches: the native branch (mocked `true`) must request
 * permission, register with the plugin, and forward the resulting token to
 * the backend; the web branch (mocked `false`, the default in every other
 * test in this project) must touch none of the native plugin's API at all —
 * that regression guard is the point of this file, mirroring
 * `mobileAuth.test.ts`'s reasoning for the auth flow. The same guard holds on
 * a native build that did not opt into push (`REACT_APP_NATIVE_PUSH`): there
 * the plugin's native `register()` would crash the app without Firebase
 * configured, so it must not be reached at all.
 */

import { Capacitor } from '@capacitor/core';
import { apiClient } from '../api/client';
import * as mobileAuthStorage from './mobileAuthStorage';

const requestPermissionsMock = jest.fn();
const registerMock = jest.fn();
const addListenerMock = jest.fn();
const getPlatformMock = jest.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

jest.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: (...a: unknown[]) => requestPermissionsMock(...a),
    register: (...a: unknown[]) => registerMock(...a),
    addListener: (...a: unknown[]) => addListenerMock(...a),
  },
}));

jest.mock('../api/client', () => ({
  apiClient: { post: jest.fn(), delete: jest.fn() },
}));

const navigateBrowserMock = jest.fn();
jest.mock('../utils/navigateBrowser', () => ({
  navigateBrowser: (...a: unknown[]) => navigateBrowserMock(...a),
}));

import { registerForNativePush, resetNativePushListeners, unregisterNativePush } from './nativePushService';

const isNativePlatformMock = jest.spyOn(mobileAuthStorage, 'isNativePlatform');
const postMock = apiClient.post as jest.Mock;
const deleteMock = apiClient.delete as jest.Mock;

const registrationHandler = () =>
  addListenerMock.mock.calls.find((c) => c[0] === 'registration')?.[1] as
    | ((token: { value: string }) => Promise<void> | void)
    | undefined;

const tapHandler = () =>
  addListenerMock.mock.calls.find((c) => c[0] === 'pushNotificationActionPerformed')?.[1] as
    | (() => void)
    | undefined;

const originalNativePush = process.env.REACT_APP_NATIVE_PUSH;

beforeEach(() => {
  jest.clearAllMocks();
  resetNativePushListeners();
  delete process.env.REACT_APP_NATIVE_PUSH;
});

afterAll(() => {
  if (originalNativePush === undefined) delete process.env.REACT_APP_NATIVE_PUSH;
  else process.env.REACT_APP_NATIVE_PUSH = originalNativePush;
});

describe('registerForNativePush — web platform (regression guard)', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
  });

  it('never requests permission or registers with the plugin', async () => {
    await registerForNativePush();
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(addListenerMock).not.toHaveBeenCalled();
  });

  it('never calls the backend', async () => {
    await registerForNativePush();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('registerForNativePush — native platform, push not enabled at build time', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
  });

  it.each([undefined, '', 'false', '1'])(
    'never touches the plugin when REACT_APP_NATIVE_PUSH is %p',
    async (value) => {
      if (value !== undefined) process.env.REACT_APP_NATIVE_PUSH = value;
      await registerForNativePush();
      expect(requestPermissionsMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
      expect(addListenerMock).not.toHaveBeenCalled();
      expect(postMock).not.toHaveBeenCalled();
    }
  );
});

describe('registerForNativePush — native platform', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    process.env.REACT_APP_NATIVE_PUSH = 'true';
    requestPermissionsMock.mockResolvedValue({ receive: 'granted' });
    postMock.mockResolvedValue({ success: true });
  });

  it('requests permission and registers with the plugin when permission is granted', async () => {
    await registerForNativePush();
    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('does not register with the plugin when permission is denied', async () => {
    requestPermissionsMock.mockResolvedValue({ receive: 'denied' });
    await registerForNativePush();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('sends the device token to the backend once the plugin reports registration', async () => {
    getPlatformMock.mockReturnValue('android');
    await registerForNativePush();

    const handler = registrationHandler();
    expect(handler).toBeDefined();
    await handler!({ value: 'device-token-123' });

    expect(postMock).toHaveBeenCalledWith('/notifications/push/device-token', {
      platform: 'android',
      token: 'device-token-123',
    });
  });

  it('reports the ios platform when Capacitor.getPlatform() is ios', async () => {
    getPlatformMock.mockReturnValue('ios');
    await registerForNativePush();

    const handler = registrationHandler();
    await handler!({ value: 'device-token-456' });

    expect(postMock).toHaveBeenCalledWith('/notifications/push/device-token', {
      platform: 'ios',
      token: 'device-token-456',
    });
  });

  it('navigates to the notifications list on a notification tap', async () => {
    await registerForNativePush();

    const handler = tapHandler();
    expect(handler).toBeDefined();

    handler!();

    expect(navigateBrowserMock).toHaveBeenCalledWith('/notifications');
  });

  it('does not throw when the permission request itself rejects', async () => {
    requestPermissionsMock.mockRejectedValue(new Error('unavailable'));
    await expect(registerForNativePush()).resolves.toBeUndefined();
  });

  it('attaches listeners only once across repeated calls', async () => {
    await registerForNativePush();
    await registerForNativePush();
    const registrationCalls = addListenerMock.mock.calls.filter((c) => c[0] === 'registration');
    expect(registrationCalls).toHaveLength(1);
  });
});

/**
 * Logout must stop the device receiving the signed-out user's notifications
 * (#841): the backend keeps sending to every active token it holds for that
 * user, so the next person to sign in on the device would get them.
 */
describe('unregisterNativePush', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
    process.env.REACT_APP_NATIVE_PUSH = 'true';
    requestPermissionsMock.mockResolvedValue({ receive: 'granted' });
    postMock.mockResolvedValue({ success: true });
    deleteMock.mockResolvedValue({ success: true });
  });

  it('deactivates the token this session registered', async () => {
    await registerForNativePush();
    await registrationHandler()!({ value: 'device-token-123' });

    await unregisterNativePush();

    expect(deleteMock).toHaveBeenCalledWith('/notifications/push/device-token', {
      body: { token: 'device-token-123' },
    });
  });

  it('forgets the token, so a second logout sends nothing', async () => {
    await registerForNativePush();
    await registrationHandler()!({ value: 'device-token-123' });
    await unregisterNativePush();
    deleteMock.mockClear();

    await unregisterNativePush();

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('sends nothing when no token was registered', async () => {
    await unregisterNativePush();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('does not throw when the backend call fails', async () => {
    await registerForNativePush();
    await registrationHandler()!({ value: 'device-token-123' });
    deleteMock.mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(unregisterNativePush()).resolves.toBeUndefined();
  });
});
