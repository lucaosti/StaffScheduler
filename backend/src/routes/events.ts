/**
 * Server-Sent Events stream (F18).
 *
 *   GET /api/events/stream     authenticated; long-lived response
 *
 * Heartbeat comments every 30s keep proxies from closing the connection.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { eventBus } from '../services/EventBus';

const HEARTBEAT_MS = 30_000;

export const createEventsRouter = (): Router => {
  const router = Router();

  router.get('/stream', authenticate, (req: Request, res: Response) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    // Send a hello frame so EventSource fires `open` immediately.
    res.write('event: hello\ndata: {}\n\n');

    const userId = req.user!.id;
    eventBus.subscribe(userId, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        // Will be cleaned up by the close handler.
      }
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      eventBus.unsubscribe(userId, res);
    };
    req.on('close', cleanup);
    req.on('end', cleanup);
  });

  return router;
};
