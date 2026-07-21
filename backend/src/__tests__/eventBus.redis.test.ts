/**
 * EventBus Redis pub/sub tests — the multi-instance fan-out path.
 *
 * config/redis is mocked so no real connection is made. These pin the delivery
 * model: with Redis enabled, publish goes to the CHANNEL (not straight to local
 * connections), and delivery to local connections happens only via the
 * subscription handler — the invariant that gives exactly-once local delivery
 * across instances. The publish-failure fallback and init idempotency/no-op are
 * covered too.
 */

import type { Response } from 'express';

const publishMock = jest.fn();
const subscribeMock = jest.fn();
const onMock = jest.fn();
let redisEnabled = true;
let subscriberAvailable = true;

jest.mock('../config/redis', () => ({
  isRedisConfigured: () => redisEnabled,
  getRedis: () => (redisEnabled ? { publish: publishMock } : null),
  getRedisSubscriber: () =>
    redisEnabled && subscriberAvailable ? { subscribe: subscribeMock, on: onMock } : null,
}));

const loadBus = () => {
  let mod!: typeof import('../services/EventBus');
  jest.isolateModules(() => {
    mod = require('../services/EventBus');
  });
  return mod.eventBus;
};

const fakeResponse = () => {
  const writes: string[] = [];
  const res = { write: jest.fn((c: string) => { writes.push(c); return true; }) } as unknown as Response;
  return { res, writes };
};

beforeEach(() => {
  redisEnabled = true;
  subscriberAvailable = true;
  publishMock.mockReset().mockResolvedValue(1);
  subscribeMock.mockReset().mockResolvedValue(undefined);
  onMock.mockReset();
});

describe('EventBus with Redis', () => {
  it('publish fans out to the channel instead of writing locally', () => {
    const bus = loadBus();
    const { res, writes } = fakeResponse();
    bus.subscribe(7, res);

    bus.publish(7, { type: 'shift.created', payload: { id: 1 } });

    // Nothing written to the local connection directly...
    expect(writes).toHaveLength(0);
    // ...the event went to the shared channel.
    expect(publishMock).toHaveBeenCalledWith(
      'sse:user-events',
      JSON.stringify({ userId: 7, event: { type: 'shift.created', payload: { id: 1 } } })
    );
  });

  it('init subscribes and its handler delivers a channel message to local connections', async () => {
    const bus = loadBus();
    const { res, writes } = fakeResponse();
    bus.subscribe(7, res);

    await bus.init();
    expect(subscribeMock).toHaveBeenCalledWith('sse:user-events');

    // Simulate a message arriving on the channel (from any instance).
    const messageHandler = onMock.mock.calls.find(([evt]) => evt === 'message')![1];
    messageHandler('sse:user-events', JSON.stringify({ userId: 7, event: { type: 't', payload: { x: 1 } } }));

    expect(writes).toEqual(['event: t\ndata: {"x":1}\n\n']);
  });

  it('the message handler ignores other channels and malformed frames', async () => {
    const bus = loadBus();
    const { res, writes } = fakeResponse();
    bus.subscribe(7, res);
    await bus.init();
    const handler = onMock.mock.calls.find(([evt]) => evt === 'message')![1];

    handler('other-channel', JSON.stringify({ userId: 7, event: { type: 't' } }));
    handler('sse:user-events', 'not-json');

    expect(writes).toHaveLength(0);
  });

  it('init is idempotent (subscribes once)', async () => {
    const bus = loadBus();
    await bus.init();
    await bus.init();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it('a failed publish falls back to local delivery', async () => {
    publishMock.mockRejectedValueOnce(new Error('redis down'));
    const bus = loadBus();
    const { res, writes } = fakeResponse();
    bus.subscribe(7, res);

    bus.publish(7, { type: 't', payload: { x: 2 } });
    // Let the rejected promise's .catch run.
    await new Promise((r) => setImmediate(r));

    expect(writes).toEqual(['event: t\ndata: {"x":2}\n\n']);
  });

  it('init is a no-op when Redis is disabled', async () => {
    redisEnabled = false;
    const bus = loadBus();
    await bus.init();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('init degrades to single-instance when the subscribe fails', async () => {
    subscribeMock.mockRejectedValueOnce(new Error('no redis'));
    const bus = loadBus();
    await expect(bus.init()).resolves.toBeUndefined();
    // Not initialized, so publish still fans out (Redis is "configured");
    // a later successful init would still be able to subscribe.
    expect(onMock).not.toHaveBeenCalled();
  });

  it('init returns early when no subscriber client is available', async () => {
    // Configured, but the subscriber factory yields null (defensive edge).
    subscriberAvailable = false;
    const bus = loadBus();
    await bus.init();
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
