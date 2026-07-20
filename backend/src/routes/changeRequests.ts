/**
 * Change requests routes.
 *
 * Provides the subordinate change-proposal mechanism: any authenticated user
 * may propose a change; users with `change_request.review` may approve,
 * reject or apply it.  When applied, the audit log attributes the action to
 * the authority holder (approver) and records the proposer via
 * on_behalf_of_user_id.
 *
 * GET    /api/change-requests            list    (change_request.review)
 * POST   /api/change-requests            create  (change_request.create)
 * GET    /api/change-requests/:id        get one (change_request.review or own)
 * POST   /api/change-requests/:id/approve approve (change_request.review)
 * POST   /api/change-requests/:id/reject  reject  (change_request.review)
 * POST   /api/change-requests/:id/apply   apply   (change_request.review)
 * POST   /api/change-requests/:id/cancel  cancel  (own, pending only)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams } from '../middleware/validation';
import {
  idParam,
  changeRequestCreateBody as createBody,
  changeRequestApproveBody as approveBody,
  changeRequestRejectBody as rejectBody,
  changeRequestApplyBody as applyBody,
} from '../schemas';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { ConflictError } from '../errors';
import { User } from '../types';

export const createChangeRequestsRouter = (pool: Pool): Router => {
  const router = Router();
  const svc = new ChangeRequestService(pool);

  router.use(authenticate);

  // List (reviewers only)
  router.get('/', requirePermission('change_request.review'), asyncHandler(async (req: Request, res: Response) => {
    const { proposerUserId, approverUserId, status, changeType, targetEntityType, limit, offset } = req.query;
    const page = await svc.list({
      proposerUserId: proposerUserId ? Number(proposerUserId) : undefined,
      approverUserId: approverUserId ? Number(approverUserId) : undefined,
      status: status as string | undefined as never,
      changeType: changeType as string | undefined,
      targetEntityType: targetEntityType as string | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ success: true, data: page });
  }));

  // Create (any authenticated user with permission)
  router.post('/', validateBody(createBody), requirePermission('change_request.create'), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const cr = await svc.create(res.locals.body, actor.id);
    res.status(201).json({ success: true, data: cr, message: 'Change request submitted' });
  }));

  // Get by ID (reviewers OR the proposer themselves)
  router.get('/:id', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const cr = await svc.getById(res.locals.params.id);
    if (!cr) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Change request not found' } });
    }
    // Allow access to the proposer or anyone with review permission
    if (cr.proposerUserId !== actor.id && !userHasPermission(actor, 'change_request.review')) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    res.json({ success: true, data: cr });
  }));

  // Approve
  router.post('/:id/approve', requirePermission('change_request.review'), validateParams(idParam), validateBody(approveBody), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.approve(res.locals.params.id, actor.id, res.locals.body.justification);
      res.json({ success: true, data: cr, message: 'Change request approved' });
    } catch (error) {
      // Status-transition violations keep their historical 409 INVALID_STATUS
      // contract; everything else renders through the central error middleware.
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: error.message } });
      }
      throw error;
    }
  }));

  // Reject
  router.post('/:id/reject', requirePermission('change_request.review'), validateParams(idParam), validateBody(rejectBody), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.reject(res.locals.params.id, actor.id, res.locals.body.rejectionReason);
      res.json({ success: true, data: cr, message: 'Change request rejected' });
    } catch (error) {
      // Status-transition violations keep their historical 409 INVALID_STATUS
      // contract; everything else renders through the central error middleware.
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: error.message } });
      }
      throw error;
    }
  }));

  // Apply (marks applied; caller is responsible for executing the actual business logic)
  router.post('/:id/apply', requirePermission('change_request.review'), validateParams(idParam), validateBody(applyBody), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.apply(res.locals.params.id, actor.id, res.locals.body.justification);
      res.json({ success: true, data: cr, message: 'Change request applied' });
    } catch (error) {
      // Status-transition violations keep their historical 409 INVALID_STATUS
      // contract; everything else renders through the central error middleware.
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: error.message } });
      }
      throw error;
    }
  }));

  // Cancel (proposer only, while pending)
  router.post('/:id/cancel', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.getById(res.locals.params.id);
      if (!cr) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Change request not found' } });
      }
      if (cr.proposerUserId !== actor.id && !userHasPermission(actor, 'change_request.review')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only the proposer or a reviewer may cancel this request' } });
      }
      const updated = await svc.cancel(cr.id, actor.id);
      res.json({ success: true, data: updated, message: 'Change request cancelled' });
    } catch (error) {
      // Status-transition violations keep their historical 409 INVALID_STATUS
      // contract; everything else renders through the central error middleware.
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: error.message } });
      }
      throw error;
    }
  }));

  return router;
};
