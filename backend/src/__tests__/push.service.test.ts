/**
 * PushService tests — the VAPID configuration gate, the send path, and
 * subscription CRUD.
 */

export {};

const sendNotification = jest.fn().mockResolvedValue(undefined);
const setVapidDetails = jest.fn();
jest.mock('web-push', () => ({
  __esModule: true,
  default: { sendNotification: (...a: unknown[]) => sendNotification(...a), setVapidDetails: (...a: unknown[]) => setVapidDetails(...a) },
}));

import { config } from '../config';
import { isPushConfigured, sendPush, resetVapidConfigured, PushService } from '../services/PushService';

const original = JSON.parse(JSON.stringify(config.webPush));

const configurePush = () => {
  config.webPush.vapidPublicKey = 'public-key';
  config.webPush.vapidPrivateKey = 'private-key';
  config.webPush.vapidSubject = 'mailto:test@example.com';
};

beforeEach(() => {
  jest.clearAllMocks();
  resetVapidConfigured();
  config.webPush.vapidPublicKey = original.vapidPublicKey;
  config.webPush.vapidPrivateKey = original.vapidPrivateKey;
  config.webPush.vapidSubject = original.vapidSubject;
});

describe('isPushConfigured', () => {
  it('is false without both VAPID keys', () => {
    config.webPush.vapidPublicKey = undefined;
    config.webPush.vapidPrivateKey = undefined;
    expect(isPushConfigured()).toBe(false);
  });

  it('is false with only one key set', () => {
    config.webPush.vapidPublicKey = 'public-key';
    config.webPush.vapidPrivateKey = undefined;
    expect(isPushConfigured()).toBe(false);
  });

  it('is true when both keys are present', () => {
    configurePush();
    expect(isPushConfigured()).toBe(true);
  });
});

describe('sendPush', () => {
  const subscription = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };

  it('throws when Web Push is not configured', async () => {
    config.webPush.vapidPublicKey = undefined;
    await expect(sendPush(subscription, { title: 'Hi' })).rejects.toThrow(/not configured/);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('configures VAPID details exactly once and sends via web-push when configured', async () => {
    configurePush();
    await sendPush(subscription, { title: 'Hi', body: 'There' });
    await sendPush(subscription, { title: 'Again' });

    expect(setVapidDetails).toHaveBeenCalledTimes(1);
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:test@example.com', 'public-key', 'private-key');
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls[0][0]).toEqual(subscription);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ title: 'Hi', body: 'There' });
  });
});

describe('PushService', () => {
  type Tuple = [unknown, unknown];
  const makePool = () => {
    const execute = jest.fn();
    return { pool: { execute } as never, execute };
  };

  it('subscribe upserts by endpoint and returns the stored row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            user_id: 5,
            endpoint: 'https://push.example/x',
            is_active: 1,
            created_at: 'x',
            last_used_at: null,
          },
        ],
        null,
      ] as Tuple);

    const result = await new PushService(pool).subscribe(5, {
      endpoint: 'https://push.example/x',
      keys: { p256dh: 'p', auth: 'a' },
    });

    expect(result).toEqual({
      id: 1,
      userId: 5,
      endpoint: 'https://push.example/x',
      isActive: true,
      createdAt: 'x',
      lastUsedAt: null,
    });
    expect(execute.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('unsubscribe deactivates by user and endpoint', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await new PushService(pool).unsubscribe(5, 'https://push.example/x');

    expect(execute.mock.calls[0][0]).toMatch(/is_active = FALSE/);
    expect(execute.mock.calls[0][1]).toEqual([5, 'https://push.example/x']);
  });

  it('deactivate flips a subscription off by id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await new PushService(pool).deactivate(7);

    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it('listActiveForUser returns only active subscriptions, newest first', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 2, user_id: 5, endpoint: 'e2', is_active: 1, created_at: 'y', last_used_at: null }],
      null,
    ] as Tuple);

    const result = await new PushService(pool).listActiveForUser(5);

    expect(result).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toMatch(/is_active = TRUE/);
  });
});
