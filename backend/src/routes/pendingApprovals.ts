/**
 * Pending Approvals Router
 *
 * Endpoints for approvers to view and act on workflow-routed decisions
 * (change requests, time-off, loans, shift swaps) — plus the
 * structure-delegation actions a unit head can take on a decision assigned
 * to their org unit as a whole, and the chain-of-command view.
 *
 * GET  /api/pending-approvals                       — list approvals assigned to caller
 * GET  /api/pending-approvals/count                 — badge count (status=pending)
 * POST /api/pending-approvals/:id/approve
 * POST /api/pending-approvals/:id/reject
 * POST /api/pending-approvals/:id/keep               — structure head keeps it
 * POST /api/pending-approvals/:id/delegate           — structure head delegates to one person
 * POST /api/pending-approvals/:id/open-to-structure  — structure head opens it to the whole team
 * GET  /api/pending-approvals/:id/chain              — chain of command for this decision
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validateParams, validateBody } from '../middleware/validation';
import { PendingApprovalService } from '../services/PendingApprovalService';
import { ApprovalEngineService } from '../services/ApprovalEngineService';
import { dispatchPendingApprovalDecision } from '../services/PendingApprovalDispatch';
import { logger } from '../config/logger';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const delegateBody = z.object({ targetUserId: z.coerce.number().int().positive() });

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

  // Both /approve and /reject are entity-agnostic — dispatchPendingApprovalDecision
  // (services/PendingApprovalDispatch.ts) inspects which entity FK is set and
  // calls the matching service. Authorization is per-instance (assignee, or
  // any structure member once opened — enforced inside each service's call
  // into ApprovalEngineService.decidePendingApproval), not a blanket
  // permission code, so there's no requirePermission gate here.
  const dispatchDecision = (
    id: number,
    userId: number,
    decision: 'approved' | 'rejected',
    note: string | null
  ): Promise<unknown> => dispatchPendingApprovalDecision(pool, id, userId, decision, note);

  // Matches the fallback each per-entity route already used (shiftSwap.ts,
  // timeOff.ts, org.ts loan routes, changeRequests.ts): 404/403 are the only
  // statuses distinguished by message content, and everything else — status
  // conflicts, compliance-check rejections, business-rule errors — is a 409,
  // not a 500. These aren't application errors, so they shouldn't log as one.
  const mapDecisionError = (error: any): { status: number; code: string; message: string } => {
    const msg: string = error?.message ?? '';
    if (msg.toLowerCase().includes('not found')) return { status: 404, code: 'NOT_FOUND', message: msg };
    if (msg === 'Forbidden' || msg.includes('Not authorized')) return { status: 403, code: 'FORBIDDEN', message: msg };
    return { status: 409, code: 'CONFLICT', message: msg };
  };

  // POST /:id/approve — approve, whichever entity this decision belongs to
  router.post('/:id/approve', authenticate, validateParams(idParams), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      const result = await dispatchDecision(id, req.user!.id, 'approved', note);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const { status, code, message } = mapDecisionError(error);
      if (status === 500) logger.error('Failed to approve pending approval:', error);
      res.status(status).json({ success: false, error: { code, message: status === 500 ? 'Failed to approve pending approval' : message } });
    }
  });

  // POST /:id/reject — reject, whichever entity this decision belongs to
  router.post('/:id/reject', authenticate, validateParams(idParams), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      const result = await dispatchDecision(id, req.user!.id, 'rejected', note);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const { status, code, message } = mapDecisionError(error);
      if (status === 500) logger.error('Failed to reject pending approval:', error);
      res.status(status).json({ success: false, error: { code, message: status === 500 ? 'Failed to reject pending approval' : message } });
    }
  });

  // Structure-delegation actions + chain-of-command view. Entity-agnostic —
  // apply to any pending_approvals row (change request, time-off, loan, or
  // shift swap) that was assigned to a structure (`assigned_to_org_unit_id`).

  const mapDelegationError = (error: any): { status: number; code: string; message: string } => {
    const msg: string = error?.message ?? '';
    if (msg.toLowerCase().includes('not found')) return { status: 404, code: 'NOT_FOUND', message: msg };
    if (msg === 'Forbidden' || msg.includes('Not authorized')) return { status: 403, code: 'FORBIDDEN', message: msg };
    if (msg.includes('not assigned to a structure') || msg.includes('must be a member')) {
      return { status: 400, code: 'VALIDATION_ERROR', message: msg };
    }
    return { status: 409, code: 'CONFLICT', message: msg };
  };

  router.post('/:id/keep', authenticate, validateParams(idParams), async (req, res) => {
    try {
      const engine = new ApprovalEngineService(pool);
      const result = await engine.keepForSelf(Number(req.params.id), req.user!.id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const { status, code, message } = mapDelegationError(error);
      res.status(status).json({ success: false, error: { code, message } });
    }
  });

  router.post('/:id/delegate', authenticate, validateParams(idParams), validateBody(delegateBody), async (req, res) => {
    try {
      const engine = new ApprovalEngineService(pool);
      const result = await engine.delegateToPerson(Number(req.params.id), req.user!.id, res.locals.body.targetUserId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const { status, code, message } = mapDelegationError(error);
      res.status(status).json({ success: false, error: { code, message } });
    }
  });

  router.post('/:id/open-to-structure', authenticate, validateParams(idParams), async (req, res) => {
    try {
      const engine = new ApprovalEngineService(pool);
      const result = await engine.openToStructure(Number(req.params.id), req.user!.id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const { status, code, message } = mapDelegationError(error);
      res.status(status).json({ success: false, error: { code, message } });
    }
  });

  router.get('/:id/chain', authenticate, validateParams(idParams), async (req, res) => {
    try {
      const engine = new ApprovalEngineService(pool);
      const chain = await engine.getDecisionChain(Number(req.params.id));
      res.json({ success: true, data: chain });
    } catch (error: any) {
      const { status, code, message } = mapDelegationError(error);
      res.status(status).json({ success: false, error: { code, message } });
    }
  });

  return router;
}
