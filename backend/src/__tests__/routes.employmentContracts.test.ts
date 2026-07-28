/**
 * Employment contract routes.
 *
 * These exist as much for the PERMISSION boundary as for the handlers. Reading
 * is gated on `employee.read` and writing on `preferences.manage` — the same
 * permission that guards setting someone's limits directly, because moving a
 * person onto a different contract IS setting their limits. Splitting the two
 * would let the weaker permission accomplish what the stronger one guards, and
 * an employee raising their own limits is precisely the defect (#472) this
 * entity was introduced to make structurally impossible.
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
  update: jest.fn(),
  assignmentsForUser: jest.fn(),
  assign: jest.fn(),
};

jest.mock('../services/EmploymentContractService', () => ({
  EmploymentContractService: jest.fn().mockImplementation(() => service),
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
  const { createEmploymentContractsRouter } = require('../routes/employmentContracts');
  const app = express();
  app.use(express.json());
  app.use('/api/employment-contracts', createEmploymentContractsRouter({} as never));
  return app;
};

describe('employment contract routes', () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset());
    requiredPermissions.length = 0;
  });

  it('gates writes on preferences.manage and reads on employee.read', () => {
    mountApp();
    // Writing is deliberately NOT a weaker permission than setting limits
    // directly: assigning a different contract has the same effect.
    expect(requiredPermissions).toContain('preferences.manage');
    expect(requiredPermissions).toContain('employee.read');
  });

  it('lists contracts', async () => {
    service.list.mockResolvedValue([{ id: 1, name: 'Full time' }]);
    const res = await request(mountApp()).get('/api/employment-contracts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('reads one contract', async () => {
    service.getById.mockResolvedValue({ id: 2, name: 'Part time' });
    const res = await request(mountApp()).get('/api/employment-contracts/2');
    expect(res.status).toBe(200);
    expect(service.getById).toHaveBeenCalledWith(2);
  });

  it('creates a contract and answers 201', async () => {
    service.create.mockResolvedValue({ id: 3, name: 'Casual' });
    const res = await request(mountApp())
      .post('/api/employment-contracts')
      .send({ name: 'Casual', maxHoursPerWeek: 16 });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith({ name: 'Casual', maxHoursPerWeek: 16 });
  });

  it('rejects a contract with no name', async () => {
    const res = await request(mountApp()).post('/api/employment-contracts').send({ maxHoursPerWeek: 16 });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('updates a contract', async () => {
    service.update.mockResolvedValue({ id: 2, name: 'Part time' });
    const res = await request(mountApp())
      .put('/api/employment-contracts/2')
      .send({ maxHoursPerWeek: 20 });
    expect(res.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(2, { maxHoursPerWeek: 20 });
  });

  it("reads a user's contract history", async () => {
    service.assignmentsForUser.mockResolvedValue([{ id: 1, contractId: 2 }]);
    const res = await request(mountApp()).get('/api/employment-contracts/users/9');
    expect(res.status).toBe(200);
    expect(service.assignmentsForUser).toHaveBeenCalledWith(9);
  });

  it('assigns a contract for a period', async () => {
    service.assign.mockResolvedValue({ id: 4 });
    const res = await request(mountApp())
      .post('/api/employment-contracts/users/9')
      .send({ contractId: 2, effectiveFrom: '2033-04-01', effectiveTo: '2033-06-30' });
    expect(res.status).toBe(201);
    expect(service.assign).toHaveBeenCalledWith({
      userId: 9,
      contractId: 2,
      effectiveFrom: '2033-04-01',
      effectiveTo: '2033-06-30',
    });
  });

  it('rejects an assignment with a malformed date', async () => {
    const res = await request(mountApp())
      .post('/api/employment-contracts/users/9')
      .send({ contractId: 2, effectiveFrom: 'next monday' });
    expect(res.status).toBe(400);
    expect(service.assign).not.toHaveBeenCalled();
  });

  it('routes /users/:userId ahead of /:id', async () => {
    // Registration order is load-bearing: with `/:id` first, this request
    // matches it with id="users" and fails idParam validation with a 400
    // naming a parameter the caller never supplied.
    service.assignmentsForUser.mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/employment-contracts/users/9');
    expect(res.status).toBe(200);
    expect(service.getById).not.toHaveBeenCalled();
  });
});
