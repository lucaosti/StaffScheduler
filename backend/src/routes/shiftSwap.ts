/**
 * Shift swap routes (F01), plus the open shift board.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { User } from '../types';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import {
  createShiftSwapBody,
  createShiftSwapOfferBody,
  claimShiftSwapOfferBody,
  optionalNotesBody,
  respondToShiftSwapBody,
  idParam,
  shiftSwapListQuery,
  shiftSwapOpenListQuery,
} from '../schemas';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { RbacService } from '../services/RbacService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createShiftSwapRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ShiftSwapService(pool);
  const rbac = new RbacService(pool);

  router.use(authenticate);

  router.post('/', validateBody(createShiftSwapBody), async (req: Request, res: Response) => {
    const created = await service.create({
      requesterUserId: req.user!.id,
      requesterAssignmentId: res.locals.body.requesterAssignmentId,
      targetAssignmentId: res.locals.body.targetAssignmentId,
      notes: res.locals.body.notes,
    });
    res.status(201).json({ success: true, data: created });
  });

  // ------------- Open shift board — declared before /:id so "open" is
  // never captured as a numeric :id. -------------

  router.post('/open', validateBody(createShiftSwapOfferBody), async (req: Request, res: Response) => {
    const created = await service.createOpenOffer(
      req.user!.id,
      res.locals.body.assignmentId,
      (res.locals.body.notes as string | null | undefined) ?? null
    );
    res.status(201).json({ success: true, data: created });
  });

  router.get('/open', validateQuery(shiftSwapOpenListQuery), async (req: Request, res: Response) => {
    const actor = req.user as User;
    const mine = res.locals.query.mine === '1';
    // Same "units this caller may see" scope SwapCandidateService uses for
    // its own candidate search — null means unrestricted, narrowed by a
    // scoped role where one applies.
    const scoped = actor.allowedOrgUnitIds ?? null;
    const own = await rbac.getUserOrgUnitSubtreeIds(actor.id);
    const orgUnitIds = scoped === null ? own : own.filter((unit) => scoped.includes(unit));
    const offers = await service.listOpenOffers(actor.id, orgUnitIds, mine);
    res.json({ success: true, data: offers });
  });

  router.post('/open/:id/claim', validateParams(idParam), validateBody(claimShiftSwapOfferBody), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const created = await service.claimOpenOffer(
      id,
      req.user!.id,
      res.locals.body.assignmentId,
      (res.locals.body.notes as string | null | undefined) ?? null
    );
    res.status(201).json({ success: true, data: created });
  });

  router.post('/open/:id/cancel', validateParams(idParam), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.cancelOpenOffer(id, req.user!.id);
    res.json({ success: true, data: updated });
  });

  router.get('/', validateQuery(shiftSwapListQuery), async (req: Request, res: Response) => {
    const { userId, status } = res.locals.query;
    // Approvers may list anyone's requests; everyone else is pinned to their
    // own, so a userId filter from a non-approver is ignored rather than obeyed.
    const isManager = userHasPermission(req.user, 'shiftswap.approve');
    const filters = {
      userId: isManager ? userId : req.user!.id,
      status: status as never,
    };
    const list = await service.list(filters);
    res.json({ success: true, data: list });
  });

  router.get('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const item = await service.getById(id);
    if (!item) return respondError(res, 404, 'NOT_FOUND', 'Shift swap request not found');
    const involves =
      item.requesterUserId === req.user!.id || item.targetUserId === req.user!.id;
    const isManager = userHasPermission(req.user, 'shiftswap.approve');
    if (!involves && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
    res.json({ success: true, data: item });
  });

  // The target's own decision — gated on being the target, not on any
  // permission code: whether to accept a swap of your own shift is not a
  // manager privilege, it's ownership of the thing being swapped.
  router.post('/:id/respond', validateParams(idParam), validateBody(respondToShiftSwapBody), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.respondAsTarget(
      id,
      req.user!.id,
      res.locals.body.accepted as boolean,
      (res.locals.body.notes as string | null | undefined) ?? null
    );
    res.json({ success: true, data: updated });
  });

  router.post('/:id/approve', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null, req.user!.organizationName ?? null);
    res.json({ success: true, data: updated });
  });

  router.post('/:id/decline', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.decline(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null, req.user!.organizationName ?? null);
    res.json({ success: true, data: updated });
  });

  router.post('/:id/cancel', validateParams(idParam), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.cancel(id, req.user!.id);
    res.json({ success: true, data: updated });
  });

  return router;
};
