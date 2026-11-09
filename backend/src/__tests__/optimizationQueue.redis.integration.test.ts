/**
 * OptimizationQueue against a REAL BullMQ queue on a real Redis (#889).
 *
 * The unit suite (optimizationQueue.test.ts) mocks BullMQ, so it could not see
 * that BullMQ itself rejects the ids the module built: `schedule:{id}` failed
 * BullMQ's custom-id validation ("Custom Id cannot contain :"), and every
 * `POST /schedules/:id/generate` returned 500 wherever Redis was enabled — the
 * default deployment. Only the real library can pin that contract.
 *
 * Requires Redis at REDIS_URL (the verification stack and the CI e2e job both
 * provide one). A missing Redis is an error, not a skip: a skipped run is how
 * this defect stayed invisible.
 *
 * @author Luca Ostinelli
 */

process.env.REDIS_ENABLED = 'true';

// The solve, stood in for: it runs until the cancellation signal it runs
// under fires (or 20 s pass, which fails the test by finishing "completed").
let mockSolveStarts = 0;
jest.mock('../services/ScheduleOptimizationOrchestrator', () => ({
  ScheduleOptimizationOrchestrator: jest.fn().mockImplementation(() => ({
    generateOptimizedSchedule: () =>
      new Promise((resolve, reject) => {
        mockSolveStarts += 1;
        const timer = setTimeout(() => resolve({ assignmentsCreated: 1 }), 20_000);
        const { currentCancellationSignal } = require('../optimization/cancellation');
        currentCancellationSignal()?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('solver stopped'));
        });
      }),
  })),
}));

import {
  enqueueOptimization,
  getOptimizationStatus,
  cancelOptimization,
  closeOptimizationQueue,
  getOptimizationQueue,
  initOptimizationWorker,
} from '../services/OptimizationQueue';
import { closeRedis } from '../config/redis';

// Far outside any id a real schedule gets, so a shared Redis is not disturbed.
const SCHEDULE_ID = 987_654_321;

beforeAll(() => {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL must point at a reachable Redis for this suite');
  }
});

afterAll(async () => {
  await getOptimizationQueue()?.obliterate({ force: true });
  await closeOptimizationQueue();
  await closeRedis();
});

describe('optimization queue on real BullMQ', () => {
  it('enqueues a run for a schedule, and the same schedule again returns the in-flight job', async () => {
    const jobId = await enqueueOptimization({ scheduleId: SCHEDULE_ID, createdBy: 1 });
    expect(jobId).toEqual(expect.any(String));

    const again = await enqueueOptimization({ scheduleId: SCHEDULE_ID, createdBy: 1 });
    expect(again).toBe(jobId);

    const status = await getOptimizationStatus(SCHEDULE_ID);
    expect(status).toMatchObject({ jobId, state: 'waiting' });
  });

  it('cancels the waiting run', async () => {
    await expect(cancelOptimization(SCHEDULE_ID)).resolves.toBe('removed');
    await expect(getOptimizationStatus(SCHEDULE_ID)).resolves.toBeNull();
  });
});

/**
 * #966: cancelling a job the worker has already picked up answered 500 —
 * BullMQ refuses to remove a job "locked by another worker". The worker runs
 * here for real, on the real queue, with only the solve itself stood in for:
 * a run that lasts until it is told to stop through the signal it runs under,
 * which is how the real engines learn of a cancellation.
 */
describe('cancelling a running optimization on real BullMQ (#966)', () => {
  const RUNNING_ID = SCHEDULE_ID + 1;

  const waitForState = async (state: string, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await getOptimizationStatus(RUNNING_ID);
      if (status?.state === state) return status;
      if (Date.now() > deadline) throw new Error(`job never reached ${state} (last: ${status?.state})`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  it('asks the running job to stop (202-style "cancelling"), and the job ends cancelled', async () => {
    initOptimizationWorker({} as never);
    await enqueueOptimization({ scheduleId: RUNNING_ID, createdBy: 1 });
    await waitForState('active');

    await expect(cancelOptimization(RUNNING_ID)).resolves.toBe('cancelling');

    const finished = await waitForState('cancelled');
    expect(finished.result).toBeUndefined();
    expect(mockSolveStarts).toBe(1);
  }, 30_000);
});
