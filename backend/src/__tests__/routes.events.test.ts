/**
 * Server-Sent Events route tests (routes/events.ts).
 *
 * Verifies the cleanup idempotency guarantee: both the `close` and `end`
 * events on the request must trigger cleanup only once, so eventBus.unsubscribe
 * is called exactly once regardless of which events fire and in what order.
 *
 * @author Luca Ostinelli
 */

import { EventEmitter } from 'events';
import express, { Request, Response } from 'express';
import { createEventsRouter } from '../routes/events';
import { eventBus } from '../services/EventBus';

// Stub authenticate so we can control req.user in tests.
jest.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: () => void) => {
    (req as any).user = { id: 42 };
    next();
  },
  requirePermission: () => (_req: Request, _res: Response, next: () => void) => next(),
  requireModule: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

/**
 * Build a minimal fake (req, res) pair that lets us exercise the SSE handler
 * without a real HTTP connection.  The fake request is an EventEmitter so we
 * can fire `close` and `end` programmatically.
 */
const buildFakePair = () => {
  const req = new EventEmitter() as any;
  req.user = { id: 42 };
  req.headers = {};

  const res = {
    set: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn(),
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
  } as unknown as Response;

  return { req, res };
};

/**
 * Invoke the SSE route handler directly (bypassing supertest / HTTP) so we
 * can emit request lifecycle events synchronously.
 */
const invokeStreamHandler = (req: any, res: Response) => {
  const app = express();
  app.use(createEventsRouter());

  // Extract the single route handler registered for GET /stream.
  const layer = (app._router.stack as any[]).find((l: any) => l.handle?.stack);
  const routeLayer = layer?.handle?.stack?.find(
    (l: any) => l.route?.path === '/stream'
  );
  const handlers: ((...args: any[]) => void)[] = routeLayer?.route?.stack?.map(
    (l: any) => l.handle
  ) ?? [];

  // Run every middleware/handler in the route's stack sequentially.
  let i = 0;
  const next = () => {
    const fn = handlers[i++];
    if (fn) fn(req, res, next);
  };
  next();
};

describe('GET /stream — cleanup idempotency', () => {
  let unsubscribeSpy: jest.SpyInstance;

  beforeEach(() => {
    unsubscribeSpy = jest.spyOn(eventBus, 'unsubscribe');
    jest.useFakeTimers();
  });

  afterEach(() => {
    unsubscribeSpy.mockRestore();
    jest.useRealTimers();
  });

  it('calls eventBus.unsubscribe exactly once when both close and end fire', () => {
    const { req, res } = buildFakePair();
    invokeStreamHandler(req, res);

    req.emit('close');
    req.emit('end');

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(unsubscribeSpy).toHaveBeenCalledWith(42, res);
  });

  it('calls eventBus.unsubscribe exactly once when only close fires', () => {
    const { req, res } = buildFakePair();
    invokeStreamHandler(req, res);

    req.emit('close');

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('calls eventBus.unsubscribe exactly once when only end fires', () => {
    const { req, res } = buildFakePair();
    invokeStreamHandler(req, res);

    req.emit('end');

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
