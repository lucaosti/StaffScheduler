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
jest.mock('../services/ApprovalEngineService');
jest.mock('../services/TimeOffService');
jest.mock('../services/EmployeeLoanService');
jest.mock('../services/ShiftSwapService');

import { PendingApprovalService } from '../services/PendingApprovalService';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { ApprovalEngineService } from '../services/ApprovalEngineService';
import { TimeOffService } from '../services/TimeOffService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { createPendingApprovalsRouter } from '../routes/pendingApprovals';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const app = express();
app.use(express.json());
app.use('/api/pending-approvals', createPendingApprovalsRouter(fakePool));
app.use(errorHandler);

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
  it('returns 200 with result when approval advances successfully (change-request-linked)', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 1, changeRequestId: 1, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    });
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
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(app).post('/api/pending-approvals/99/approve').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when pending approval is already acted upon', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 1, changeRequestId: 1, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    });
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new ConflictError('Pending approval is already approved')
    );

    const res = await request(app).post('/api/pending-approvals/1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 when :id is not a positive integer', async () => {
    const res = await request(app).post('/api/pending-approvals/abc/approve').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /:id/reject ─────────────────────────────────────────────────────────

describe('POST /api/pending-approvals/:id/reject', () => {
  it('returns 200 with rejected result (change-request-linked)', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 1, changeRequestId: 1, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    });
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

  it('returns 403 when user is not authorized to act on this step', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 1, changeRequestId: 1, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    });
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new ForbiddenError('Not authorized to act on this pending approval')
    );

    const res = await request(app).post('/api/pending-approvals/1/reject').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 for any other service error, matching the central error contract', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 1, changeRequestId: 1, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    });
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockRejectedValueOnce(
      new Error('disk full')
    );

    const res = await request(app).post('/api/pending-approvals/1/reject').send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('dispatches to TimeOffService when the decision is time-off-linked', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 2, changeRequestId: null, timeOffRequestId: 55, employeeLoanId: null, shiftSwapRequestId: null,
    });
    (TimeOffService.prototype.reject as jest.Mock).mockResolvedValueOnce({ id: 55, status: 'rejected' });

    const res = await request(app).post('/api/pending-approvals/2/reject').send({ note: 'no' });
    expect(res.status).toBe(200);
    expect(TimeOffService.prototype.reject).toHaveBeenCalledWith(55, 20, 'no');
  });

  it('dispatches to ShiftSwapService.decline (not reject) when the decision is swap-linked', async () => {
    (ApprovalEngineService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      id: 3, changeRequestId: null, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: 77,
    });
    (ShiftSwapService.prototype.decline as jest.Mock).mockResolvedValueOnce({ id: 77, status: 'declined' });

    const res = await request(app).post('/api/pending-approvals/3/reject').send({});
    expect(res.status).toBe(200);
    expect(ShiftSwapService.prototype.decline).toHaveBeenCalledWith(77, 20, null);
  });
});

// ─── POST /:id/keep, /:id/delegate, /:id/open-to-structure, GET /:id/chain ────
// Entity-agnostic structure-delegation actions — go straight through
// ApprovalEngineService, not ChangeRequestService, since they apply equally
// to time-off/loan/shift-swap decisions.

describe('POST /api/pending-approvals/:id/keep', () => {
  it('returns 200 when the caller is the structure head', async () => {
    (ApprovalEngineService.prototype.keepForSelf as jest.Mock).mockResolvedValueOnce({ id: 1, assignedToUserId: 20 });

    const res = await request(app).post('/api/pending-approvals/1/keep');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ApprovalEngineService.prototype.keepForSelf).toHaveBeenCalledWith(1, 20);
  });

  it('returns 403 when the caller is not the structure head', async () => {
    (ApprovalEngineService.prototype.keepForSelf as jest.Mock).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

    const res = await request(app).post('/api/pending-approvals/1/keep');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when the pending approval does not exist', async () => {
    (ApprovalEngineService.prototype.keepForSelf as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Pending approval not found')
    );

    const res = await request(app).post('/api/pending-approvals/99/keep');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/pending-approvals/:id/delegate', () => {
  it('returns 200 and forwards targetUserId', async () => {
    (ApprovalEngineService.prototype.delegateToPerson as jest.Mock).mockResolvedValueOnce({ id: 1, assignedToUserId: 12 });

    const res = await request(app).post('/api/pending-approvals/1/delegate').send({ targetUserId: 12 });
    expect(res.status).toBe(200);
    expect(ApprovalEngineService.prototype.delegateToPerson).toHaveBeenCalledWith(1, 20, 12);
  });

  it('returns 400 when targetUserId is missing', async () => {
    const res = await request(app).post('/api/pending-approvals/1/delegate').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when the target is not a member of the structure', async () => {
    (ApprovalEngineService.prototype.delegateToPerson as jest.Mock).mockRejectedValueOnce(
      new ValidationError('targetUserId must be a member of the structure')
    );

    const res = await request(app).post('/api/pending-approvals/1/delegate').send({ targetUserId: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/pending-approvals/:id/open-to-structure', () => {
  it('returns 200 when the caller is the structure head', async () => {
    (ApprovalEngineService.prototype.openToStructure as jest.Mock).mockResolvedValueOnce({
      id: 1, assignedToUserId: null, openToStructure: true,
    });

    const res = await request(app).post('/api/pending-approvals/1/open-to-structure');
    expect(res.status).toBe(200);
    expect(ApprovalEngineService.prototype.openToStructure).toHaveBeenCalledWith(1, 20);
  });

  it('returns 409 when the decision is no longer pending', async () => {
    (ApprovalEngineService.prototype.openToStructure as jest.Mock).mockRejectedValueOnce(
      new ConflictError("Cannot reassign a decision in 'approved' status")
    );

    const res = await request(app).post('/api/pending-approvals/1/open-to-structure');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('GET /api/pending-approvals/:id/chain', () => {
  it('returns the chain of command for the decision', async () => {
    const chain = {
      pendingApprovalId: 1,
      status: 'approved',
      assignedToOrgUnit: { id: 3, name: 'Emergency Department', headUserId: 30, headName: 'Mara Demo' },
      reassignments: [],
      currentAssigneeUserId: 20,
      openToStructure: false,
      decidedByUserId: 20,
      decidedByName: 'Approver Demo',
    };
    (ApprovalEngineService.prototype.getDecisionChain as jest.Mock).mockResolvedValueOnce(chain);

    const res = await request(app).get('/api/pending-approvals/1/chain');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(chain);
  });

  it('returns 404 when the pending approval does not exist', async () => {
    (ApprovalEngineService.prototype.getDecisionChain as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Pending approval not found')
    );

    const res = await request(app).get('/api/pending-approvals/99/chain');
    expect(res.status).toBe(404);
  });
});
