/**
 * `routes/shiftSwap.ts` — the open shift board endpoints.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 7, email: 'a@x', allowedOrgUnitIds: null };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: () => true,
}));

jest.mock('../services/ShiftSwapService');
jest.mock('../services/RbacService');

import { ShiftSwapService } from '../services/ShiftSwapService';
import { RbacService } from '../services/RbacService';
import { createShiftSwapRouter } from '../routes/shiftSwap';
import { NotFoundError, ConflictError, ForbiddenError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mount = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/shift-swap', createShiftSwapRouter(fakePool));
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  (RbacService.prototype.getUserOrgUnitSubtreeIds as jest.Mock).mockResolvedValue([1, 2]);
});

describe('POST /shift-swap/:id/respond', () => {
  it('lets the target accept or decline a pending swap', async () => {
    (ShiftSwapService.prototype.respondAsTarget as jest.Mock).mockResolvedValueOnce({ id: 1, status: 'pending' });
    const res = await request(mount()).post('/api/shift-swap/1/respond').send({ accepted: true, notes: 'sure' });
    expect(res.status).toBe(200);
    expect(ShiftSwapService.prototype.respondAsTarget).toHaveBeenCalledWith(1, 7, true, 'sure');
  });
});

describe('POST /shift-swap/open', () => {
  it('creates an offer for the caller', async () => {
    (ShiftSwapService.prototype.createOpenOffer as jest.Mock).mockResolvedValueOnce({ id: 1, status: 'open' });
    const res = await request(mount()).post('/api/shift-swap/open').send({ assignmentId: 100 });
    expect(res.status).toBe(201);
    expect(ShiftSwapService.prototype.createOpenOffer).toHaveBeenCalledWith(7, 100, null);
  });

  it('propagates a conflict from the service', async () => {
    (ShiftSwapService.prototype.createOpenOffer as jest.Mock).mockRejectedValueOnce(
      new ConflictError('already posted as an open offer')
    );
    const res = await request(mount()).post('/api/shift-swap/open').send({ assignmentId: 100 });
    expect(res.status).toBe(409);
  });

  it('rejects a missing assignmentId', async () => {
    const res = await request(mount()).post('/api/shift-swap/open').send({});
    expect(res.status).toBe(400);
    expect(ShiftSwapService.prototype.createOpenOffer).not.toHaveBeenCalled();
  });
});

describe('GET /shift-swap/open', () => {
  it('resolves the caller visible org units and lists offers', async () => {
    (ShiftSwapService.prototype.listOpenOffers as jest.Mock).mockResolvedValueOnce([{ id: 1 }]);
    const res = await request(mount()).get('/api/shift-swap/open');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 1 }]);
    expect(ShiftSwapService.prototype.listOpenOffers).toHaveBeenCalledWith(7, [1, 2], false);
  });

  it('passes mine=true when requested', async () => {
    (ShiftSwapService.prototype.listOpenOffers as jest.Mock).mockResolvedValueOnce([]);
    const res = await request(mount()).get('/api/shift-swap/open').query({ mine: '1' });
    expect(res.status).toBe(200);
    expect(ShiftSwapService.prototype.listOpenOffers).toHaveBeenCalledWith(7, [1, 2], true);
  });
});

describe('POST /shift-swap/open/:id/claim', () => {
  it('claims an offer', async () => {
    (ShiftSwapService.prototype.claimOpenOffer as jest.Mock).mockResolvedValueOnce({ id: 501, status: 'pending' });
    const res = await request(mount()).post('/api/shift-swap/open/1/claim').send({ assignmentId: 200 });
    expect(res.status).toBe(201);
    expect(ShiftSwapService.prototype.claimOpenOffer).toHaveBeenCalledWith(1, 7, 200, null);
  });

  it('returns 404 when the offer does not exist', async () => {
    (ShiftSwapService.prototype.claimOpenOffer as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Open shift offer not found')
    );
    const res = await request(mount()).post('/api/shift-swap/open/1/claim').send({ assignmentId: 200 });
    expect(res.status).toBe(404);
  });
});

describe('POST /shift-swap/open/:id/cancel', () => {
  it('cancels the caller own offer', async () => {
    (ShiftSwapService.prototype.cancelOpenOffer as jest.Mock).mockResolvedValueOnce({ id: 1, status: 'cancelled' });
    const res = await request(mount()).post('/api/shift-swap/open/1/cancel');
    expect(res.status).toBe(200);
    expect(ShiftSwapService.prototype.cancelOpenOffer).toHaveBeenCalledWith(1, 7);
  });

  it('returns 403 when the caller does not own the offer', async () => {
    (ShiftSwapService.prototype.cancelOpenOffer as jest.Mock).mockRejectedValueOnce(new ForbiddenError('Forbidden'));
    const res = await request(mount()).post('/api/shift-swap/open/1/cancel');
    expect(res.status).toBe(403);
  });
});
