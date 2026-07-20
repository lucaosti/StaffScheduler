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
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { userIdParam, upsertPreferencesBody } from '../schemas';
import { PreferencesService } from '../services/PreferencesService';

export const createPreferencesRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new PreferencesService(pool);

  router.use(authenticate);

  router.get('/me', asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getByUserId(req.user!.id);
    res.json({ success: true, data });
  }));

  router.put('/me', validateBody(upsertPreferencesBody), asyncHandler(async (_req: Request, res: Response) => {
    const data = await service.upsert(_req.user!.id, res.locals.body);
    res.json({ success: true, data });
  }));

  router.get('/:userId', requirePermission('preferences.manage'), validateParams(userIdParam), asyncHandler(async (_req: Request, res: Response) => {
    const userId = res.locals.params.userId;
    const data = await service.getByUserId(userId);
    res.json({ success: true, data });
  }));

  router.put('/:userId', requirePermission('preferences.manage'), validateParams(userIdParam), validateBody(upsertPreferencesBody), asyncHandler(async (_req: Request, res: Response) => {
    const userId = res.locals.params.userId;
    const data = await service.upsert(userId, res.locals.body);
    res.json({ success: true, data });
  }));

  return router;
};
