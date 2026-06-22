/**
 * Pending Approvals route tests.
 *
 * Covers:
 *   GET  /api/pending-approvals         — list + status filter
 *   GET  /api/pending-approvals/count   — badge count
 *   POST /api/pending-approvals/:id/approve — happy path + 404 + 400
 *   POST /api/pending-approvals/:id/reject  — happy path + 403 (wrong user)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 20, email: 'approver@example.com' };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: () => true,
}));

jest.mock('../services/PendingApprovalService');
jest.mock('../services/ChangeRequestService');

import { PendingApprovalService } from '../services/PendingApprovalService';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { createPendingApprovalsRouter } from '../routes/pendingApprovals';

const fakePool = {} as never;

const app = express();
app.use(express.json());
app.use('/api/pending-approvals', createPendingApprovalsRouter(fakePool));

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/pending-approvals', () => {
  it('returns list with default status=pending', async () => {
    const item = {
      id: 1,
      changeRequestId: 1,
      workflowId: 1,
      stepId: 10,
      stepOrder: 1,
      assignedToUserId: 20,
      status: 'pending',
      decidedAt: null,
      decisionNote: null,
      escalatedAt: null,
      createdAt: 't',
      updatedAt: 't',
      changeType: 'Schedule.Override',
      targetEntityType: 'schedule',
      targetEntityId: null,
      proposedPayload: {},
      justification: null,
      proposerUserId: 10,
    };
    (PendingApprovalService.prototype.listForUser as jest.Mock).mockResolvedValueOnce([item]);

    const res = await request(app).get('/api/pending-approvals');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(PendingApprovalService.prototype.listForUser).toHaveBeenCalledWith(20, 'pending');
  });

  it('passes custom status query param to service', async () => {
    (PendingApprovalService.prototype.listForUser as jest.Mock).mockResolvedValueOnce([]);

    await request(app).get('/api/pending-approvals?status=approved');
    expect(PendingApprovalService.prototype.listForUser).toHaveBeenCalledWith(20, 'approved');
  });

  it('returns 500 when service throws', async () => {
    (PendingApprovalService.prototype.listForUser as jest.Mock).mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/api/pending-approvals');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── GET /count ───────────────────────────────────────────────────────────────

describe('GET /api/pending-approvals/count', () => {
  it('returns the pending count for the current user', async () => {
    (PendingApprovalService.prototype.countForUser as jest.Mock).mockResolvedValueOnce(3);

    const res = await request(app).get('/api/pending-approvals/count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(PendingApprovalService.prototype.countForUser).toHaveBeenCalledWith(20);
  });

  it('returns 500 when service throws', async () => {
    (PendingApprovalService.prototype.countForUser as jest.Mock).mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/api/pending-approvals/count');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── POST /:id/approve ────────────────────────────────────────────────────────

describe('POST /api/pending-approvals/:id/approve', () => {
  it('returns 200 with result when approval advances successfully', async () => {
    const result = {
      pendingApproval: { id: 1, status: 'approved' },
      changeRequest: { id: 1, status: 'approved' },
    };
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockResolvedValueOnce(result);

    const res = await request(app).post('/api/pending-approvals/1/approve').send({ note: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ChangeRequestService.prototype.advancePendingApproval).toHaveBeenCalledWith(
      1, 20, 'approved', 'Looks good'
    );
  });

  it('returns 404 when pending approval is not found', async () => {
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new Error('Pending approval not found')
    );

    const res = await request(app).post('/api/pending-approvals/99/approve').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when pending approval is already acted upon', async () => {
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new Error('Pending approval is already approved')
    );

    const res = await request(app).post('/api/pending-approvals/1/approve').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 400 when :id is not a positive integer', async () => {
    const res = await request(app).post('/api/pending-approvals/abc/approve').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /:id/reject ─────────────────────────────────────────────────────────

describe('POST /api/pending-approvals/:id/reject', () => {
  it('returns 200 with rejected result', async () => {
    const result = {
      pendingApproval: { id: 1, status: 'rejected' },
      changeRequest: { id: 1, status: 'rejected' },
    };
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockResolvedValueOnce(result);

    const res = await request(app).post('/api/pending-approvals/1/reject').send({ note: 'Not justified' });
    expect(res.status).toBe(200);
    expect(ChangeRequestService.prototype.advancePendingApproval).toHaveBeenCalledWith(
      1, 20, 'rejected', 'Not justified'
    );
  });

  it('returns 400 when user is not authorized to act on this step', async () => {
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new Error('Not authorized to act on this pending approval')
    );

    const res = await request(app).post('/api/pending-approvals/1/reject').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 500 when service throws unexpected error', async () => {
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new Error('disk full')
    );

    const res = await request(app).post('/api/pending-approvals/1/reject').send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
