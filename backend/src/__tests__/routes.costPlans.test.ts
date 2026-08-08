/**
 * The cost-plan admin endpoints.
 *
 * The gating case that matters: reading a plan needs `report.read` (the same
 * gate `/dashboard/stats`' `monthlyCost`/`monthlyCostPlan` sit behind), while
 * creating, updating or deleting one needs the stronger `report.manage` —
 * deciding what the organization is measured against is a different act from
 * viewing the measurement.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const list = jest.fn();
const getById = jest.fn();
const create = jest.fn();
const update = jest.fn();
const remove = jest.fn();

jest.mock('../services/CostPlanService', () => {
  const actual = jest.requireActual('../services/CostPlanService');
  return {
    ...actual,
    CostPlanService: jest.fn().mockImplementation(() => ({
      list,
      getById,
      create,
      update,
      remove,
    })),
  };
});

let heldCodes: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7, permissions: heldCodes };
    next();
  },
  requirePermission: (code: string) => (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const user = (req as unknown as { user: { permissions: string[] } }).user;
    if (!user.permissions.includes(code)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      return;
    }
    next();
  },
  userHasPermission: (user: { permissions?: string[] }, code: string) =>
    (user?.permissions ?? []).includes(code),
}));

const mount = () => {
  const { createCostPlansRouter } = require('../routes/costPlans');
  const app = express();
  app.use(express.json());
  app.use('/api/cost-plans', createCostPlansRouter({} as never));
  return app;
};

const samplePlan = {
  id: 1,
  departmentId: 2,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  targetAmount: 10000,
  setByUserId: 7,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  heldCodes = ['report.read', 'report.manage'];
  list.mockResolvedValue([samplePlan]);
  getById.mockResolvedValue(samplePlan);
  create.mockResolvedValue(samplePlan);
  update.mockResolvedValue({ ...samplePlan, targetAmount: 12000 });
  remove.mockResolvedValue(undefined);
});

describe('reading plans', () => {
  it('needs report.read', async () => {
    heldCodes = [];
    const res = await request(mount()).get('/api/cost-plans');
    expect(res.status).toBe(403);
  });

  it('lists plans, optionally scoped by department', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).get('/api/cost-plans?departmentId=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([samplePlan]);
    expect(list).toHaveBeenCalledWith(2);
  });

  it('gets a single plan by id', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).get('/api/cost-plans/1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(samplePlan);
  });

  it('rejects a non-numeric id at the schema', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).get('/api/cost-plans/abc');
    expect(res.status).toBe(400);
    expect(getById).not.toHaveBeenCalled();
  });
});

describe('creating a plan', () => {
  const body = { departmentId: 2, startDate: '2026-08-01', endDate: '2026-08-31', targetAmount: 10000 };

  it('needs report.manage, not just report.read', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).post('/api/cost-plans').send(body);
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a plan, attributing it to the caller', async () => {
    const res = await request(mount()).post('/api/cost-plans').send(body);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      departmentId: 2,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      targetAmount: 10000,
      setByUserId: 7,
    });
  });

  it('rejects endDate before startDate at the schema', async () => {
    const res = await request(mount())
      .post('/api/cost-plans')
      .send({ ...body, startDate: '2026-08-31', endDate: '2026-08-01' });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a negative target amount at the schema', async () => {
    const res = await request(mount()).post('/api/cost-plans').send({ ...body, targetAmount: -1 });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('updating a plan', () => {
  it('needs report.manage', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).put('/api/cost-plans/1').send({ targetAmount: 12000 });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the target amount', async () => {
    const res = await request(mount()).put('/api/cost-plans/1').send({ targetAmount: 12000 });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(1, 12000);
    expect(res.body.data.targetAmount).toBe(12000);
  });
});

describe('deleting a plan', () => {
  it('needs report.manage', async () => {
    heldCodes = ['report.read'];
    const res = await request(mount()).delete('/api/cost-plans/1');
    expect(res.status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a plan', async () => {
    const res = await request(mount()).delete('/api/cost-plans/1');
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(1);
  });
});
