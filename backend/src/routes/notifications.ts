/**
 * Notifications routes (F03).
 *
 *   GET   /api/notifications                  list own (?unreadOnly=1)
 *   GET   /api/notifications/unread-count     small payload for badges
 *   PATCH /api/notifications/:id/read         mark one as read
 *   PATCH /api/notifications/read-all         mark every own notification as read
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireModule } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { NotificationService } from '../services/NotificationService';
import { logger } from '../config/logger';

export const createNotificationsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new NotificationService(pool);

  router.use(requireModule('notifications'));

  router.use(authenticate);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const list = await service.listForUser(req.user!.id, {
        unreadOnly: req.query.unreadOnly === '1',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data: list });
    } catch (err) {
      logger.error('notifications list error:', err);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list notifications' } });
    }
  });

  router.get('/unread-count', async (req: Request, res: Response) => {
    try {
      const count = await service.unreadCount(req.user!.id);
      res.json({ success: true, data: { count } });
    } catch (err) {
      logger.error('notifications unread-count error:', err);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' } });
    }
  });

  router.patch('/:id/read', validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const ok = await service.markRead(res.locals.params.id, req.user!.id);
      if (!ok) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Notification not found or already read' },
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      logger.error('notifications mark-read error:', err);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark notification as read' } });
    }
  });

  router.patch('/read-all', async (req: Request, res: Response) => {
    try {
      const updated = await service.markAllRead(req.user!.id);
      res.json({ success: true, data: { updated } });
    } catch (err) {
      logger.error('notifications read-all error:', err);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark all notifications as read' } });
    }
  });

  return router;
};
