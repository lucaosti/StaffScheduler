/**
 * Pairing rule routes.
 *
 * These exist above all for the PERMISSION boundary. The gate is
 * `employee.manage` on every operation including reads, and that is the whole
 * decision: `employee.read` — which every other staff-record read uses — is
 * held by the default Employee role, so using it here would publish the list
 * of which colleagues must be kept apart to everyone in the organization.
 * A test asserting the absence of `employee.read` is the only thing that stops
 * a later reader "aligning" this router with its neighbours.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const service = {
  list: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  updateReason: jest.fn(),
  remove: jest.fn(),
};

jest.mock('../services/EmployeePairingService', () => ({
  EmployeePairingService: jest.fn().mockImplementation(() => service),
}));

const requiredPermissions: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7 };
    next();
  },
  requirePermission: (code: string) => {
    requiredPermissions.push(code);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

const mountApp = () => {
  const { createEmployeePairingsRouter } = require('../routes/employeePairings');
  const app = express();
  app.use(express.json());
  app.use('/api/employee-pairings', createEmployeePairingsRouter({} as never));
  return app;
};

const rule = { id: 3, userId: 1, otherUserId: 2, kind: 'apart', reason: null };

describe('pairing rule routes', () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset());
    requiredPermissions.length = 0;
  });

  it('gates every operation on employee.manage, and none on employee.read', () => {
    mountApp();
    expect(requiredPermissions).toHaveLength(5);
    expect(new Set(requiredPermissions)).toEqual(new Set(['employee.manage']));
  });

  it('lists rules', async () => {
    service.list.mockResolvedValue([rule]);
    const res = await request(mountApp()).get('/api/employee-pairings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([rule]);
    // No filter given means no filter applied, not a filter on `undefined`.
    expect(service.list).toHaveBeenCalledWith(undefined);
  });

  it('passes the userId filter through as a number', async () => {
    service.list.mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/employee-pairings?userId=4');
    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(4);
  });

  it('rejects a non-numeric filter rather than passing it to SQL', async () => {
    const res = await request(mountApp()).get('/api/employee-pairings?userId=abc');
    expect(res.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('gets one rule', async () => {
    service.getById.mockResolvedValue(rule);
    const res = await request(mountApp()).get('/api/employee-pairings/3');
    expect(res.status).toBe(200);
    expect(service.getById).toHaveBeenCalledWith(3);
  });

  it('creates a rule', async () => {
    service.create.mockResolvedValue(rule);
    const res = await request(mountApp())
      .post('/api/employee-pairings')
      .send({ userId: 1, otherUserId: 2, kind: 'apart', reason: 'x' });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith({
      userId: 1,
      otherUserId: 2,
      kind: 'apart',
      reason: 'x',
    });
  });

  it('refuses a request that does not say which kind of rule it means', async () => {
    const res = await request(mountApp())
      .post('/api/employee-pairings')
      .send({ userId: 1, otherUserId: 2 });
    // `apart` and `requires` are opposites; defaulting one would silently keep
    // two people together who must be separated.
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('updates only the reason', async () => {
    service.updateReason.mockResolvedValue({ ...rule, reason: 'new' });
    const res = await request(mountApp())
      .put('/api/employee-pairings/3')
      .send({ reason: 'new', kind: 'requires' });
    expect(res.status).toBe(200);
    // `kind` in the body is ignored: an update must not be able to invert what
    // a rule means while keeping its identity.
    expect(service.updateReason).toHaveBeenCalledWith(3, 'new');
  });

  it('deletes a rule', async () => {
    service.remove.mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/employee-pairings/3');
    expect(res.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith(3);
  });
});
