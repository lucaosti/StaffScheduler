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
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { idParam, calendarFeedQuery, createCalendarTokenBody } from '../schemas';
import { NotFoundError } from '../errors';
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

  // A person's own feed tokens. Authentication alone: these are theirs, and no
  // permission gates seeing your own subscriptions.
  router.get('/tokens', authenticate, asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await service.listTokens(req.user!.id) });
  }));

  // Creating one is ADDITIVE: existing subscriptions keep working, which is the
  // whole point of the change. The raw token is in this response and nowhere
  // else, ever — only its digest is stored.
  router.post('/tokens', authenticate, validateBody(createCalendarTokenBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await service.createToken(req.user!.id, res.locals.body.label);
    res.status(201).json({
      success: true,
      data: created,
      message: 'Token created. Copy it now — it cannot be shown again.',
    });
  }));

  router.delete('/tokens/:id', authenticate, validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const revoked = await service.revokeToken(req.user!.id, res.locals.params.id);
    if (!revoked) {
      // Unknown id, someone else's, or already revoked — all the same answer
      // from outside, deliberately: distinguishing them would tell a caller
      // whether another person's token id exists.
      throw new NotFoundError('Token not found');
    }
    res.json({ success: true, message: 'Token revoked' });
  }));

  router.get('/feed.ics', validateQuery(calendarFeedQuery), asyncHandler(async (req: Request, res: Response) => {
    const { token } = res.locals.query;
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

  router.get('/department/:id.ics', validateParams(idParam), validateQuery(calendarFeedQuery), asyncHandler(async (req: Request, res: Response) => {
      const { token } = res.locals.query;
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
