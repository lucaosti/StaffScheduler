/**
 * Timeline routes — above all, who sees whom.
 *
 * The scope is derived from the caller and never accepted from them. The test
 * that matters most is the one asserting a plain employee's scope is their own
 * org units: `allowedOrgUnitIds` is NULL for anyone whose roles carry no scope,
 * and NULL means unrestricted, so reaching for it alone would publish the whole
 * organization's movements to everyone in it.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const build = jest.fn();
jest.mock('../services/TimelineService', () => ({
  TimelineService: jest.fn().mockImplementation(() => ({ build })),
  TIMELINE_SOURCE_KEYS: ['shifts', 'on-call'],
}));

const getUserOrgUnitSubtreeIds = jest.fn();
jest.mock('../services/RbacService', () => ({
  RbacService: jest.fn().mockImplementation(() => ({ getUserOrgUnitSubtreeIds })),
}));

let currentUser: Record<string, unknown> = {};
const requiredPermissions: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = currentUser;
    next();
  },
  requirePermission: (code: string) => {
    requiredPermissions.push(code);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
  userHasPermission: (user: { permissions?: string[] }, code: string) =>
    (user.permissions ?? []).includes(code),
}));

const mountApp = () => {
  const { createTimelineRouter } = require('../routes/timeline');
  const app = express();
  app.use(express.json());
  app.use('/api/timeline', createTimelineRouter({} as never));
  return app;
};

const RANGE = 'from=2033-04-01&to=2033-04-07';

beforeEach(() => {
  build.mockReset().mockResolvedValue({ from: '', to: '', lanes: [], bars: [], sources: [] });
  getUserOrgUnitSubtreeIds.mockReset().mockResolvedValue([3, 4]);
  requiredPermissions.length = 0;
  currentUser = { id: 7, permissions: ['timeline.read'], allowedOrgUnitIds: null };
});

describe('scope resolution', () => {
  it('gates on timeline.read', () => {
    mountApp();
    expect(requiredPermissions).toEqual(['timeline.read', 'timeline.read']);
  });

  it('bounds an ordinary employee to their own org units', async () => {
    const res = await request(mountApp()).get(`/api/timeline?${RANGE}`);
    expect(res.status).toBe(200);
    // `allowedOrgUnitIds` is null here — unrestricted authority — and using it
    // would show this employee the entire organization.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: [3, 4] }));
  });

  it('lifts the membership bound for timeline.read_all', async () => {
    currentUser = { id: 7, permissions: ['timeline.read', 'timeline.read_all'], allowedOrgUnitIds: null };
    await request(mountApp()).get(`/api/timeline?${RANGE}`);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: null }));
    // No membership lookup at all: a planner is not limited to the ward they
    // happen to belong to.
    expect(getUserOrgUnitSubtreeIds).not.toHaveBeenCalled();
  });

  it('still respects a scoped role under timeline.read_all', async () => {
    currentUser = {
      id: 7,
      permissions: ['timeline.read', 'timeline.read_all'],
      allowedOrgUnitIds: [4, 9],
    };
    await request(mountApp()).get(`/api/timeline?${RANGE}`);
    // `read_all` lifts the MEMBERSHIP bound, not the role scope. Lifting both
    // would let a manager scoped to one ward see every other ward's people —
    // and the Manager role holds this permission by default, so the over-grant
    // would be the norm rather than an edge case.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: [4, 9] }));
  });

  it('lets a role scope narrow the membership scope, never widen it', async () => {
    currentUser = { id: 7, permissions: ['timeline.read'], allowedOrgUnitIds: [4, 9] };
    await request(mountApp()).get(`/api/timeline?${RANGE}`);
    // Membership says 3 and 4; the role scope says 4 and 9. The intersection
    // is 4 — a scoped role must not become a way to see somewhere you do not
    // belong.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: [4] }));
  });

  it('gives an empty scope to someone who belongs nowhere', async () => {
    getUserOrgUnitSubtreeIds.mockResolvedValue([]);
    await request(mountApp()).get(`/api/timeline?${RANGE}`);
    // Empty means nothing visible. The alternative reading — no restriction —
    // is how a misconfigured membership becomes a disclosure.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: [] }));
  });

  it('ignores an org unit supplied by the caller', async () => {
    await request(mountApp()).get(`/api/timeline?${RANGE}&orgUnitId=99`);
    // A client-supplied boundary is not a boundary. The schema drops the
    // parameter and the scope is still derived.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ orgUnitIds: [3, 4] }));
  });
});

describe('request handling', () => {
  it('splits the sources list', async () => {
    await request(mountApp()).get(`/api/timeline?${RANGE}&sources=shifts,%20on-call`);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['shifts', 'on-call'] })
    );
  });

  it('leaves sources undefined when not asked for', async () => {
    await request(mountApp()).get(`/api/timeline?${RANGE}`);
    // Undefined means "all of them" to the service; an empty array would mean
    // "none", and the difference is a blank chart.
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ sources: undefined }));
  });

  it('rejects a range that ends before it starts', async () => {
    const res = await request(mountApp()).get('/api/timeline?from=2033-04-07&to=2033-04-01');
    expect(res.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects a missing range rather than defaulting to one', async () => {
    const res = await request(mountApp()).get('/api/timeline');
    expect(res.status).toBe(400);
  });

  it('lists the sources a client may request', async () => {
    const res = await request(mountApp()).get('/api/timeline/sources');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(['shifts', 'on-call']);
  });
});
