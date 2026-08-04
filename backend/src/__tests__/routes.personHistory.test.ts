/**
 * `GET /org/history/:userId?` — same visibility rule as `/org/authority/:userId?`.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const getSnapshot = jest.fn();
jest.mock('../services/PersonHistoryService', () => ({
  PersonHistoryService: jest.fn().mockImplementation(() => ({ getSnapshot })),
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

const snapshot = { userId: 9, asOf: '2026-06-01 23:59:59', rolesHeld: [], orgUnitsBelongedTo: [], orgUnitsHeaded: [] };

beforeEach(() => {
  jest.clearAllMocks();
  hasPermission = true;
  getSnapshot.mockResolvedValue(snapshot);
});

describe('reading person history', () => {
  it('defaults to the caller and appends 23:59:59 to the calendar date', async () => {
    const res = await request(mount()).get('/api/org/history').query({ asOf: '2026-06-01' });

    expect(res.status).toBe(200);
    expect(getSnapshot).toHaveBeenCalledWith(9, '2026-06-01 23:59:59');
  });

  it('lets anyone read their own, with no permission at all', async () => {
    hasPermission = false;
    const res = await request(mount()).get('/api/org/history/9').query({ asOf: '2026-06-01' });

    expect(res.status).toBe(200);
    expect(getSnapshot).toHaveBeenCalledWith(9, '2026-06-01 23:59:59');
  });

  it('requires org_unit.read for someone else', async () => {
    hasPermission = false;
    const res = await request(mount()).get('/api/org/history/4').query({ asOf: '2026-06-01' });

    expect(res.status).toBe(403);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('allows someone else to a caller who holds it', async () => {
    const res = await request(mount()).get('/api/org/history/4').query({ asOf: '2026-06-01' });

    expect(res.status).toBe(200);
    expect(getSnapshot).toHaveBeenCalledWith(4, '2026-06-01 23:59:59');
  });

  it('rejects a non-numeric id before touching the service', async () => {
    const res = await request(mount()).get('/api/org/history/abc').query({ asOf: '2026-06-01' });

    expect(res.status).toBe(400);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a missing asOf', async () => {
    const res = await request(mount()).get('/api/org/history');

    expect(res.status).toBe(400);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a malformed asOf', async () => {
    const res = await request(mount()).get('/api/org/history').query({ asOf: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});
