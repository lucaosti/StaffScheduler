/**
 * Route handler tests for `routes/delegations.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * DelegationService is fully mocked. The 401 scenario is exercised by
 * temporarily swapping the stubbed authenticate for one that returns 401,
 * which matches the real middleware behaviour for missing Authorization
 * headers without requiring a live database connection.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// ── Configurable user for authenticated tests ─────────────────────────────────

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'admin',
  email: 'admin@example.com',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      ...currentUser,
      isActive: true,
      permissions: require('./helpers/permissions').permissionsForRole(currentUser.role),
    };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/DelegationService');

import { DelegationService } from '../services/DelegationService';
import { createDelegationsRouter } from '../routes/delegations';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/delegations', createDelegationsRouter(fakePool));
  app.use(errorHandler);
  return app;
};

/** Build an app where authenticate always returns 401 — simulates no token. */
const mountUnauthApp = (): express.Express => {
  const authModule = require('../middleware/auth');
  const saved = authModule.authenticate;
  authModule.authenticate = (_req: any, res: any, _next: any) =>
    res.status(401).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Authorization token is required' } });

  const app = express();
  app.use(express.json());
  app.use('/api/delegations', createDelegationsRouter(fakePool));

  // Restore immediately after building (the router holds a closure reference
  // to the swapped function, so the 401 path remains active for this app).
  authModule.authenticate = saved;
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('delegations router GET /', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(mountUnauthApp()).get('/api/delegations');
    expect(res.status).toBe(401);
  });

  it('returns 200 with delegations list for authenticated user', async () => {
    const fakeDelegations = [
      { id: 1, delegatorId: 1, delegateeId: 2, permissionCodes: ['timeoff.approve'] },
      { id: 2, delegatorId: 3, delegateeId: 1, permissionCodes: ['schedule.read'] },
    ];
    (DelegationService.prototype.listForUser as jest.Mock) = jest.fn().mockResolvedValue(fakeDelegations);

    const res = await request(mountApp()).get('/api/delegations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(DelegationService.prototype.listForUser as jest.Mock).toHaveBeenCalledWith(1);
  });

  it('returns empty array when user has no delegations', async () => {
    (DelegationService.prototype.listForUser as jest.Mock) = jest.fn().mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/delegations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 when service throws', async () => {
    (DelegationService.prototype.listForUser as jest.Mock) = jest.fn().mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/delegations');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes the authenticated user id to listForUser', async () => {
    currentUser = { id: 7, role: 'manager', email: 'manager@example.com' };
    const listFn = jest.fn().mockResolvedValue([]);
    (DelegationService.prototype.listForUser as jest.Mock) = listFn;

    await request(mountApp()).get('/api/delegations');

    expect(listFn).toHaveBeenCalledWith(7);
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('delegations router POST /', () => {
  const validBody = {
    delegateeId: 2,
    permissionCodes: ['timeoff.approve'],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  it('returns 201 when delegation is created successfully', async () => {
    const fakeDelegation = { id: 10, delegatorId: 1, delegateeId: 2, permissionCodes: ['timeoff.approve'] };
    (DelegationService.prototype.createDelegation as jest.Mock) = jest.fn().mockResolvedValue(fakeDelegation);

    const res = await request(mountApp()).post('/api/delegations').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
    expect(res.body.message).toBe('Delegation created');
  });

  it('returns 400 when delegateeId is missing', async () => {
    const { delegateeId: _omit, ...body } = validBody;
    const res = await request(mountApp()).post('/api/delegations').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when permissionCodes is missing', async () => {
    const res = await request(mountApp()).post('/api/delegations').send({
      delegateeId: 2,
      expiresAt: validBody.expiresAt,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when permissionCodes is an empty array', async () => {
    const res = await request(mountApp()).post('/api/delegations').send({
      ...validBody,
      permissionCodes: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when permissionCodes is not an array', async () => {
    const res = await request(mountApp()).post('/api/delegations').send({
      ...validBody,
      permissionCodes: 'timeoff.approve',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when expiresAt is missing', async () => {
    const res = await request(mountApp()).post('/api/delegations').send({
      delegateeId: 2,
      permissionCodes: ['timeoff.approve'],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when service throws escalation error', async () => {
    (DelegationService.prototype.createDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new ConflictError('Cannot delegate — privilege escalation detected')
    );

    const res = await request(mountApp()).post('/api/delegations').send(validBody);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DELEGATION_INVALID');
  });

  it('returns 422 when service throws yourself error', async () => {
    (DelegationService.prototype.createDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new ConflictError('Cannot delegate to yourself')
    );

    const res = await request(mountApp()).post('/api/delegations').send(validBody);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DELEGATION_INVALID');
  });

  it('returns 500 on unknown service error', async () => {
    (DelegationService.prototype.createDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new Error('unexpected db failure')
    );

    const res = await request(mountApp()).post('/api/delegations').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes scopeOrgUnitId to the service when provided', async () => {
    const createFn = jest.fn().mockResolvedValue({ id: 11, delegatorId: 1 });
    (DelegationService.prototype.createDelegation as jest.Mock) = createFn;

    await request(mountApp())
      .post('/api/delegations')
      .send({ ...validBody, scopeOrgUnitId: 5 });

    expect(createFn).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      expect.objectContaining({ scopeOrgUnitId: 5 }),
      null
    );
  });

  it('passes null scopeOrgUnitId when not provided', async () => {
    const createFn = jest.fn().mockResolvedValue({ id: 12, delegatorId: 1 });
    (DelegationService.prototype.createDelegation as jest.Mock) = createFn;

    await request(mountApp()).post('/api/delegations').send(validBody);

    expect(createFn).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      expect.objectContaining({ scopeOrgUnitId: null }),
      null
    );
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('delegations router DELETE /:id', () => {
  it('returns 200 when delegation is revoked successfully', async () => {
    (DelegationService.prototype.revokeDelegation as jest.Mock) = jest.fn().mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/delegations/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Delegation revoked');
  });

  it('returns 404 when delegation is not found', async () => {
    (DelegationService.prototype.revokeDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new NotFoundError('Delegation not found')
    );

    const res = await request(mountApp()).delete('/api/delegations/999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when the requester is not the delegator', async () => {
    currentUser = { id: 9, role: 'employee', email: 'emp@example.com' };
    (DelegationService.prototype.revokeDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new ForbiddenError('Only the delegator can revoke this delegation')
    );

    const res = await request(mountApp()).delete('/api/delegations/5');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid (non-positive) id', async () => {
    const res = await request(mountApp()).delete('/api/delegations/0');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(mountApp()).delete('/api/delegations/abc');
    expect(res.status).toBe(400);
  });

  it('returns 500 on unknown service error', async () => {
    (DelegationService.prototype.revokeDelegation as jest.Mock) = jest.fn().mockRejectedValue(
      new Error('db crash')
    );

    const res = await request(mountApp()).delete('/api/delegations/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes the correct delegation id and user id to revokeDelegation', async () => {
    currentUser = { id: 3, role: 'manager', email: 'mgr@example.com' };
    const revokeFn = jest.fn().mockResolvedValue(undefined);
    (DelegationService.prototype.revokeDelegation as jest.Mock) = revokeFn;

    await request(mountApp()).delete('/api/delegations/7');

    expect(revokeFn).toHaveBeenCalledWith(7, 3, null);
  });
});
