/**
 * Calendar routes (F04).
 *
 *   POST /api/calendar/token                  auth: get-or-create own token
 *   POST /api/calendar/token/rotate           auth: rotate own token
 *   GET  /api/calendar/feed.ics?token=...     public: per-user iCal feed
 *   GET  /api/calendar/department/:id.ics?token=...
 *                                             public: aggregated feed (managers/admins)
 *
 * Per-user and per-department feeds emit ETag + Cache-Control headers and
 * honour `If-None-Match` so calendar clients that cache by ETag (most
 * modern ones) avoid re-downloading the body when nothing has changed.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { CalendarService } from '../services/CalendarService';
import { RbacService } from '../services/RbacService';

const writeIcsResponse = (
  res: Response,
  body: string,
  etag: string,
  ifNoneMatch: string | undefined
): void => {
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }
  res
    .status(200)
    .type('text/calendar; charset=utf-8')
    .set('ETag', etag)
    .set('Cache-Control', 'private, max-age=300')
    .send(body);
};

export const createCalendarRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new CalendarService(pool);
  const rbac = new RbacService(pool);

  router.post('/token', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const token = await service.getOrCreateToken(req.user!.id);
    res.json({ success: true, data: { token } });
  }));

  router.post('/token/rotate', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const token = await service.rotateToken(req.user!.id);
    res.json({ success: true, data: { token } });
  }));

  router.get('/feed.ics', asyncHandler(async (req: Request, res: Response) => {
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
    const { body, etag } = await service.buildUserFeed(userId);
    writeIcsResponse(res, body, etag, req.headers['if-none-match'] as string | undefined);
  }));

  router.get('/department/:id.ics', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
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

      // Authorisation: the token's user must be a full administrator (holds the
      // `settings.manage` permission, resolved the same way as every other
      // permission check in the app — role grants + active delegations) OR
      // the manager of the target department.
      const departmentId = res.locals.params.id;
      const permissions = await rbac.getEffectivePermissions(userId);
      const isAdmin = permissions.includes('settings.manage');

      let allowed = isAdmin;
      if (!allowed) {
        const [deptRows] = await pool.execute<RowDataPacket[]>(
          `SELECT manager_id FROM departments WHERE id = ? LIMIT 1`,
          [departmentId]
        );
        allowed = deptRows.length > 0 && deptRows[0].manager_id === userId;
      }
      if (!allowed) {
        res.status(403).type('text/plain').send('forbidden');
        return;
      }

      const { body, etag } = await service.buildDepartmentFeed(departmentId);
      writeIcsResponse(res, body, etag, req.headers['if-none-match'] as string | undefined);
  }));

  return router;
};
