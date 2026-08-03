/**
 * Staff Scheduler – Backend API server entry point.
 *
 * This file is intentionally thin: it owns process bootstrap (DB pool +
 * `app.listen`) while the actual Express wiring lives in `./app.ts` so it can
 * be unit-tested without spinning up an HTTP server.
 *
 * @author Luca Ostinelli
 */

// MUST be first: starts OpenTelemetry (when enabled) before http/express/mysql2
// are imported below, so their auto-instrumentation can patch them.
import './observability/otel-bootstrap';

import { config } from './config';
import { database } from './config/database';
import { closeRedis } from './config/redis';
import { logger } from './config/logger';
import { eventBus } from './services/EventBus';
import { initOptimizationWorker, closeOptimizationQueue } from './services/OptimizationQueue';
import { startOutboxWorker, stopOutboxWorker } from './services/OutboxWorker';
import { initModuleCacheInvalidation } from './services/moduleCache';
import { shutdownTracing } from './observability/tracing';
import { buildApp } from './app';

export async function startServer(): Promise<void> {
  try {
    // Single process-wide pool: the same one the `database` singleton exposes
    // to health checks and the auth middleware. Creating a second pool here
    // would double the configured connection budget against MySQL.
    const pool = database.getPool();

    try {
      await pool.execute('SELECT 1');
      logger.info('Database connection test successful');
    } catch (error) {
      logger.error('Database connection test failed:', error);
      process.exit(1);
      // `process.exit` never returns in production, but its declared type is
      // merely `never`-as-a-hint: nothing stops execution from falling through
      // here if `process.exit` is ever intercepted or mocked (exactly what a
      // test doing `jest.spyOn(process, 'exit').mockImplementation(...)` does
      // to assert on the call without killing the test runner). Without this
      // `return`, that fallthrough went on to build the app and start the real
      // outbox/optimization workers against the pool that had just failed its
      // connectivity check — a `setInterval` in OutboxWorker with a real 30s
      // period, unref'd but still alive, that fired long after the triggering
      // test had finished and crashed whatever unrelated suite happened to be
      // running under --runInBand at that moment (#394).
      return;
    }

    const app = buildApp(pool);
    const port = config.server.port;

    // Wire the SSE bus onto Redis pub/sub so events fan out across instances.
    // No-op without Redis; never throws (degrades to single-instance delivery).
    await eventBus.init();

    // Subscribe to cross-replica module-flag invalidations (no-op without Redis).
    await initModuleCacheInvalidation();

    // Start the in-process optimization worker (no-op without Redis; then
    // /generate runs synchronously instead).
    initOptimizationWorker(pool);

    // Start the email outbox delivery worker (no-op unless email is configured).
    startOutboxWorker(pool);

    const server = app.listen(port, () => {
      logger.info(`Staff Scheduler API server is running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/api/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        try { stopOutboxWorker(); } catch { /* ignore */ }
        try { await closeOptimizationQueue(); } catch { /* ignore */ }
        try { await pool.end(); } catch { /* ignore */ }
        try { await closeRedis(); } catch { /* ignore */ }
        try { await shutdownTracing(); } catch { /* ignore */ }
        logger.info('Connection pool closed, process exiting');
        process.exit(0);
      });
      /* istanbul ignore next */
      setTimeout(() => {
        logger.warn('Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, 10_000).unref();
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT',  () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Fatal error starting server:', error);
    process.exit(1);
  });
}
