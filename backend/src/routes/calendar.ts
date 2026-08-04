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
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { idParam, calendarFeedQuery, calendarAggregateQuery, createCalendarTokenBody } from '../schemas';
import { NotFoundError } from '../errors';
import { CalendarService } from '../services/CalendarService';
import { RbacService } from '../services/RbacService';
import { resolveVisibleOrgUnits } from '../services/orgScope';

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

export const createCalendarRouter = (pool: Pool, readPool: Pool = pool): Router => {
  const router = Router();
  const service = new CalendarService(pool, readPool);
  const rbac = new RbacService(pool);

  // A person's own feed tokens. Authentication alone: these are theirs, and no
  // permission gates seeing your own subscriptions.
  router.get('/tokens', authenticate, async (req: Request, res: Response) => {
    res.json({ success: true, data: await service.listTokens(req.user!.id) });
  });

  // Creating one is ADDITIVE: existing subscriptions keep working, which is the
  // whole point of the change. The raw token is in this response and nowhere
  // else, ever — only its digest is stored.
  router.post('/tokens', authenticate, validateBody(createCalendarTokenBody), async (req: Request, res: Response) => {
    const created = await service.createToken(req.user!.id, res.locals.body.label);
    res.status(201).json({
      success: true,
      data: created,
      message: 'Token created. Copy it now — it cannot be shown again.',
    });
  });

  router.delete('/tokens/:id', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
    const revoked = await service.revokeToken(req.user!.id, res.locals.params.id);
    if (!revoked) {
      // Unknown id, someone else's, or already revoked — all the same answer
      // from outside, deliberately: distinguishing them would tell a caller
      // whether another person's token id exists.
      throw new NotFoundError('Token not found');
    }
    res.json({ success: true, message: 'Token revoked' });
  });

  router.get('/feed.ics', validateQuery(calendarFeedQuery), async (req: Request, res: Response) => {
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
  });

  /**
   * A filtered aggregation: departments, roles, people, over a range that
   * reaches into the past.
   *
   * THE SCOPE IS RESOLVED PER FETCH, NOT BAKED INTO THE URL. A feed URL is a
   * credential that lives as long as the subscription, so a scope decided when
   * it was created would keep publishing a ward after its owner stopped
   * managing one. Every fetch re-reads the token owner's permissions and role
   * scope, which is the only way a feed can narrow when its owner's authority
   * does.
   *
   * IT ANSWERS TO THE TIMELINE'S PERMISSIONS, deliberately reusing them rather
   * than inventing a parallel rule: `timeline.read` and `timeline.read_all`
   * exist for exactly this disclosure — seeing WHEN A NAMED COLLEAGUE IS AT
   * WORK — and two rules for one disclosure is how they come to disagree. The
   * department feed's older admin-or-department-manager check stays where it is
   * so existing subscriptions keep working; this endpoint is the general form.
   */
  router.get('/aggregate.ics', validateQuery(calendarAggregateQuery), async (req: Request, res: Response) => {
    const { token, departmentId, roleId, userId, pastDays, futureDays } = res.locals.query;
    if (!token) {
      res.status(401).type('text/plain').send('token query parameter required');
      return;
    }
    const ownerId = await service.resolveToken(token);
    if (!ownerId) {
      res.status(401).type('text/plain').send('invalid token');
      return;
    }

    const permissions = await rbac.getEffectivePermissions(ownerId);
    if (!permissions.includes('timeline.read') && !permissions.includes('timeline.read_all')) {
      res.status(403).type('text/plain').send('forbidden');
      return;
    }

    const roles = await rbac.getUserRoles(ownerId);
    const visibleOrgUnitIds = await resolveVisibleOrgUnits(rbac, {
      userId: ownerId,
      permissions,
      allowedOrgUnitIds: await rbac.computeAllowedOrgUnitIds(roles),
      allPermission: 'timeline.read_all',
    });

    const { body, etag } = await service.buildAggregateFeed({
      visibleOrgUnitIds,
      ...(departmentId ? { departmentIds: departmentId } : {}),
      ...(roleId ? { roleIds: roleId } : {}),
      ...(userId ? { userIds: userId } : {}),
      ...(pastDays !== undefined ? { pastDays } : {}),
      ...(futureDays !== undefined ? { futureDays } : {}),
    });
    writeIcsResponse(res, body, etag, req.headers['if-none-match'] as string | undefined);
  });

  router.get('/department/:id.ics', validateParams(idParam), validateQuery(calendarFeedQuery), async (req: Request, res: Response) => {
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
  });

  return router;
};
