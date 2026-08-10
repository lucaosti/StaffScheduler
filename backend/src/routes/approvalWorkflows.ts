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
import { ApprovalWorkflowService } from '../services/ApprovalWorkflowService';
import { ApprovalDecisionService } from '../services/ApprovalDecisionService';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, typeParam, createApprovalWorkflowBody, updateApprovalWorkflowBody } from '../schemas';

export const createApprovalWorkflowsRouter = (pool: Pool): Router => {
  const router = Router();
  const workflows = new ApprovalWorkflowService(pool);
  const decisions = new ApprovalDecisionService(pool);

  // Escalation trigger — called by cron or admin; requires approval.manage.
  // Marks overdue pending_approvals as 'escalated' and creates new pending_approvals
  // for the escalated approver (manager chain walk).
  router.post('/escalate', authenticate, requirePermission('approval.manage'), async (_req: Request, res: Response) => {
    const result = await decisions.processEscalations();
    res.json({ success: true, data: result });
  });

  // List all workflows
  router.get('/', authenticate, requirePermission('approval.manage'), async (_req: Request, res: Response) => {
    const list = await workflows.listWorkflows();
    res.json({ success: true, data: list });
  });

  // Get workflow by change type
  router.get('/:type', authenticate, requirePermission('approval.manage'), validateParams(typeParam), async (_req: Request, res: Response) => {
    const workflow = await workflows.getWorkflowByChangeType(res.locals.params.type);
    if (!workflow) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
    }
    res.json({ success: true, data: workflow });
  });

  // Create a workflow
  router.post('/', authenticate, requirePermission('approval.manage'), validateBody(createApprovalWorkflowBody), async (_req: Request, res: Response) => {
    const { changeType, requireAll, description, steps } = res.locals.body;
    const workflow = await workflows.createWorkflow({ changeType, requireAll, description, steps });
    res.status(201).json({ success: true, data: workflow, message: 'Workflow created' });
  });

  // Update a workflow
  router.put('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), validateBody(updateApprovalWorkflowBody), async (_req: Request, res: Response) => {
    const { id } = res.locals.params;
    const workflow = await workflows.updateWorkflow(id, res.locals.body);
    res.json({ success: true, data: workflow, message: 'Workflow updated' });
  });

  // Delete a workflow
  router.delete('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
    const { id } = res.locals.params;
    await workflows.deleteWorkflow(id);
    res.json({ success: true, message: 'Workflow deleted' });
  });

  return router;
};
