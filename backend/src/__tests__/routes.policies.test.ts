/**
 * Comprehensive tests for `routes/policies.ts`.
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

jest.mock('../services/PolicyService');
jest.mock('../services/PolicyExceptionService');
jest.mock('../services/ApprovalMatrixService');
jest.mock('../services/PolicyValidator');

import { PolicyService } from '../services/PolicyService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';
import { ApprovalMatrixService } from '../services/ApprovalMatrixService';
import { PolicyValidator } from '../services/PolicyValidator';
import { createPoliciesRouter } from '../routes/policies';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/policies', createPoliciesRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example' };
});

describe('validation endpoint', () => {
  it('200 with the result', async () => {
    (PolicyValidator.prototype.validateAssignment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ ok: true });
    const res = await request(mountApp())
      .post('/api/policies/validate/assignment')
      .send({ userId: 1, shiftId: 2 });
    expect(res.status).toBe(200);
  });

  it('404 when entity missing', async () => {
    (PolicyValidator.prototype.validateAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Shift not found'));
    const res = await request(mountApp())
      .post('/api/policies/validate/assignment')
      .send({ userId: 1, shiftId: 2 });
    expect(res.status).toBe(404);
  });

  it('400 on validation error', async () => {
    (PolicyValidator.prototype.validateAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    const res = await request(mountApp())
      .post('/api/policies/validate/assignment')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('approval matrix', () => {
  it('GET 200', async () => {
    (ApprovalMatrixService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/policies/approval-matrix');
    expect(res.status).toBe(200);
  });

  it('GET 500 on error', async () => {
    (ApprovalMatrixService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/policies/approval-matrix');
    expect(res.status).toBe(500);
  });

  it('PUT 200 on update', async () => {
    (ApprovalMatrixService.prototype.update as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ changeType: 'a' });
    const res = await request(mountApp())
      .put('/api/policies/approval-matrix/policy_change')
      .send({ approverRole: 'admin' });
    expect(res.status).toBe(200);
  });

  it('PUT 404 on not found', async () => {
    (ApprovalMatrixService.prototype.update as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Approval matrix entry not found'));
    const res = await request(mountApp())
      .put('/api/policies/approval-matrix/policy_change')
      .send({});
    expect(res.status).toBe(404);
  });

  it('PUT 400 on validation', async () => {
    (ApprovalMatrixService.prototype.update as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    const res = await request(mountApp())
      .put('/api/policies/approval-matrix/policy_change')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('exceptions', () => {
  it('GET 200 for admin (full filters)', async () => {
    (PolicyExceptionService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get(
      '/api/policies/exceptions?policyId=1&targetType=user&targetId=2&status=pending&requestedByUserId=3'
    );
    expect(res.status).toBe(200);
  });

  it('GET 200 for employee (forces requester id)', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (PolicyExceptionService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/policies/exceptions');
    expect(res.status).toBe(200);
  });

  it('GET 500 on error', async () => {
    (PolicyExceptionService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/policies/exceptions');
    expect(res.status).toBe(500);
  });

  it('POST 201 on create', async () => {
    (PolicyExceptionService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp())
      .post('/api/policies/exceptions')
      .send({ policyId: 1, targetType: 'user', targetId: 2, reason: 'r' });
    expect(res.status).toBe(201);
  });

  it('POST 400 on error', async () => {
    (PolicyExceptionService.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).post('/api/policies/exceptions').send({});
    expect(res.status).toBe(400);
  });

  for (const action of ['approve', 'reject'] as const) {
    describe(`POST /exceptions/:id/${action}`, () => {
      it('200', async () => {
        (PolicyExceptionService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockResolvedValue({ id: 1 });
        const res = await request(mountApp())
          .post(`/api/policies/exceptions/1/${action}`)
          .send({ notes: 'ok' });
        expect(res.status).toBe(200);
      });

      it('404 not found', async () => {
        (PolicyExceptionService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Exception not found'));
        const res = await request(mountApp()).post(`/api/policies/exceptions/1/${action}`).send({});
        expect(res.status).toBe(404);
      });

      it('403 forbidden', async () => {
        (PolicyExceptionService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Forbidden'));
        const res = await request(mountApp()).post(`/api/policies/exceptions/1/${action}`).send({});
        expect(res.status).toBe(403);
      });

      it('409 conflict', async () => {
        (PolicyExceptionService.prototype[action] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('already done'));
        const res = await request(mountApp()).post(`/api/policies/exceptions/1/${action}`).send({});
        expect(res.status).toBe(409);
      });
    });
  }

  describe('POST /exceptions/:id/cancel', () => {
    it('handles 200/404/403/409', async () => {
      const cancel = (mock: jest.Mock) => {
        (PolicyExceptionService.prototype.cancel as jest.Mock) = mock;
      };
      cancel(jest.fn().mockResolvedValue({ id: 1 }));
      let res = await request(mountApp()).post('/api/policies/exceptions/1/cancel');
      expect(res.status).toBe(200);

      cancel(jest.fn().mockRejectedValue(new Error('not found')));
      res = await request(mountApp()).post('/api/policies/exceptions/1/cancel');
      expect(res.status).toBe(404);

      cancel(jest.fn().mockRejectedValue(new Error('Forbidden')));
      res = await request(mountApp()).post('/api/policies/exceptions/1/cancel');
      expect(res.status).toBe(403);

      cancel(jest.fn().mockRejectedValue(new Error('already')));
      res = await request(mountApp()).post('/api/policies/exceptions/1/cancel');
      expect(res.status).toBe(409);
    });
  });
});

describe('policies CRUD', () => {
  it('GET / 200', async () => {
    (PolicyService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp()).get('/api/policies');
    expect(res.status).toBe(200);
  });

  it('GET / 500 on error', async () => {
    (PolicyService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/policies');
    expect(res.status).toBe(500);
  });

  it('GET /:id 404 missing', async () => {
    (PolicyService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/policies/9');
    expect(res.status).toBe(404);
  });

  it('GET /:id 200 found', async () => {
    (PolicyService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    const res = await request(mountApp()).get('/api/policies/9');
    expect(res.status).toBe(200);
  });

  it('GET /:id 500 on error', async () => {
    (PolicyService.prototype.getById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/policies/9');
    expect(res.status).toBe(500);
  });

  it('POST 201', async () => {
    (PolicyService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp())
      .post('/api/policies')
      .send({ scopeType: 'global', policyKey: 'k', policyValue: '1' });
    expect(res.status).toBe(201);
  });

  it('POST 400 on error', async () => {
    (PolicyService.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(mountApp()).post('/api/policies').send({});
    expect(res.status).toBe(400);
  });

  describe('PUT /:id', () => {
    it('404 when missing', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
      const res = await request(mountApp()).put('/api/policies/9').send({});
      expect(res.status).toBe(404);
    });

    it('403 when not owner and not admin', async () => {
      currentUser = { id: 8, role: 'manager', email: 'm@x' };
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 999 });
      const res = await request(mountApp()).put('/api/policies/9').send({});
      expect(res.status).toBe(403);
    });

    it('200 when admin updates anyone', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 999 });
      (PolicyService.prototype.update as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
      const res = await request(mountApp()).put('/api/policies/9').send({ policyValue: 'v' });
      expect(res.status).toBe(200);
    });

    it('400 on validation error', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 1 });
      (PolicyService.prototype.update as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
      const res = await request(mountApp()).put('/api/policies/9').send({});
      expect(res.status).toBe(400);
    });

    it('404 on service "not found"', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 1 });
      (PolicyService.prototype.update as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('Policy not found'));
      const res = await request(mountApp()).put('/api/policies/9').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('404 when missing', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
      const res = await request(mountApp()).delete('/api/policies/9');
      expect(res.status).toBe(404);
    });

    it('403 when not owner and not admin', async () => {
      currentUser = { id: 8, role: 'manager', email: 'm@x' };
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 999 });
      const res = await request(mountApp()).delete('/api/policies/9');
      expect(res.status).toBe(403);
    });

    it('200 on success (admin or owner)', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 1 });
      (PolicyService.prototype.remove as jest.Mock) = jest.fn().mockResolvedValue(undefined);
      const res = await request(mountApp()).delete('/api/policies/9');
      expect(res.status).toBe(200);
    });

    it('400 on service error', async () => {
      (PolicyService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ id: 9, imposedByUserId: 1 });
      (PolicyService.prototype.remove as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
      const res = await request(mountApp()).delete('/api/policies/9');
      expect(res.status).toBe(400);
    });
  });
});
