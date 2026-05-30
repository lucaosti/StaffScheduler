/**
 * System info route.
 *
 * Administrative endpoint returning runtime metadata. Access requires an
 * authenticated admin user, since system/version information should not be
 * disclosed anonymously.
 *
 * The only field reported today is `mode`, sourced from
 * `system_settings(category='runtime', key='mode')`. Defaults to
 * `production` when the row is missing.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { Router } from 'express';
import { logger } from '../config/logger';
import { authenticate, requireAdmin } from '../middleware/auth';

type RuntimeMode = 'production' | 'demo' | 'development';

export const createSystemRouter = (pool: Pool): Router => {
  const router = Router();

  router.get('/info', authenticate, requireAdmin, async (_req, res) => {
    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT value FROM system_settings WHERE category = 'runtime' AND \`key\` = 'mode' LIMIT 1`
      );
      const mode: RuntimeMode = (rows[0]?.value as RuntimeMode) || 'production';

      res.json({
        success: true,
        data: { mode },
      });
    } catch (error) {
      logger.error('Failed to read system info', error);
      // Never let this endpoint take the app down — fall back to production mode.
      res.json({
        success: true,
        data: { mode: 'production' as RuntimeMode },
      });
    }
  });

  return router;
};
