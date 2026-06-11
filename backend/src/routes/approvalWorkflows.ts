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
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, createApprovalWorkflowBody, updateApprovalWorkflowBody } from '../schemas';
import { logger } from '../config/logger';

export const createApprovalWorkflowsRouter = (pool: Pool): Router => {
  const router = Router();
  const engine = new ApprovalEngineService(pool);

  // Escalation trigger — called by cron or admin; requires approval.manage
  router.post('/escalate', authenticate, requirePermission('approval.manage'), async (req: Request, res: Response) => {
    try {
      const nowIso: string | undefined = req.body?.now ?? undefined;
      const overdue = await engine.processEscalations(nowIso);
      res.json({ success: true, data: { overdue, count: overdue.length } });
    } catch (error) {
      logger.error('Error running escalation check:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Escalation check failed' } });
    }
  });

  // List all workflows
  router.get('/', authenticate, requirePermission('approval.manage'), async (_req: Request, res: Response) => {
    try {
      const workflows = await engine.listWorkflows();
      res.json({ success: true, data: workflows });
    } catch (error) {
      logger.error('Error listing approval workflows:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list workflows' } });
    }
  });

  // Get workflow by change type
  router.get('/:type', authenticate, requirePermission('approval.manage'), async (req: Request, res: Response) => {
    try {
      const workflow = await engine.getWorkflowByChangeType(req.params.type);
      if (!workflow) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      logger.error('Error fetching workflow:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch workflow' } });
    }
  });

  // Create a workflow
  router.post('/', authenticate, requirePermission('approval.manage'), validateBody(createApprovalWorkflowBody), async (_req: Request, res: Response) => {
    try {
      const { changeType, requireAll, description, steps } = res.locals.body;
      const workflow = await engine.createWorkflow({ changeType, requireAll, description, steps });
      res.status(201).json({ success: true, data: workflow, message: 'Workflow created' });
    } catch (error: any) {
      if (error.message?.includes('Duplicate')) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Workflow for this change type already exists' } });
      }
      logger.error('Error creating workflow:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create workflow' } });
    }
  });

  // Update a workflow
  router.put('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), validateBody(updateApprovalWorkflowBody), async (_req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const workflow = await engine.updateWorkflow(id, res.locals.body);
      res.json({ success: true, data: workflow, message: 'Workflow updated' });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
      }
      logger.error('Error updating workflow:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update workflow' } });
    }
  });

  // Delete a workflow
  router.delete('/:id', authenticate, requirePermission('approval.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      await engine.deleteWorkflow(id);
      res.json({ success: true, message: 'Workflow deleted' });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
      }
      logger.error('Error deleting workflow:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete workflow' } });
    }
  });

  return router;
};
