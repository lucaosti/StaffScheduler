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
import { logger } from './config/logger';
import { buildApp } from './app';
import { database } from './config/database';

export async function startServer(): Promise<void> {
  try {
    const pool = database.getPool();

    try {
      await database.testConnection();
      logger.info('Database connection test successful');
    } catch (error) {
      logger.error('Database connection test failed:', error);
      process.exit(1);
    }

    const app = buildApp(pool);
    const port = config.server.port;

    app.listen(port, () => {
      logger.info(`Staff Scheduler API server is running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/api/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
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
