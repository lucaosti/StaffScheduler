/**
 * Route handler tests for `routes/changeRequests.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * ChangeRequestService is fully mocked.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

const authState = {
  mode: 'pass' as 'pass' | 'reject401' | 'reject403',
  userId: 1,
  overrideHasPermission: null as boolean | null,
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (authState.mode === 'reject401') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    req.user = {
      id: authState.userId,
      isActive: true,
      permissions: ['change_request.create', 'change_request.review'],
    };
    next();
  },
  requirePermission: () => (_req: any, res: any, next: any) => {
    if (authState.mode === 'reject403') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Missing permission' } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) => {
    if (authState.overrideHasPermission !== null) return authState.overrideHasPermission;
    return Boolean(user?.permissions?.includes(code));
  },
}));

jest.mock('../services/ChangeRequestService');

import { ChangeRequestService } from '../services/ChangeRequestService';
import { createChangeRequestsRouter } from '../routes/changeRequests';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/change-requests', createChangeRequestsRouter(fakePool));
  return app;
};

const fakeCr = {
  id: 1,
  changeType: 'schedule.update',
  proposerUserId: 1,
  targetEntityType: 'schedule',
  targetEntityId: 42,
  proposedPayload: { action: 'publish' },
  justification: 'Urgent',
  status: 'pending',
  approverUserId: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  appliedAt: null,
  onBehalfOfUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  authState.mode = 'pass';
  authState.userId = 1;
  authState.overrideHasPermission = null;
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /api/change-requests', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/change-requests');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when missing change_request.review', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).get('/api/change-requests');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with paginated list', async () => {
    (ChangeRequestService.prototype.list as jest.Mock).mockResolvedValue({
      total: 2,
      items: [fakeCr, { ...fakeCr, id: 2 }],
    });
    const res = await request(mountApp()).get('/api/change-requests');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it('passes query filters to service', async () => {
    (ChangeRequestService.prototype.list as jest.Mock).mockResolvedValue({ total: 0, items: [] });
    await request(mountApp()).get('/api/change-requests?status=pending&changeType=schedule.update');
    expect(ChangeRequestService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', changeType: 'schedule.update' })
    );
  });

  it('returns 500 on service error', async () => {
    (ChangeRequestService.prototype.list as jest.Mock).mockRejectedValue(new Error('DB error'));
    const res = await request(mountApp()).get('/api/change-requests');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /api/change-requests', () => {
  const validBody = {
    changeType: 'schedule.update',
    targetEntityType: 'schedule',
    targetEntityId: 42,
    proposedPayload: { action: 'publish' },
    justification: 'Urgent',
  };

  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).post('/api/change-requests').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 when missing change_request.create', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).post('/api/change-requests').send(validBody);
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid body', async () => {
    const res = await request(mountApp()).post('/api/change-requests').send({ changeType: '' });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    (ChangeRequestService.prototype.create as jest.Mock).mockResolvedValue(fakeCr);
    const res = await request(mountApp()).post('/api/change-requests').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(1);
    expect(res.body.message).toBe('Change request submitted');
  });

  it('uses authenticated user id as proposer', async () => {
    authState.userId = 7;
    (ChangeRequestService.prototype.create as jest.Mock).mockResolvedValue({ ...fakeCr, proposerUserId: 7 });
    await request(mountApp()).post('/api/change-requests').send(validBody);
    expect(ChangeRequestService.prototype.create).toHaveBeenCalledWith(
      expect.any(Object),
      7
    );
  });

  it('returns 500 on service error', async () => {
    (ChangeRequestService.prototype.create as jest.Mock).mockRejectedValue(new Error('DB fail'));
    const res = await request(mountApp()).post('/api/change-requests').send(validBody);
    expect(res.status).toBe(500);
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/change-requests/:id', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/change-requests/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/change-requests/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 for non-owner without review permission', async () => {
    authState.userId = 99; // different user
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue({ ...fakeCr, proposerUserId: 1 });
    // Override userHasPermission to return false for this test
    authState.overrideHasPermission = false;
    const res = await request(mountApp()).get('/api/change-requests/1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 for the proposer', async () => {
    authState.userId = 1;
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue(fakeCr);
    const res = await request(mountApp()).get('/api/change-requests/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 400 on invalid id', async () => {
    const res = await request(mountApp()).get('/api/change-requests/abc');
    expect(res.status).toBe(400);
  });
});

// ── POST /:id/approve ─────────────────────────────────────────────────────────

describe('POST /api/change-requests/:id/approve', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).post('/api/change-requests/1/approve').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when missing permission', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).post('/api/change-requests/1/approve').send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 when service throws not found', async () => {
    (ChangeRequestService.prototype.approve as jest.Mock).mockRejectedValue(new Error('Change request not found'));
    const res = await request(mountApp()).post('/api/change-requests/1/approve').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 on invalid status transition', async () => {
    (ChangeRequestService.prototype.approve as jest.Mock).mockRejectedValue(new Error('Cannot approve a request in state rejected'));
    const res = await request(mountApp()).post('/api/change-requests/1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 200 on success', async () => {
    (ChangeRequestService.prototype.approve as jest.Mock).mockResolvedValue({ ...fakeCr, status: 'approved' });
    const res = await request(mountApp()).post('/api/change-requests/1/approve').send({ justification: 'OK' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.message).toBe('Change request approved');
  });
});

// ── POST /:id/reject ──────────────────────────────────────────────────────────

describe('POST /api/change-requests/:id/reject', () => {
  it('returns 400 when rejectionReason is missing', async () => {
    const res = await request(mountApp()).post('/api/change-requests/1/reject').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    (ChangeRequestService.prototype.reject as jest.Mock).mockRejectedValue(new Error('Change request not found'));
    const res = await request(mountApp()).post('/api/change-requests/1/reject').send({ rejectionReason: 'No budget' });
    expect(res.status).toBe(404);
  });

  it('returns 409 on invalid status', async () => {
    (ChangeRequestService.prototype.reject as jest.Mock).mockRejectedValue(new Error('Cannot reject a request in state applied'));
    const res = await request(mountApp()).post('/api/change-requests/1/reject').send({ rejectionReason: 'Denied' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 200 on success', async () => {
    (ChangeRequestService.prototype.reject as jest.Mock).mockResolvedValue({ ...fakeCr, status: 'rejected' });
    const res = await request(mountApp())
      .post('/api/change-requests/1/reject')
      .send({ rejectionReason: 'No budget' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });
});

// ── POST /:id/apply ───────────────────────────────────────────────────────────

describe('POST /api/change-requests/:id/apply', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).post('/api/change-requests/1/apply').send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    (ChangeRequestService.prototype.apply as jest.Mock).mockRejectedValue(new Error('Change request not found'));
    const res = await request(mountApp()).post('/api/change-requests/1/apply').send({});
    expect(res.status).toBe(404);
  });

  it('returns 409 when not in approved state', async () => {
    (ChangeRequestService.prototype.apply as jest.Mock).mockRejectedValue(new Error('Cannot apply a request in state pending'));
    const res = await request(mountApp()).post('/api/change-requests/1/apply').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 200 on success', async () => {
    (ChangeRequestService.prototype.apply as jest.Mock).mockResolvedValue({ ...fakeCr, status: 'applied' });
    const res = await request(mountApp()).post('/api/change-requests/1/apply').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('applied');
    expect(res.body.message).toBe('Change request applied');
  });
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────

describe('POST /api/change-requests/:id/cancel', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found (getById returns null)', async () => {
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue(null);
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when non-owner without review permission tries to cancel', async () => {
    authState.userId = 99;
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue({ ...fakeCr, proposerUserId: 1 });
    authState.overrideHasPermission = false;
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 for the proposer cancelling their own request', async () => {
    authState.userId = 1;
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue(fakeCr);
    (ChangeRequestService.prototype.cancel as jest.Mock).mockResolvedValue({ ...fakeCr, status: 'cancelled' });
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('returns 409 when already cancelled', async () => {
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue({ ...fakeCr, proposerUserId: 1 });
    (ChangeRequestService.prototype.cancel as jest.Mock).mockRejectedValue(new Error('Cannot cancel a request in state cancelled'));
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 500 on unexpected error', async () => {
    (ChangeRequestService.prototype.getById as jest.Mock).mockResolvedValue(fakeCr);
    (ChangeRequestService.prototype.cancel as jest.Mock).mockRejectedValue(new Error('DB crash'));
    const res = await request(mountApp()).post('/api/change-requests/1/cancel');
    expect(res.status).toBe(500);
  });
});
