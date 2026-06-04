/**
 * Module Routes
 *
 * GET  /api/modules           — list all modules (admin)
 * PUT  /api/modules/:code     — enable / disable a module (admin)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ModuleService } from '../services/ModuleService';
import { authenticate, requirePermission } from '../middleware/auth';
import { logger } from '../config/logger';

export const createModulesRouter = (pool: Pool): Router => {
  const router = Router();
  const moduleService = new ModuleService(pool);

  router.get('/', authenticate, requirePermission('settings.manage'), async (_req: Request, res: Response) => {
    try {
      const modules = await moduleService.list();
      res.json({ success: true, data: modules });
    } catch (error) {
      logger.error('Error listing modules:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list modules' } });
    }
  });

  router.put('/:code', authenticate, requirePermission('settings.manage'), async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      const { isEnabled } = req.body;
      if (typeof isEnabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'isEnabled (boolean) is required' },
        });
      }
      const updated = await moduleService.setEnabled(code, isEnabled);
      res.json({ success: true, data: updated, message: `Module '${code}' ${isEnabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
      }
      logger.error('Error updating module:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update module' } });
    }
  });

  return router;
};
