/**
 * Calendar routes (F04).
 *
 *   POST /api/calendar/token        authenticated, get or create own token
 *   POST /api/calendar/token/rotate authenticated, rotate own token
 *   GET  /api/calendar/feed.ics?token=...  public, returns iCalendar text
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { CalendarService } from '../services/CalendarService';

export const createCalendarRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new CalendarService(pool);

  router.post('/token', authenticate, async (req: Request, res: Response) => {
    const token = await service.getOrCreateToken(req.user!.id);
    res.json({ success: true, data: { token } });
  });

  router.post('/token/rotate', authenticate, async (req: Request, res: Response) => {
    const token = await service.rotateToken(req.user!.id);
    res.json({ success: true, data: { token } });
  });

  router.get('/feed.ics', async (req: Request, res: Response) => {
    const token = (req.query.token as string | undefined) || '';
    if (!token) {
      res.status(401).type('text/plain').send('token query parameter required');
      return;
    }
    const userId = await service.resolveToken(token);
    if (!userId) {
      res.status(401).type('text/plain').send('invalid token');
      return;
    }
    const ics = await service.buildFeed(userId);
    res
      .status(200)
      .type('text/calendar; charset=utf-8')
      .set('Cache-Control', 'private, max-age=300')
      .send(ics);
  });

  return router;
};
