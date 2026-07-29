/**
 * Schedule optimization endpoints — the async job surface.
 *
 * OptimizationQueue is mocked so these pin the route contract without a broker:
 * POST /generate returns 202 + jobId when the queue is enabled and falls back
 * to a synchronous 200 when it is not; GET/DELETE /optimization map to
 * status/cancel and 404 when absent.
 */

import request from 'supertest';

const currentUser: { id: number; role: string; email: string } = { id: 1, role: 'admin', email: 'a@x' };
jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { ...currentUser, permissions: ['schedule.optimize', 'schedule.read', 'schedule.manage'] };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/ScheduleService');
jest.mock('../services/ReplanProposalService');
jest.mock('../services/OptimizationQueue');

import { ScheduleService } from '../services/ScheduleService';
import { ReplanProposalService } from '../services/ReplanProposalService';
import {
  enqueueOptimization,
  getOptimizationStatus,
  cancelOptimization,
} from '../services/OptimizationQueue';
import { createSchedulesRouter } from '../routes/schedules';
import { mountRouter } from './helpers/mountRouter';

const fakePool = {} as never;
const app = () => mountRouter('/api/schedules', createSchedulesRouter(fakePool));

beforeEach(() => {
  jest.clearAllMocks();
  (ScheduleService.prototype.getScheduleById as jest.Mock) = jest.fn().mockResolvedValue({ id: 5 });
});

describe('POST /api/schedules/:id/generate', () => {
  it('returns 404 when the schedule does not exist', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue(null);
    const res = await request(app()).post('/api/schedules/5/generate');
    expect(res.status).toBe(404);
  });

  it('enqueues and returns 202 with a job id when the queue is enabled', async () => {
    (enqueueOptimization as jest.Mock).mockResolvedValue('schedule:5');
    const res = await request(app()).post('/api/schedules/5/generate');
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ jobId: 'schedule:5', scheduleId: 5, state: 'queued' });
    expect(enqueueOptimization).toHaveBeenCalledWith({ scheduleId: 5, createdBy: 1 });
  });

  it('falls back to a synchronous 200 when the queue is disabled', async () => {
    (enqueueOptimization as jest.Mock).mockResolvedValue(null);
    (ScheduleService.prototype.generateOptimizedSchedule as jest.Mock) = jest.fn().mockResolvedValue({
      success: true,
      scheduleId: 5,
      assignmentsCreated: 2,
      totalShifts: 3,
      coveragePercentage: 66,
      status: 'OK',
    });
    const res = await request(app()).post('/api/schedules/5/generate');
    expect(res.status).toBe(200);
    expect(res.body.data.assignmentsCreated).toBe(2);
  });
});

describe('GET /api/schedules/:id/optimization', () => {
  it('returns the job status', async () => {
    (getOptimizationStatus as jest.Mock).mockResolvedValue({ jobId: 'schedule:5', state: 'active', progress: 40 });
    const res = await request(app()).get('/api/schedules/5/optimization');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'active', progress: 40 });
  });

  it('returns 404 when there is no job', async () => {
    (getOptimizationStatus as jest.Mock).mockResolvedValue(null);
    const res = await request(app()).get('/api/schedules/5/optimization');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/schedules/:id/optimization', () => {
  it('cancels an existing job', async () => {
    (cancelOptimization as jest.Mock).mockResolvedValue(true);
    const res = await request(app()).delete('/api/schedules/5/optimization');
    expect(res.status).toBe(200);
  });

  it('returns 404 when there is nothing to cancel', async () => {
    (cancelOptimization as jest.Mock).mockResolvedValue(false);
    const res = await request(app()).delete('/api/schedules/5/optimization');
    expect(res.status).toBe(404);
  });
});

/**
 * Deciding a replanning proposal.
 *
 * The gate is `schedule.publish`, not `schedule.optimize`: applying a plan
 * changes commitments people have already been told about, which is the same
 * authority publishing represents. Permissions are stubbed open here, so the
 * assertion that matters in this file is the OTHER guard — that a proposal
 * belonging to a different schedule cannot be applied through a path claiming
 * it belongs to this one.
 */
describe('replanning proposals', () => {
  const proposal = { id: 3, scheduleId: 5, status: 'pending' };

  beforeEach(() => {
    (ReplanProposalService.prototype.listForSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue([proposal]);
    (ReplanProposalService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(proposal);
    (ReplanProposalService.prototype.apply as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ proposal: { ...proposal, status: 'applied' }, inserted: 4, removed: 1 });
    (ReplanProposalService.prototype.reject as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ ...proposal, status: 'rejected' });
  });

  it('lists a schedule\'s proposals', async () => {
    const res = await request(app()).get('/api/schedules/5/replan-proposals');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([proposal]);
  });

  it('applies a proposal and reports both halves of the change', async () => {
    const res = await request(app())
      .post('/api/schedules/5/replan-proposals/3/apply')
      .send({ reason: 'Cover the gap' });
    expect(res.status).toBe(200);
    expect(ReplanProposalService.prototype.apply).toHaveBeenCalledWith(3, 1, 'Cover the gap');
    // The removals are the part a planner most needs to see named.
    expect(res.body.message).toContain('1 removed');
  });

  it('rejects a proposal', async () => {
    const res = await request(app())
      .post('/api/schedules/5/replan-proposals/3/reject')
      .send({ reason: 'Too disruptive' });
    expect(res.status).toBe(200);
    expect(ReplanProposalService.prototype.reject).toHaveBeenCalledWith(3, 1, 'Too disruptive');
  });

  it('refuses a proposal belonging to another schedule', async () => {
    (ReplanProposalService.prototype.getById as jest.Mock).mockResolvedValue({
      ...proposal,
      scheduleId: 99,
    });
    // Without this check the schedule segment would be decoration, and any
    // proposal could be applied through a path suggesting it was for this one.
    const res = await request(app()).post('/api/schedules/5/replan-proposals/3/apply').send({});
    expect(res.status).toBe(404);
    expect(ReplanProposalService.prototype.apply).not.toHaveBeenCalled();
  });
});
