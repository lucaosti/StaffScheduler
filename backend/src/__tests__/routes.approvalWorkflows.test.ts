/**
 * Route handler tests for `routes/approvalWorkflows.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * ApprovalEngineService is fully mocked. Auth rejection is simulated by
 * controlling `authMode` (pass | reject401 | reject403).
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// Shared mutable auth state — mutated per test via helpers below.
const authState = { mode: 'pass' as 'pass' | 'reject401' | 'reject403' };

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (authState.mode === 'reject401') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    req.user = { id: 1, role: 'admin', isActive: true, permissions: ['approval.manage'] };
    next();
  },
  requirePermission: () => (_req: any, res: any, next: any) => {
    if (authState.mode === 'reject403') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Missing permission' } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/ApprovalEngineService');

import { ApprovalEngineService } from '../services/ApprovalEngineService';
import { createApprovalWorkflowsRouter } from '../routes/approvalWorkflows';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/approval-workflows', createApprovalWorkflowsRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  authState.mode = 'pass';
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('approval workflows GET /', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/approval-workflows');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when permission missing', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).get('/api/approval-workflows');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with workflow list', async () => {
    (ApprovalEngineService.prototype.listWorkflows as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, changeType: 'shift_swap' }, { id: 2, changeType: 'time_off' }]);

    const res = await request(mountApp()).get('/api/approval-workflows');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 200 with empty list', async () => {
    (ApprovalEngineService.prototype.listWorkflows as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/approval-workflows');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 on service error', async () => {
    (ApprovalEngineService.prototype.listWorkflows as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/approval-workflows');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /:type ────────────────────────────────────────────────────────────────

describe('approval workflows GET /:type', () => {
  it('returns 200 when workflow found', async () => {
    (ApprovalEngineService.prototype.getWorkflowByChangeType as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, changeType: 'shift_swap', steps: [] });

    const res = await request(mountApp()).get('/api/approval-workflows/shift_swap');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.changeType).toBe('shift_swap');
  });

  it('returns 404 when workflow not found', async () => {
    (ApprovalEngineService.prototype.getWorkflowByChangeType as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/approval-workflows/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on service error', async () => {
    (ApprovalEngineService.prototype.getWorkflowByChangeType as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/approval-workflows/shift_swap');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST / ───────────────────────────────────────────────────────────────────

describe('approval workflows POST /', () => {
  const validBody = {
    changeType: 'shift_swap',
    requireAll: false,
    description: 'Shift swap approval',
    steps: [{ stepOrder: 1, approverScope: 'company_user' }],
  };

  it('returns 201 on successful creation', async () => {
    (ApprovalEngineService.prototype.createWorkflow as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, ...validBody });

    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
    expect(res.body.message).toBe('Workflow created');
  });

  it('returns 400 when changeType is missing', async () => {
    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send({ steps: [{ stepOrder: 1, approverScope: 'company_user' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when steps array is empty', async () => {
    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send({ changeType: 'shift_swap', steps: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when steps is missing', async () => {
    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send({ changeType: 'shift_swap' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 on duplicate change type', async () => {
    (ApprovalEngineService.prototype.createWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Duplicate entry for change type'));

    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 500 on unknown service error', async () => {
    (ApprovalEngineService.prototype.createWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 when permission missing', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp())
      .post('/api/approval-workflows')
      .send(validBody);
    expect(res.status).toBe(403);
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('approval workflows PUT /:id', () => {
  it('returns 200 on successful update', async () => {
    (ApprovalEngineService.prototype.updateWorkflow as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 3, changeType: 'time_off', steps: [] });

    const res = await request(mountApp())
      .put('/api/approval-workflows/3')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(3);
    expect(res.body.message).toBe('Workflow updated');
  });

  it('returns 404 when workflow not found', async () => {
    (ApprovalEngineService.prototype.updateWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Workflow not found'));

    const res = await request(mountApp())
      .put('/api/approval-workflows/99')
      .send({ description: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid (zero) id param', async () => {
    const res = await request(mountApp())
      .put('/api/approval-workflows/0')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    (ApprovalEngineService.prototype.updateWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .put('/api/approval-workflows/3')
      .send({ description: 'Updated' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('approval workflows DELETE /:id', () => {
  it('returns 200 on successful delete', async () => {
    (ApprovalEngineService.prototype.deleteWorkflow as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/approval-workflows/3');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Workflow deleted');
  });

  it('returns 404 when workflow not found', async () => {
    (ApprovalEngineService.prototype.deleteWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Workflow not found'));

    const res = await request(mountApp()).delete('/api/approval-workflows/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid (zero) id param', async () => {
    const res = await request(mountApp()).delete('/api/approval-workflows/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    (ApprovalEngineService.prototype.deleteWorkflow as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp()).delete('/api/approval-workflows/3');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST /escalate ────────────────────────────────────────────────────────────

describe('approval workflows POST /escalate', () => {
  it('returns 200 with overdue escalations', async () => {
    const overdue = [{ workflowId: 1, stepId: 2, changeType: 'shift_swap' }];
    (ApprovalEngineService.prototype.processEscalations as jest.Mock) = jest
      .fn()
      .mockResolvedValue(overdue);

    const res = await request(mountApp())
      .post('/api/approval-workflows/escalate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.overdue).toHaveLength(1);
  });

  it('returns 200 with a custom now timestamp', async () => {
    (ApprovalEngineService.prototype.processEscalations as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);

    const res = await request(mountApp())
      .post('/api/approval-workflows/escalate')
      .send({ now: '2026-06-07T10:00:00Z' });

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
    expect(ApprovalEngineService.prototype.processEscalations).toHaveBeenCalledWith('2026-06-07T10:00:00Z');
  });

  it('returns 500 on service error', async () => {
    (ApprovalEngineService.prototype.processEscalations as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('escalation failed'));

    const res = await request(mountApp())
      .post('/api/approval-workflows/escalate')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp())
      .post('/api/approval-workflows/escalate')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when permission missing', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp())
      .post('/api/approval-workflows/escalate')
      .send({});
    expect(res.status).toBe(403);
  });
});
