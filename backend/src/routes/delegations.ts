/**
 * Delegation Routes
 *
 * POST   /api/delegations        — create a delegation (delegator = req.user)
 * GET    /api/delegations        — list delegations where req.user is delegator or delegatee
 * DELETE /api/delegations/:id    — revoke a delegation (only the delegator may do this)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { DelegationService } from '../services/DelegationService';
import { authenticate } from '../middleware/auth';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, createDelegationBody } from '../schemas';
import { logger } from '../config/logger';

export const createDelegationsRouter = (pool: Pool): Router => {
  const router = Router();
  const delegationService = new DelegationService(pool);

  // Create a delegation
  router.post('/', authenticate, validateBody(createDelegationBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user!;
      const { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId } = res.locals.body;

      const delegation = await delegationService.createDelegation(
        actor.id,
        actor.permissions ?? [],
        { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId: scopeOrgUnitId ?? null }
      );

      res.status(201).json({ success: true, data: delegation, message: 'Delegation created' });
    } catch (error: any) {
      if (
        error.message?.includes('escalation') ||
        error.message?.includes('yourself')
      ) {
        return res.status(422).json({
          success: false,
          error: { code: 'DELEGATION_INVALID', message: error.message },
        });
      }
      logger.error('Error creating delegation:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create delegation' } });
    }
  });

  // List delegations for the current user
  router.get('/', authenticate, async (req: Request, res: Response) => {
    try {
      const delegations = await delegationService.listForUser(req.user!.id);
      res.json({ success: true, data: delegations });
    } catch (error) {
      logger.error('Error fetching delegations:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch delegations' } });
    }
  });

  // Revoke a delegation
  router.delete('/:id', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;

      await delegationService.revokeDelegation(id, req.user!.id);
      res.json({ success: true, message: 'Delegation revoked' });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.message?.includes('Only the delegator')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: error.message } });
      }
      logger.error('Error revoking delegation:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke delegation' } });
    }
  });

  return router;
};
