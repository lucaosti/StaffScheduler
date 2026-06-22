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
import { z } from 'zod';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { User } from '../types';
import { logger } from '../config/logger';

const createBody = z.object({
  changeType: z.string().min(1).max(80),
  targetEntityType: z.string().min(1).max(60),
  targetEntityId: z.number().int().positive().nullable().optional(),
  proposedPayload: z.record(z.string(), z.unknown()),
  justification: z.string().max(2000).nullable().optional(),
});

const approveBody = z.object({
  justification: z.string().max(2000).nullable().optional(),
});

const rejectBody = z.object({
  rejectionReason: z.string().min(1).max(2000),
});

const applyBody = z.object({
  justification: z.string().max(2000).nullable().optional(),
});

export const createChangeRequestsRouter = (pool: Pool): Router => {
  const router = Router();
  const svc = new ChangeRequestService(pool);

  router.use(authenticate);

  // List (reviewers only)
  router.get('/', requirePermission('change_request.review'), async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
      logger.error('List change requests error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list change requests' } });
    }
  });

  // Create (any authenticated user with permission)
  router.post('/', requirePermission('change_request.create'), validateBody(createBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.create(res.locals.body, actor.id);
      res.status(201).json({ success: true, data: cr, message: 'Change request submitted' });
    } catch (error) {
      logger.error('Create change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create change request' } });
    }
  });

  // Get by ID (reviewers OR the proposer themselves)
  router.get('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
      logger.error('Get change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get change request' } });
    }
  });

  // Approve
  router.post('/:id/approve', requirePermission('change_request.review'), validateParams(idParam), validateBody(approveBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.approve(res.locals.params.id, actor.id, res.locals.body.justification);
      res.json({ success: true, data: cr, message: 'Change request approved' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg.includes('Cannot approve')) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: msg } });
      }
      logger.error('Approve change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to approve change request' } });
    }
  });

  // Reject
  router.post('/:id/reject', requirePermission('change_request.review'), validateParams(idParam), validateBody(rejectBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.reject(res.locals.params.id, actor.id, res.locals.body.rejectionReason);
      res.json({ success: true, data: cr, message: 'Change request rejected' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg.includes('Cannot reject')) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: msg } });
      }
      logger.error('Reject change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reject change request' } });
    }
  });

  // Apply (marks applied; caller is responsible for executing the actual business logic)
  router.post('/:id/apply', requirePermission('change_request.review'), validateParams(idParam), validateBody(applyBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const cr = await svc.apply(res.locals.params.id, actor.id, res.locals.body.justification);
      res.json({ success: true, data: cr, message: 'Change request applied' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg.includes('Cannot apply')) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: msg } });
      }
      logger.error('Apply change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to apply change request' } });
    }
  });

  // Cancel (proposer only, while pending)
  router.post('/:id/cancel', validateParams(idParam), async (req: Request, res: Response) => {
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
      const msg = error instanceof Error ? error.message : '';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg.includes('Cannot cancel')) {
        return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: msg } });
      }
      logger.error('Cancel change request error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel change request' } });
    }
  });

  return router;
};
