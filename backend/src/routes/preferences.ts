/**
 * User preferences routes (F07).
 *
 *   GET  /api/preferences/me          read own
 *   PUT  /api/preferences/me          upsert own
 *   GET  /api/preferences/:userId     read another (manager)
 *   PUT  /api/preferences/:userId     upsert another (manager)
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { PreferencesService } from '../services/PreferencesService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createPreferencesRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new PreferencesService(pool);

  router.use(authenticate);

  router.get('/me', async (req: Request, res: Response) => {
    const data = await service.getByUserId(req.user!.id);
    res.json({ success: true, data });
  });

  router.put('/me', async (req: Request, res: Response) => {
    try {
      const data = await service.upsert(req.user!.id, req.body || {});
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.get('/:userId', requireManager, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    const data = await service.getByUserId(userId);
    res.json({ success: true, data });
  });

  router.put('/:userId', requireManager, async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.userId);
      const data = await service.upsert(userId, req.body || {});
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  return router;
};
