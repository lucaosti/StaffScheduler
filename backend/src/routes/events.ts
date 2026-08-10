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

    const heartbeat = setInterval(/* istanbul ignore next */() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        /* istanbul ignore next */
        // Synchronous write failures land here. Writing to an already-
        // destroyed stream instead emits 'error' asynchronously — outside
        // this try/catch — which is what the 'error' listener below is for.
      }
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      eventBus.unsubscribe(userId, res);
    };
    req.on('close', cleanup);
    req.on('end', cleanup);
    // Without a listener, an 'error' emitted by either stream (e.g. the
    // client aborting mid-write, or the heartbeat firing on an already-
    // destroyed response) is an unhandled EventEmitter error — which Node
    // treats as an uncaught exception and can take down the whole process,
    // surfacing as an unrelated failure in whatever test happens to be
    // running at that moment (#556). Cleanup already tolerates being called
    // more than once, so wiring it here too is just closing this last gap.
    req.on('error', cleanup);
    res.on('error', cleanup);
  });

  return router;
};
