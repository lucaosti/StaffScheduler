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
import { CalendarService } from '../services/CalendarService';

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
    const { body, etag } = await service.buildUserFeed(userId);
    writeIcsResponse(res, body, etag, req.headers['if-none-match'] as string | undefined);
  });

  router.get('/department/:id.ics', async (req: Request, res: Response) => {
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
    // `settings.manage` permission) OR the manager of the target department.
    // Permissions are resolved with a correlated EXISTS to avoid pulling in the
    // heavier UserService/RbacService for a read-only check.
    const departmentId = Number(req.params.id);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT d.manager_id,
              EXISTS(
                SELECT 1 FROM user_roles ur
                  JOIN role_permissions rp ON rp.role_id = ur.role_id
                  JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = u.id AND p.code = 'settings.manage'
                   AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
              ) AS is_admin
         FROM users u
         LEFT JOIN departments d ON d.id = ?
        WHERE u.id = ? LIMIT 1`,
      [departmentId, userId]
    );
    const row = rows[0];
    const allowed =
      !!row && (Number(row.is_admin) === 1 || row.manager_id === userId);
    if (!allowed) {
      res.status(403).type('text/plain').send('forbidden');
      return;
    }

    const { body, etag } = await service.buildDepartmentFeed(departmentId);
    writeIcsResponse(res, body, etag, req.headers['if-none-match'] as string | undefined);
  });

  return router;
};
