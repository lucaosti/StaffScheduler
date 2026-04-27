/**
 * Staff Scheduler – Backend API server entry point.
 *
 * This file is intentionally thin: it owns process bootstrap (DB pool +
 * `app.listen`) while the actual Express wiring lives in `./app.ts` so it can
 * be unit-tested without spinning up an HTTP server.
 *
 * @author Luca Ostinelli
 */

import { createPool } from 'mysql2/promise';
import { config } from './config';
import { logger } from './config/logger';
import { buildApp } from './app';

export async function startServer(): Promise<void> {
  try {
    const pool = createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    try {
      await pool.execute('SELECT 1');
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
