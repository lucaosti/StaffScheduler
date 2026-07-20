/**
 * Approval Workflows Routes
 *
 * Exposes the multi-step approval workflow engine via REST.
 *
 * GET    /api/approval-workflows            — list all workflows
 * POST   /api/approval-workflows            — create a workflow
 * GET    /api/approval-workflows/:type      — get workflow by change type
 * PUT    /api/approval-workflows/:id        — update a workflow
 * DELETE /api/approval-workflows/:id        — delete a workflow
 * POST   /api/approval-workflows/escalate   — trigger escalation check (cron-callable)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ApprovalEngineService } from '../services/ApprovalEngineService';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, typeParam, createApprovalWorkflowBody, updateApprovalWorkflowBody } from '../schemas';

export const createApprovalWorkflowsRouter = (pool: Pool): Router => {
  const router = Router();
  const engine = new ApprovalEngineService(pool);

  // Escalation trigger — called by cron or admin; requires approval.manage.
  // Marks overdue pending_approvals as 'escalated' and creates new pending_approvals
  // for the escalated approver (manager chain walk).
  router.post('/escalate', authenticate, requirePermission('approval.manage'), asyncHandler(async (_req: Request, res: Response) => {
    const result = await engine.processEscalations();
    res.json({ success: true, data: result });
  }));

  // List all workflows
  router.get('/', authenticate, requirePermission('approval.manage'), asyncHandler(async (_req: Request, res: Response) => {
    const workflows = await engine.listWorkflows();
    res.json({ success: true, data: workflows });
  }));

  // Get workflow by change type
  router.get('/:type', authenticate, requirePermission('approval.manage'), validateParams(typeParam), asyncHandler(async (_req: Request, res: Response) => {
    const workflow = await engine.getWorkflowByChangeType(res.locals.params.type);
    if (!workflow) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
    }
    res.json({ success: true, data: workflow });
  }));

  // Create a workflow
  router.post('/', authenticate, requirePermission('approval.manage'), validateBody(createApprovalWorkflowBody), asyncHandler(async (_req: Request, res: Response) => {
    const { changeType, requireAll, description, steps } = res.locals.body;
    const workflow = await engine.createWorkflow({ changeType, requireAll, description, steps });
    res.status(201).json({ success: true, data: workflow, message: 'Workflow created' });
  }));

  // Update a workflow
  router.put('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), validateBody(updateApprovalWorkflowBody), asyncHandler(async (_req: Request, res: Response) => {
    const { id } = res.locals.params;
    const workflow = await engine.updateWorkflow(id, res.locals.body);
    res.json({ success: true, data: workflow, message: 'Workflow updated' });
  }));

  // Delete a workflow
  router.delete('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const { id } = res.locals.params;
    await engine.deleteWorkflow(id);
    res.json({ success: true, message: 'Workflow deleted' });
  }));

  return router;
};
