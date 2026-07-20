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
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, pendingApprovalDelegateBody as delegateBody, pendingApprovalDecisionBody as decisionBody } from '../schemas';
import { PendingApprovalService } from '../services/PendingApprovalService';
import { ApprovalEngineService } from '../services/ApprovalEngineService';
import { dispatchPendingApprovalDecision } from '../services/PendingApprovalDispatch';


export function createPendingApprovalsRouter(pool: Pool): express.Router {
  const router = express.Router();

  // GET / — list pending approvals assigned to the current user
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const svc = new PendingApprovalService(pool);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const items = await svc.listForUser(req.user!.id, status);
    res.json({ success: true, data: { items, total: items.length } });
  }));

  // GET /count — badge count for current user (always status=pending)
  router.get('/count', authenticate, asyncHandler(async (req, res) => {
    const svc = new PendingApprovalService(pool);
    const count = await svc.countForUser(req.user!.id);
    res.json({ success: true, data: { count } });
  }));

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

  // POST /:id/approve — approve, whichever entity this decision belongs to
  router.post('/:id/approve', authenticate, validateParams(idParam), validateBody(decisionBody), asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const note = res.locals.body.note ?? null;
    const result = await dispatchDecision(id, req.user!.id, 'approved', note);
    res.json({ success: true, data: result });
  }));

  // POST /:id/reject — reject, whichever entity this decision belongs to
  router.post('/:id/reject', authenticate, validateParams(idParam), validateBody(decisionBody), asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const note = res.locals.body.note ?? null;
    const result = await dispatchDecision(id, req.user!.id, 'rejected', note);
    res.json({ success: true, data: result });
  }));

  // Structure-delegation actions + chain-of-command view. Entity-agnostic —
  // apply to any pending_approvals row (change request, time-off, loan, or
  // shift swap) that was assigned to a structure (`assigned_to_org_unit_id`).

  router.post('/:id/keep', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const engine = new ApprovalEngineService(pool);
    const result = await engine.keepForSelf(Number(req.params.id), req.user!.id);
    res.json({ success: true, data: result });
  }));

  router.post('/:id/delegate', authenticate, validateParams(idParam), validateBody(delegateBody), asyncHandler(async (req, res) => {
    const engine = new ApprovalEngineService(pool);
    const result = await engine.delegateToPerson(Number(req.params.id), req.user!.id, res.locals.body.targetUserId);
    res.json({ success: true, data: result });
  }));

  router.post('/:id/open-to-structure', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const engine = new ApprovalEngineService(pool);
    const result = await engine.openToStructure(Number(req.params.id), req.user!.id);
    res.json({ success: true, data: result });
  }));

  router.get('/:id/chain', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const engine = new ApprovalEngineService(pool);
    const chain = await engine.getDecisionChain(Number(req.params.id), req.user!.id);
    res.json({ success: true, data: chain });
  }));

  return router;
}
