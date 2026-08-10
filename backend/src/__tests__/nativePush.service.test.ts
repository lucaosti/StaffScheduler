/**
 * NativePushService tests — the FCM/APNs configuration gates, the per-platform
 * send paths (including the gone-token detection each reports differently),
 * and device-token CRUD.
 */

export {};

const fetchMock = jest.fn();
const signMock = jest.fn().mockReturnValue('signed-jwt');
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: (...a: unknown[]) => signMock(...a) },
}));

import { config } from '../config';
import {
  isNativePushConfigured,
  sendNativePush,
  resetApnsJwtCache,
  NativePushGoneError,
  NativePushService,
} from '../services/NativePushService';

const original = JSON.parse(JSON.stringify(config.nativePush));

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  jest.clearAllMocks();
  resetApnsJwtCache();
  global.fetch = fetchMock;
  config.nativePush.fcmServerKey = original.fcmServerKey;
  config.nativePush.apnsKeyId = original.apnsKeyId;
  config.nativePush.apnsTeamId = original.apnsTeamId;
  config.nativePush.apnsPrivateKey = original.apnsPrivateKey;
  config.nativePush.apnsBundleId = original.apnsBundleId;
});

const configureFcm = () => {
  config.nativePush.fcmServerKey = 'fcm-key';
};

const configureApns = () => {
  config.nativePush.apnsKeyId = 'kid';
  config.nativePush.apnsTeamId = 'team';
  config.nativePush.apnsPrivateKey = 'PEM';
  config.nativePush.apnsBundleId = 'com.staffscheduler.app';
};

describe('isNativePushConfigured', () => {
  it('is false with neither transport configured', () => {
    config.nativePush.fcmServerKey = undefined;
    config.nativePush.apnsKeyId = undefined;
    config.nativePush.apnsTeamId = undefined;
    config.nativePush.apnsPrivateKey = undefined;
    config.nativePush.apnsBundleId = undefined;
    expect(isNativePushConfigured()).toBe(false);
  });

  it('is true with only FCM configured', () => {
    config.nativePush.fcmServerKey = undefined;
    config.nativePush.apnsKeyId = undefined;
    config.nativePush.apnsTeamId = undefined;
    config.nativePush.apnsPrivateKey = undefined;
    config.nativePush.apnsBundleId = undefined;
    configureFcm();
    expect(isNativePushConfigured()).toBe(true);
  });

  it('is true with only APNs fully configured', () => {
    config.nativePush.fcmServerKey = undefined;
    configureApns();
    expect(isNativePushConfigured()).toBe(true);
  });

  it('is false with APNs only partially configured', () => {
    config.nativePush.fcmServerKey = undefined;
    config.nativePush.apnsKeyId = 'kid';
    config.nativePush.apnsTeamId = undefined;
    config.nativePush.apnsPrivateKey = 'PEM';
    config.nativePush.apnsBundleId = 'com.staffscheduler.app';
    expect(isNativePushConfigured()).toBe(false);
  });
});

