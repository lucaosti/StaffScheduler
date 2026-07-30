/**
 * `GET /org/authority/:userId?` — and its one interesting decision, who may read it.
 *
 * Your own profile needs no permission beyond being authenticated: knowing who
 * decides your requests is what you need in order to use the system, and it was
 * withholding exactly that which made the answer discoverable only by filing a
 * request and watching where it went. Someone else's is a different thing —
 * read across a department it maps the org chart's authority — so it carries the
 * same `org_unit.read` gate as the rest of the tree.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const getAuthorityProfile = jest.fn();
jest.mock('../services/AuthorityService', () => ({
  AuthorityService: jest.fn().mockImplementation(() => ({ getAuthorityProfile })),
}));

let hasPermission = true;
jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 9, email: 'a@b.c' };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  userHasPermission: () => hasPermission,
}));

const mount = () => {
  const { createOrgRouter } = require('../routes/org');
  const app = express();
  app.use(express.json());
  app.use('/api/org', createOrgRouter({} as never));
  return app;
};

const profile = { subject: { id: 9 }, managerChain: [], roleAdministrators: [], approvals: [] };

beforeEach(() => {
  jest.clearAllMocks();
  hasPermission = true;
  getAuthorityProfile.mockResolvedValue(profile);
});

describe('reading an authority profile', () => {
  it('defaults to the caller', async () => {
    const res = await request(mount()).get('/api/org/authority');

    expect(res.status).toBe(200);
    expect(getAuthorityProfile).toHaveBeenCalledWith(9);
  });

  it('lets anyone read their own, with no permission at all', async () => {
    hasPermission = false;
    const res = await request(mount()).get('/api/org/authority/9');

    expect(res.status).toBe(200);
    expect(getAuthorityProfile).toHaveBeenCalledWith(9);
  });

  it('requires org_unit.read for someone else', async () => {
    hasPermission = false;
    const res = await request(mount()).get('/api/org/authority/4');

    expect(res.status).toBe(403);
    expect(getAuthorityProfile).not.toHaveBeenCalled();
  });

  it('allows someone else to a caller who holds it', async () => {
    const res = await request(mount()).get('/api/org/authority/4');

    expect(res.status).toBe(200);
    expect(getAuthorityProfile).toHaveBeenCalledWith(4);
  });

  it('404s for a user who does not exist', async () => {
    getAuthorityProfile.mockResolvedValue(null);
    const res = await request(mount()).get('/api/org/authority/404');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-numeric id before touching the service', async () => {
    const res = await request(mount()).get('/api/org/authority/abc');

    expect(res.status).toBe(400);
    expect(getAuthorityProfile).not.toHaveBeenCalled();
  });

  it('rejects a negative id', async () => {
    const res = await request(mount()).get('/api/org/authority/-1');
    expect(res.status).toBe(400);
  });
});
