/**
 * System info route.
 *
 * Public endpoint (no authentication) returning runtime metadata that the
 * frontend uses to decide chrome-level UI choices, e.g. the demo banner.
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

export type RuntimeMode = 'production' | 'demo' | 'development';

export const createSystemRouter = (pool: Pool): Router => {
  const router = Router();

  router.get('/info', async (_req, res) => {
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
