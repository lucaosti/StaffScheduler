/**
 * Pending Approvals Router
 *
 * Endpoints for approvers to view and act on workflow-routed change requests.
 *
 * GET  /api/pending-approvals          — list approvals assigned to caller
 * GET  /api/pending-approvals/count    — badge count (status=pending)
 * POST /api/pending-approvals/:id/approve
 * POST /api/pending-approvals/:id/reject
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { PendingApprovalService } from '../services/PendingApprovalService';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { logger } from '../config/logger';

const idParams = z.object({ id: z.coerce.number().int().positive() });

export function createPendingApprovalsRouter(pool: Pool): express.Router {
  const router = express.Router();

  // GET / — list pending approvals assigned to the current user
  router.get('/', authenticate, async (req, res) => {
    try {
      const svc = new PendingApprovalService(pool);
      const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
      const items = await svc.listForUser(req.user!.id, status);
      res.json({ success: true, data: { items, total: items.length } });
    } catch (error) {
      logger.error('Failed to list pending approvals:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve pending approvals' },
      });
    }
  });

  // GET /count — badge count for current user (always status=pending)
  router.get('/count', authenticate, async (req, res) => {
    try {
      const svc = new PendingApprovalService(pool);
      const count = await svc.countForUser(req.user!.id);
      res.json({ success: true, data: { count } });
    } catch (error) {
      logger.error('Failed to count pending approvals:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to count pending approvals' },
      });
    }
  });

  // POST /:id/approve — advance the step as approved
  router.post(
    '/:id/approve',
    authenticate,
    requirePermission('change_request.approve'),
    validateParams(idParams),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        const note = typeof req.body?.note === 'string' ? req.body.note : null;
        const svc = new ChangeRequestService(pool);
        const result = await svc.advancePendingApproval(id, req.user!.id, 'approved', note);
        res.json({ success: true, data: result });
      } catch (error: any) {
        const msg: string = error?.message ?? '';
        if (msg.toLowerCase().includes('not found')) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
        }
        if (msg.includes('Not authorized') || msg.includes('already')) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: msg } });
        }
        logger.error('Failed to approve pending approval:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to approve pending approval' },
        });
      }
    }
  );

  // POST /:id/reject — advance the step as rejected (closes the change_request)
  router.post(
    '/:id/reject',
    authenticate,
    requirePermission('change_request.approve'),
    validateParams(idParams),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        const note = typeof req.body?.note === 'string' ? req.body.note : null;
        const svc = new ChangeRequestService(pool);
        const result = await svc.advancePendingApproval(id, req.user!.id, 'rejected', note);
        res.json({ success: true, data: result });
      } catch (error: any) {
        const msg: string = error?.message ?? '';
        if (msg.toLowerCase().includes('not found')) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
        }
        if (msg.includes('Not authorized') || msg.includes('already')) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: msg } });
        }
        logger.error('Failed to reject pending approval:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to reject pending approval' },
        });
      }
    }
  );

  return router;
}
