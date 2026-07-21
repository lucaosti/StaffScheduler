/**
 * Staff Scheduler – Backend API server entry point.
 *
 * This file is intentionally thin: it owns process bootstrap (DB pool +
 * `app.listen`) while the actual Express wiring lives in `./app.ts` so it can
 * be unit-tested without spinning up an HTTP server.
 *
 * @author Luca Ostinelli
 */

import { config } from './config';
import { database } from './config/database';
import { closeRedis } from './config/redis';
import { logger } from './config/logger';
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
    }

    const app = buildApp(pool);
    const port = config.server.port;

    const server = app.listen(port, () => {
      logger.info(`Staff Scheduler API server is running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/api/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        try { await pool.end(); } catch { /* ignore */ }
        try { await closeRedis(); } catch { /* ignore */ }
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
