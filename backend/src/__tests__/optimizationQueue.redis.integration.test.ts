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

import {
  enqueueOptimization,
  getOptimizationStatus,
  cancelOptimization,
  closeOptimizationQueue,
  getOptimizationQueue,
} from '../services/OptimizationQueue';

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
    await expect(cancelOptimization(SCHEDULE_ID)).resolves.toBe(true);
    await expect(getOptimizationStatus(SCHEDULE_ID)).resolves.toBeNull();
  });
});