describe('sendNativePush', () => {
  it('throws when native push is not configured at all', async () => {
    config.nativePush.fcmServerKey = undefined;
    config.nativePush.apnsKeyId = undefined;
    config.nativePush.apnsTeamId = undefined;
    config.nativePush.apnsPrivateKey = undefined;
    config.nativePush.apnsBundleId = undefined;
    await expect(
      sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' })
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('android (FCM)', () => {
    it('throws when FCM specifically is not configured, even if APNs is', async () => {
      config.nativePush.fcmServerKey = undefined;
      configureApns();
      await expect(
        sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' })
      ).rejects.toThrow(/FCM is not configured/);
    });

    it('sends via the FCM legacy HTTP API when configured', async () => {
      configureFcm();
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: 1, failure: 0 }));

      await sendNativePush({ platform: 'android', token: 'device-token' }, { title: 'Hi', body: 'There' });

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://fcm.googleapis.com/fcm/send');
      expect(options.headers.Authorization).toBe('key=fcm-key');
      expect(JSON.parse(options.body)).toMatchObject({
        to: 'device-token',
        notification: { title: 'Hi', body: 'There' },
      });
    });

    it('throws NativePushGoneError when FCM reports the token unregistered', async () => {
      configureFcm();
      fetchMock.mockResolvedValueOnce(jsonResponse({ failure: 1, results: [{ error: 'NotRegistered' }] }));

      await expect(
        sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' })
      ).rejects.toBeInstanceOf(NativePushGoneError);
    });

    it('throws a plain error on a transient FCM failure', async () => {
      configureFcm();
      fetchMock.mockResolvedValueOnce(jsonResponse({ failure: 1, results: [{ error: 'Unavailable' }] }));

      await expect(
        sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' })
      ).rejects.not.toBeInstanceOf(NativePushGoneError);
    });

    it('treats an unparseable FCM response body as an empty result rather than throwing on the body itself', async () => {
      configureFcm();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);

      await expect(
        sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' })
      ).rejects.toThrow(/FCM send failed/);
    });

    it('aborts the FCM request once the timeout elapses', async () => {
      configureFcm();
      jest.useFakeTimers();
      try {
        fetchMock.mockImplementationOnce(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
            })
        );
        const resultPromise = sendNativePush({ platform: 'android', token: 't' }, { title: 'Hi' });
        const assertion = expect(resultPromise).rejects.toThrow(/aborted/);
        await jest.advanceTimersByTimeAsync(20_000);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('ios (APNs)', () => {
    it('throws when APNs specifically is not configured, even if FCM is', async () => {
      configureFcm();
      config.nativePush.apnsKeyId = undefined;
      await expect(
        sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' })
      ).rejects.toThrow(/APNs is not configured/);
    });

    it('sends via APNs with a bearer provider JWT and the bundle id as topic', async () => {
      configureApns();
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await sendNativePush({ platform: 'ios', token: 'device-token' }, { title: 'Hi' });

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.push.apple.com/3/device/device-token');
      expect(options.headers.Authorization).toBe('bearer signed-jwt');
      expect(options.headers['apns-topic']).toBe('com.staffscheduler.app');
      expect(signMock).toHaveBeenCalledTimes(1);
    });

    it('mints the provider JWT once and reuses it across sends', async () => {
      configureApns();
      fetchMock.mockResolvedValue(jsonResponse({}));

      await sendNativePush({ platform: 'ios', token: 'a' }, { title: 'Hi' });
      await sendNativePush({ platform: 'ios', token: 'b' }, { title: 'Hi' });

      expect(signMock).toHaveBeenCalledTimes(1);
    });

    it('throws NativePushGoneError when APNs reports the token unregistered', async () => {
      configureApns();
      fetchMock.mockResolvedValueOnce(jsonResponse({ reason: 'Unregistered' }, 410));

      await expect(
        sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' })
      ).rejects.toBeInstanceOf(NativePushGoneError);
    });

    it('throws a plain error on a non-gone APNs failure', async () => {
      configureApns();
      fetchMock.mockResolvedValueOnce(jsonResponse({ reason: 'InternalServerError' }, 500));

      await expect(
        sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' })
      ).rejects.not.toBeInstanceOf(NativePushGoneError);
    });

    it('falls back to the HTTP status when a 400/410 body carries no reason field', async () => {
      configureApns();
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 400));

      await expect(
        sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' })
      ).rejects.toThrow(/APNs send failed: 400/);
    });

    it('treats an unparseable APNs response body as an empty result rather than throwing on the body itself', async () => {
      configureApns();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);

      await expect(
        sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' })
      ).rejects.toThrow(/APNs send failed: 410/);
    });

    it('aborts the APNs request once the timeout elapses', async () => {
      configureApns();
      jest.useFakeTimers();
      try {
        fetchMock.mockImplementationOnce(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
            })
        );
        const resultPromise = sendNativePush({ platform: 'ios', token: 't' }, { title: 'Hi' });
        const assertion = expect(resultPromise).rejects.toThrow(/aborted/);
        await jest.advanceTimersByTimeAsync(20_000);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('NativePushService', () => {
  type Tuple = [unknown, unknown];
  const makePool = () => {
    const execute = jest.fn();
    return { pool: { execute } as never, execute };
  };

  it('registerToken upserts by token and returns the stored row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            user_id: 5,
            platform: 'ios',
            token: 'device-token',
            is_active: 1,
            created_at: 'x',
            last_used_at: null,
          },
        ],
        null,
      ] as Tuple);

    const result = await new NativePushService(pool).registerToken(5, 'ios', 'device-token');

    expect(result).toEqual({
      id: 1,
      userId: 5,
      platform: 'ios',
      token: 'device-token',
      isActive: true,
      createdAt: 'x',
      lastUsedAt: null,
    });
    expect(execute.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('deactivateToken deactivates by user and token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await new NativePushService(pool).deactivateToken(5, 'device-token');

    expect(execute.mock.calls[0][0]).toMatch(/is_active = FALSE/);
    expect(execute.mock.calls[0][1]).toEqual([5, 'device-token']);
  });

  it('deactivate flips a token off by id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await new NativePushService(pool).deactivate(7);

    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it('listActiveForUser returns only active tokens, newest first', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 2, user_id: 5, platform: 'android', token: 't2', is_active: 1, created_at: 'y', last_used_at: null }],
      null,
    ] as Tuple);

    const result = await new NativePushService(pool).listActiveForUser(5);

    expect(result).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toMatch(/is_active = TRUE/);
  });
});
