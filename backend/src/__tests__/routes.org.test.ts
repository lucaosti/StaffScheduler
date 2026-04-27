/**
 * Comprehensive tests for `routes/org.ts`.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'admin',
  email: 'admin@example',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { ...currentUser, isActive: true };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireManager: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/OrgUnitService');
jest.mock('../services/EmployeeLoanService');

import { OrgUnitService } from '../services/OrgUnitService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { createOrgRouter } from '../routes/org';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/org', createOrgRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example' };
});

describe('org router units', () => {
  it('GET /units returns the list', async () => {
    (OrgUnitService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/org/units');
    expect(res.status).toBe(200);
  });

  it('GET /units 500 on error', async () => {
    (OrgUnitService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/org/units');
    expect(res.status).toBe(500);
  });

  it('GET /units/tree returns the tree', async () => {
    (OrgUnitService.prototype.tree as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/org/units/tree');
    expect(res.status).toBe(200);
  });

  it('GET /units/tree 500 on error', async () => {
    (OrgUnitService.prototype.tree as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/org/units/tree');
    expect(res.status).toBe(500);
  });

  it('GET /units/:id 404 when missing', async () => {
    (OrgUnitService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/org/units/9');
    expect(res.status).toBe(404);
  });

  it('GET /units/:id 200 when found', async () => {
    (OrgUnitService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    const res = await request(mountApp()).get('/api/org/units/9');
    expect(res.status).toBe(200);
  });

  it('GET /units/:id 500 on error', async () => {
    (OrgUnitService.prototype.getById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/org/units/9');
    expect(res.status).toBe(500);
  });

  it('POST /units 201 on create', async () => {
    (OrgUnitService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp())
      .post('/api/org/units')
      .send({ name: 'X' });
    expect(res.status).toBe(201);
  });

  it('POST /units 400 on validation error', async () => {
    (OrgUnitService.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).post('/api/org/units').send({});
    expect(res.status).toBe(400);
  });

  it('PUT /units/:id 200 on update', async () => {
    (OrgUnitService.prototype.update as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    const res = await request(mountApp()).put('/api/org/units/9').send({ name: 'New' });
    expect(res.status).toBe(200);
  });

  it('PUT /units/:id 404 on not found', async () => {
    (OrgUnitService.prototype.update as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Org unit not found'));
    const res = await request(mountApp()).put('/api/org/units/9').send({});
    expect(res.status).toBe(404);
  });

  it('PUT /units/:id 400 on validation error', async () => {
    (OrgUnitService.prototype.update as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).put('/api/org/units/9').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /units/:id 200 on success', async () => {
    (OrgUnitService.prototype.remove as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/org/units/9');
    expect(res.status).toBe(200);
  });

  it('DELETE /units/:id 404 on not found', async () => {
    (OrgUnitService.prototype.remove as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Org unit not found'));
    const res = await request(mountApp()).delete('/api/org/units/9');
    expect(res.status).toBe(404);
  });

  it('DELETE /units/:id 400 on validation', async () => {
    (OrgUnitService.prototype.remove as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).delete('/api/org/units/9');
    expect(res.status).toBe(400);
  });
});

describe('org router members', () => {
  it('GET /units/:id/members 200', async () => {
    (OrgUnitService.prototype.listMembers as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/org/units/1/members');
    expect(res.status).toBe(200);
  });

  it('GET /units/:id/members 500 on error', async () => {
    (OrgUnitService.prototype.listMembers as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/org/units/1/members');
    expect(res.status).toBe(500);
  });

  it('POST /units/:id/members 400 when userId missing', async () => {
    const res = await request(mountApp()).post('/api/org/units/1/members').send({});
    expect(res.status).toBe(400);
  });

  it('POST /units/:id/members 201 on success', async () => {
    (OrgUnitService.prototype.addMember as jest.Mock) = jest.fn().mockResolvedValue({});
    const res = await request(mountApp())
      .post('/api/org/units/1/members')
      .send({ userId: 5, isPrimary: true });
    expect(res.status).toBe(201);
  });

  it('POST /units/:id/members 400 on service error', async () => {
    (OrgUnitService.prototype.addMember as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp())
      .post('/api/org/units/1/members')
      .send({ userId: 5 });
    expect(res.status).toBe(400);
  });

  it('PATCH /units/:id/members/:userId/primary 200 on success', async () => {
    (OrgUnitService.prototype.setPrimary as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).patch('/api/org/units/1/members/5/primary');
    expect(res.status).toBe(200);
  });

  it('PATCH /units/:id/members/:userId/primary 404 on not found', async () => {
    (OrgUnitService.prototype.setPrimary as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Membership not found'));
    const res = await request(mountApp()).patch('/api/org/units/1/members/5/primary');
    expect(res.status).toBe(404);
  });

  it('PATCH /units/:id/members/:userId/primary 400 on validation', async () => {
    (OrgUnitService.prototype.setPrimary as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).patch('/api/org/units/1/members/5/primary');
    expect(res.status).toBe(400);
  });

  it('DELETE /units/:id/members/:userId 200 on success', async () => {
    (OrgUnitService.prototype.removeMember as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/org/units/1/members/5');
    expect(res.status).toBe(200);
  });

  it('DELETE /units/:id/members/:userId 400 on error', async () => {
    (OrgUnitService.prototype.removeMember as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).delete('/api/org/units/1/members/5');
    expect(res.status).toBe(400);
  });
});

describe('org router loans', () => {
  it('GET /loans 200 for admin (full filters)', async () => {
    (EmployeeLoanService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get(
      '/api/org/loans?userId=2&toOrgUnitId=3&fromOrgUnitId=4&status=pending'
    );
    expect(res.status).toBe(200);
  });

  it('GET /loans 200 for employee (forces userId filter)', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (EmployeeLoanService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/org/loans');
    expect(res.status).toBe(200);
  });

  it('GET /loans 500 on error', async () => {
    (EmployeeLoanService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/org/loans');
    expect(res.status).toBe(500);
  });

  it('POST /loans 201 on create', async () => {
    (EmployeeLoanService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp())
      .post('/api/org/loans')
      .send({
        userId: 5,
        fromOrgUnitId: 1,
        toOrgUnitId: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-15',
        reason: 'cover',
      });
    expect(res.status).toBe(201);
  });

  it('POST /loans 400 on error', async () => {
    (EmployeeLoanService.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).post('/api/org/loans').send({});
    expect(res.status).toBe(400);
  });

  for (const action of ['approve', 'reject'] as const) {
    describe(`POST /loans/:id/${action}`, () => {
      it('200 on success', async () => {
        (EmployeeLoanService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockResolvedValue({ id: 1 });
        const res = await request(mountApp())
          .post(`/api/org/loans/1/${action}`)
          .send({ notes: 'ok' });
        expect(res.status).toBe(200);
      });

      it('404 on not found', async () => {
        (EmployeeLoanService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Loan not found'));
        const res = await request(mountApp()).post(`/api/org/loans/1/${action}`).send({});
        expect(res.status).toBe(404);
      });

      it('403 on Forbidden', async () => {
        (EmployeeLoanService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Forbidden'));
        const res = await request(mountApp()).post(`/api/org/loans/1/${action}`).send({});
        expect(res.status).toBe(403);
      });

      it('409 on conflict', async () => {
        (EmployeeLoanService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('already processed'));
        const res = await request(mountApp()).post(`/api/org/loans/1/${action}`).send({});
        expect(res.status).toBe(409);
      });
    });
  }

  describe('POST /loans/:id/cancel', () => {
    it('200 on success', async () => {
      (EmployeeLoanService.prototype.cancel as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 1 });
      const res = await request(mountApp()).post('/api/org/loans/1/cancel');
      expect(res.status).toBe(200);
    });

    it('404/403/409 paths', async () => {
      const cancel = (msg: string) => {
        (EmployeeLoanService.prototype.cancel as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error(msg));
      };

      cancel('not found');
      let res = await request(mountApp()).post('/api/org/loans/1/cancel');
      expect(res.status).toBe(404);

      cancel('Forbidden');
      res = await request(mountApp()).post('/api/org/loans/1/cancel');
      expect(res.status).toBe(403);

      cancel('already processed');
      res = await request(mountApp()).post('/api/org/loans/1/cancel');
      expect(res.status).toBe(409);
    });
  });
});
