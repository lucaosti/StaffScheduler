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
import { asyncHandler } from '../middleware/asyncHandler';
import { logger } from '../config/logger';

type RuntimeMode = 'production' | 'demo' | 'development';

export const createSystemRouter = (pool: Pool): Router => {
  const router = Router();

  router.get('/info', asyncHandler(async (_req, res) => {
    let mode: RuntimeMode = 'production';
    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT value FROM system_settings WHERE category = 'runtime' AND \`key\` = 'mode' LIMIT 1`
      );
      mode = (rows[0]?.value as RuntimeMode) || 'production';
    } catch (error) {
      // Never let this endpoint take the app down — fall back to production mode.
      logger.error('Failed to read system info', error);
    }

    res.json({
      success: true,
      data: { mode },
    });
  }));

  return router;
};
