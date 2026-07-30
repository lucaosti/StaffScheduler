/**
 * Who may create a delegation, and who may take one back.
 *
 * The point of `delegation.self` is that it grants nothing new. The route has
 * never accepted a delegator other than the caller, and the service refuses any
 * code the delegator does not hold — so `delegation.manage` was only ever a gate
 * on WHETHER you may delegate, never on WHAT. These cases pin that: the
 * delegator passed to the service is always the authenticated user, whichever
 * code admitted them.
 *
 * The revocation cases are the ones that fix something. A permission gate used
 * to sit on DELETE, so someone who created a delegation and later lost
 * `delegation.manage` could no longer revoke it — a delegation they granted
 * outliving their ability to withdraw it. The service's "only the delegator may
 * revoke" is stricter than any permission could express, and is now the only
 * rule.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const createDelegation = jest.fn();
const revokeDelegation = jest.fn();
jest.mock('../services/DelegationService', () => ({
  DelegationService: jest.fn().mockImplementation(() => ({
    createDelegation,
    revokeDelegation,
    listForUser: jest.fn().mockResolvedValue([]),
  })),
}));

/** The codes the authenticated caller holds; reassigned per case. */
let heldCodes: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7, email: 'a@b.c', permissions: heldCodes };
    next();
  },
  userHasPermission: (user: { permissions?: string[] }, code: string) =>
    (user?.permissions ?? []).includes(code),
}));

const mount = () => {
  const { createDelegationsRouter } = require('../routes/delegations');
  const app = express();
  app.use(express.json());
  app.use('/api/delegations', createDelegationsRouter({} as never));
  return app;
};

const body = {
  delegateeId: 8,
  permissionCodes: ['schedule.manage'],
  expiresAt: '2026-12-31',
};

beforeEach(() => {
  jest.clearAllMocks();
  heldCodes = [];
  createDelegation.mockResolvedValue({ id: 1 });
  revokeDelegation.mockResolvedValue(undefined);
});

describe('creating a delegation', () => {
  it('is allowed by delegation.self alone', async () => {
    heldCodes = ['delegation.self', 'schedule.manage'];
    const res = await request(mount()).post('/api/delegations').send(body);

    expect(res.status).toBe(201);
  });

  it('is still allowed by delegation.manage, unchanged', async () => {
    // The administered form has to keep working exactly as before: a deployment
    // that never grants `self` sees no difference at all.
    heldCodes = ['delegation.manage', 'schedule.manage'];
    const res = await request(mount()).post('/api/delegations').send(body);

    expect(res.status).toBe(201);
  });

  it('is refused with neither code', async () => {
    heldCodes = ['schedule.manage'];
    const res = await request(mount()).post('/api/delegations').send(body);

    expect(res.status).toBe(403);
    expect(createDelegation).not.toHaveBeenCalled();
  });

  it('always names the caller as the delegator, whichever code admitted them', async () => {
    heldCodes = ['delegation.self', 'schedule.manage'];
    await request(mount()).post('/api/delegations').send(body);

    // This is why `self` grants nothing new: there is no way to delegate on
    // somebody else's behalf, and there never was.
    expect(createDelegation).toHaveBeenCalledWith(7, heldCodes, expect.anything(), null);
  });

  it('hands the service the caller\'s own codes, which is what caps the grant', async () => {
    heldCodes = ['delegation.self', 'schedule.manage', 'report.read'];
    await request(mount()).post('/api/delegations').send(body);

    // The service refuses anything outside this list; passing a wider set here
    // would be the escalation the whole design prevents.
    expect(createDelegation.mock.calls[0][1]).toEqual(heldCodes);
  });

  it('keeps the historical 422 for a rule violation', async () => {
    const { ConflictError } = require('../errors');
    heldCodes = ['delegation.self'];
    createDelegation.mockRejectedValue(new ConflictError('Delegation escalation: codes not held by delegator: x'));

    const res = await request(mount()).post('/api/delegations').send(body);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DELEGATION_INVALID');
  });
});

describe('revoking a delegation', () => {
  it('needs no permission at all — the service decides', async () => {
    heldCodes = [];
    const res = await request(mount()).delete('/api/delegations/1').send({});

    expect(res.status).toBe(200);
    // "Only the delegator may revoke" is stricter than any code could express.
    expect(revokeDelegation).toHaveBeenCalledWith(1, 7, null);
  });

  it('lets a delegator who has LOST delegation.manage take their grant back', async () => {
    // The bug this replaces: with a permission gate here, a delegation someone
    // granted outlived their ability to withdraw it.
    heldCodes = ['schedule.manage'];
    const res = await request(mount()).delete('/api/delegations/1').send({ justification: 'no longer needed' });

    expect(res.status).toBe(200);
    expect(revokeDelegation).toHaveBeenCalledWith(1, 7, 'no longer needed');
  });

  it('still refuses someone who is not the delegator', async () => {
    const { ForbiddenError } = require('../errors');
    revokeDelegation.mockRejectedValue(new ForbiddenError('Only the delegator may revoke a delegation'));

    const res = await request(mount()).delete('/api/delegations/1').send({});
    expect(res.status).toBe(403);
  });

  it('rejects a non-numeric id', async () => {
    const res = await request(mount()).delete('/api/delegations/abc').send({});
    expect(res.status).toBe(400);
    expect(revokeDelegation).not.toHaveBeenCalled();
  });
});
