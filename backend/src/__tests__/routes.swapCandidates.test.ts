/**
 * `GET /assignments/{id}/swap-candidates` — the scope decision.
 *
 * This is the one endpoint where an ordinary employee learns about a
 * colleague's assignment, so what it is bounded by is the whole design.
 * `allowedOrgUnitIds` is NULL for anyone whose roles carry no scope, and NULL
 * means UNRESTRICTED — so reaching for it alone would answer the question
 * across the entire organization for every employee.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const forAssignment = jest.fn();
jest.mock('../services/SwapCandidateService', () => ({
  SwapCandidateService: jest.fn().mockImplementation(() => ({ forAssignment })),
}));

const getUserOrgUnitSubtreeIds = jest.fn();
jest.mock('../services/RbacService', () => ({
  RbacService: jest.fn().mockImplementation(() => ({ getUserOrgUnitSubtreeIds })),
}));

jest.mock('../services/AssignmentService', () => ({
  AssignmentService: jest.fn().mockImplementation(() => ({})),
}));

let currentUser: Record<string, unknown> = {};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = currentUser;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  userHasPermission: (user: { permissions?: string[] }, code: string) =>
    (user.permissions ?? []).includes(code),
}));

const mountApp = () => {
  const { createAssignmentsRouter } = require('../routes/assignments');
  const app = express();
  app.use(express.json());
  app.use('/api/assignments', createAssignmentsRouter({} as never));
  return app;
};

beforeEach(() => {
  forAssignment.mockReset().mockResolvedValue({ candidates: [], truncated: false });
  getUserOrgUnitSubtreeIds.mockReset().mockResolvedValue([3, 4]);
  currentUser = { id: 7, permissions: [], allowedOrgUnitIds: null };
});

describe('GET /assignments/:id/swap-candidates', () => {
  it('bounds an ordinary employee by the units they belong to', async () => {
    const res = await request(mountApp()).get('/api/assignments/1/swap-candidates');
    expect(res.status).toBe(200);
    // `allowedOrgUnitIds` is null here — unrestricted authority — and using it
    // would answer for the whole organization.
    expect(forAssignment).toHaveBeenCalledWith(1, 7, [3, 4]);
  });

  it('lets a scoped role narrow membership, never widen it', async () => {
    currentUser = { id: 7, permissions: [], allowedOrgUnitIds: [4, 9] };
    await request(mountApp()).get('/api/assignments/1/swap-candidates');
    // Membership says 3 and 4; the role scope says 4 and 9. A scoped role must
    // not become a way to see somewhere the person does not belong.
    expect(forAssignment).toHaveBeenCalledWith(1, 7, [4]);
  });

  it('skips the membership lookup for a planner', async () => {
    currentUser = { id: 7, permissions: ['assignment.manage'], allowedOrgUnitIds: null };
    await request(mountApp()).get('/api/assignments/1/swap-candidates');
    expect(forAssignment).toHaveBeenCalledWith(1, 7, null);
    expect(getUserOrgUnitSubtreeIds).not.toHaveBeenCalled();
  });

  it('still respects a scoped role for a planner', async () => {
    currentUser = { id: 7, permissions: ['assignment.manage'], allowedOrgUnitIds: [4] };
    await request(mountApp()).get('/api/assignments/1/swap-candidates');
    expect(forAssignment).toHaveBeenCalledWith(1, 7, [4]);
  });

  it('gives an empty scope to someone who belongs nowhere', async () => {
    getUserOrgUnitSubtreeIds.mockResolvedValue([]);
    await request(mountApp()).get('/api/assignments/1/swap-candidates');
    // Empty means nobody visible. The other reading — no restriction — is how
    // a missing membership becomes a disclosure.
    expect(forAssignment).toHaveBeenCalledWith(1, 7, []);
  });

  it('returns the candidates and whether the list is partial', async () => {
    forAssignment.mockResolvedValue({ candidates: [{ assignmentId: 2 }], truncated: true });
    const res = await request(mountApp()).get('/api/assignments/1/swap-candidates');
    expect(res.body.data).toEqual({ candidates: [{ assignmentId: 2 }], truncated: true });
  });

  it('rejects a non-numeric id rather than passing it on', async () => {
    const res = await request(mountApp()).get('/api/assignments/abc/swap-candidates');
    expect(res.status).toBe(400);
    expect(forAssignment).not.toHaveBeenCalled();
  });
});
