/**
 * The two role-timeline endpoints.
 *
 * The interesting risk is route shadowing: `/roles/:id/timeline` sits beside
 * `/roles/users/:userId`, and Express matches in declaration order — so the
 * per-user timeline reaching the per-role handler with `users` parsed as an id
 * is exactly the kind of thing a 200 here rules out and nothing else would.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const getTimeline = jest.fn();
jest.mock('../services/RoleTimelineService', () => ({
  RoleTimelineService: jest.fn().mockImplementation(() => ({ getTimeline })),
}));

jest.mock('../services/RbacService', () => ({
  RbacService: jest.fn().mockImplementation(() => ({
    listRoles: jest.fn().mockResolvedValue([]),
    listPermissions: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 9 };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  invalidateAuthContext: jest.fn(),
}));

const mount = () => {
  const { createRbacRouter } = require('../routes/rbac');
  const app = express();
  app.use(express.json());
  app.use('/api/roles', createRbacRouter({} as never).roles);
  return app;
};

const timeline = { current: [], entries: [], truncated: false };

beforeEach(() => {
  jest.clearAllMocks();
  getTimeline.mockResolvedValue(timeline);
});

describe('per-person timeline', () => {
  it('asks for that person', async () => {
    const res = await request(mount()).get('/api/roles/users/5/timeline');

    expect(res.status).toBe(200);
    expect(getTimeline).toHaveBeenCalledWith({ userId: 5 });
  });

  it('is not shadowed by the per-role route beside it', async () => {
    const res = await request(mount()).get('/api/roles/users/5/timeline');
    // Were the ordering wrong, this would arrive as { roleId: NaN }.
    expect(getTimeline.mock.calls[0][0]).not.toHaveProperty('roleId');
    expect(res.status).toBe(200);
  });

  it('passes a since filter through', async () => {
    await request(mount()).get('/api/roles/users/5/timeline?since=2026-01-01');
    expect(getTimeline).toHaveBeenCalledWith({ userId: 5, since: '2026-01-01' });
  });

  it('omits since entirely when it was not given', async () => {
    // `since: undefined` and no `since` are the same to the service, but the
    // absent form is what says "no range" rather than "an empty range".
    await request(mount()).get('/api/roles/users/5/timeline');
    expect(Object.keys(getTimeline.mock.calls[0][0])).toEqual(['userId']);
  });

  it('rejects a malformed date rather than scanning on it', async () => {
    const res = await request(mount()).get('/api/roles/users/5/timeline?since=not-a-date');
    expect(res.status).toBe(400);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric user id', async () => {
    const res = await request(mount()).get('/api/roles/users/abc/timeline');
    expect(res.status).toBe(400);
  });
});

describe('per-role timeline', () => {
  it('asks for that role', async () => {
    const res = await request(mount()).get('/api/roles/3/timeline');

    expect(res.status).toBe(200);
    expect(getTimeline).toHaveBeenCalledWith({ roleId: 3 });
  });

  it('rejects a non-numeric role id', async () => {
    const res = await request(mount()).get('/api/roles/abc/timeline');
    expect(res.status).toBe(400);
  });

  it('returns the envelope with both halves', async () => {
    getTimeline.mockResolvedValue({
      current: [{ userId: 5, roleId: 3, hasHistory: false }],
      entries: [{ auditId: 1, action: 'granted' }],
      truncated: true,
    });
    const res = await request(mount()).get('/api/roles/3/timeline');

    expect(res.body.success).toBe(true);
    // Both halves travel together: neither is derivable from the other.
    expect(res.body.data.current).toHaveLength(1);
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.truncated).toBe(true);
  });
});
