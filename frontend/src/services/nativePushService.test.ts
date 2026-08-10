/**
 * The Capacitor native-push branch.
 *
 * `isNativePlatform()` (from `mobileAuthStorage`) is mocked per test case to
 * drive the two branches: the native branch (mocked `true`) must request
 * permission, register with the plugin, and forward the resulting token to
 * the backend; the web branch (mocked `false`, the default in every other
 * test in this project) must touch none of the native plugin's API at all —
 * that regression guard is the point of this file, mirroring
 * `mobileAuth.test.ts`'s reasoning for the auth flow.
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
  apiClient: { post: jest.fn() },
}));

const navigateBrowserMock = jest.fn();
jest.mock('../utils/navigateBrowser', () => ({
  navigateBrowser: (...a: unknown[]) => navigateBrowserMock(...a),
}));

import { registerForNativePush, resetNativePushListeners } from './nativePushService';

const isNativePlatformMock = jest.spyOn(mobileAuthStorage, 'isNativePlatform');
const postMock = apiClient.post as jest.Mock;

const registrationHandler = () =>
  addListenerMock.mock.calls.find((c) => c[0] === 'registration')?.[1] as
    | ((token: { value: string }) => Promise<void> | void)
    | undefined;

const tapHandler = () =>
  addListenerMock.mock.calls.find((c) => c[0] === 'pushNotificationActionPerformed')?.[1] as
    | (() => void)
    | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  resetNativePushListeners();
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

describe('registerForNativePush — native platform', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
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
