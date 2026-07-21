/**
 * OptimizationQueue tests — the async job model's control logic.
 *
 * BullMQ and Redis are mocked so no broker is needed; these pin the decisions
 * the module makes: gating on Redis, per-schedule dedup (an in-flight job is
 * returned, not duplicated; a finished one is replaced so a re-run can start),
 * status/progress/result mapping, cancellation, and the worker processor
 * (runs the orchestrator, reports progress, emits SSE). The enable/disable
 * gate is what lets the route fall back to synchronous generation without
 * Redis.
 */

let redisEnabled = true;
jest.mock('../config/redis', () => ({
  isRedisConfigured: () => redisEnabled,
}));

// Captured BullMQ doubles.
const queueAdd = jest.fn();
const queueGetJob = jest.fn();
const queueClose = jest.fn();
const workerOn = jest.fn();
const workerClose = jest.fn();
let workerProcessor: ((job: unknown) => Promise<unknown>) | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: queueAdd,
    getJob: queueGetJob,
    close: queueClose,
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: (job: unknown) => Promise<unknown>) => {
    workerProcessor = processor;
    return { on: workerOn, close: workerClose };
  }),
}));

const publishMock = jest.fn();
jest.mock('../services/EventBus', () => ({ eventBus: { publish: publishMock } }));

const generateMock = jest.fn();
jest.mock('../services/ScheduleOptimizationOrchestrator', () => ({
  ScheduleOptimizationOrchestrator: jest.fn().mockImplementation(() => ({
    generateOptimizedSchedule: generateMock,
  })),
}));

const load = () => {
  let mod!: typeof import('../services/OptimizationQueue');
  jest.isolateModules(() => {
    mod = require('../services/OptimizationQueue');
  });
  return mod;
};

beforeEach(() => {
  redisEnabled = true;
  workerProcessor = null;
  [queueAdd, queueGetJob, queueClose, workerOn, workerClose, publishMock, generateMock].forEach((m) =>
    m.mockReset()
  );
});

describe('gating on Redis', () => {
  it('is disabled and enqueue/status/cancel are no-ops without Redis', async () => {
    redisEnabled = false;
    const q = load();
    expect(q.isOptimizationQueueEnabled()).toBe(false);
    await expect(q.enqueueOptimization({ scheduleId: 1, createdBy: 2 })).resolves.toBeNull();
    await expect(q.getOptimizationStatus(1)).resolves.toBeNull();
    await expect(q.cancelOptimization(1)).resolves.toBe(false);
  });
});

describe('enqueueOptimization', () => {
  it('adds a job with a per-schedule id when none exists', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    queueAdd.mockResolvedValue({ id: 'schedule:5' });

    const id = await q.enqueueOptimization({ scheduleId: 5, createdBy: 9 });

    expect(id).toBe('schedule:5');
    expect(queueAdd).toHaveBeenCalledWith('optimize', { scheduleId: 5, createdBy: 9 }, { jobId: 'schedule:5' });
  });

  it('returns the existing job without adding when one is in flight', async () => {
    const q = load();
    queueGetJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() });

    const id = await q.enqueueOptimization({ scheduleId: 5, createdBy: 9 });

    expect(id).toBe('schedule:5');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('replaces a finished job so a re-run can start', async () => {
    const q = load();
    const remove = jest.fn();
    queueGetJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('completed'), remove });
    queueAdd.mockResolvedValue({ id: 'schedule:5' });

    await q.enqueueOptimization({ scheduleId: 5, createdBy: 9 });

    expect(remove).toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalled();
  });
});

describe('getOptimizationStatus', () => {
  it('returns null when no job exists', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    await expect(q.getOptimizationStatus(5)).resolves.toBeNull();
  });

  it('maps state, progress, result and failedReason', async () => {
    const q = load();
    queueGetJob.mockResolvedValue({
      id: 'schedule:5',
      getState: jest.fn().mockResolvedValue('completed'),
      progress: 100,
      returnvalue: { scheduleId: 5, assignmentsCreated: 3, totalShifts: 4, coveragePercentage: 75, status: 'OK' },
      failedReason: undefined,
    });

    const status = await q.getOptimizationStatus(5);
    expect(status).toMatchObject({ jobId: 'schedule:5', state: 'completed', progress: 100 });
    expect(status!.result?.assignmentsCreated).toBe(3);
  });
});

describe('cancelOptimization', () => {
  it('returns false when there is no job', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    await expect(q.cancelOptimization(5)).resolves.toBe(false);
  });

  it('removes the job and returns true', async () => {
    const q = load();
    const remove = jest.fn();
    queueGetJob.mockResolvedValue({ remove });
    await expect(q.cancelOptimization(5)).resolves.toBe(true);
    expect(remove).toHaveBeenCalled();
  });
});

describe('worker processor', () => {
  it('runs the orchestrator, reports progress and emits SSE', async () => {
    const q = load();
    q.initOptimizationWorker({} as never);
    expect(workerProcessor).toBeTruthy();

    generateMock.mockResolvedValue({
      scheduleId: 5,
      assignmentsCreated: 3,
      totalShifts: 4,
      coveragePercentage: 75,
      status: 'OK',
    });
    const updateProgress = jest.fn();
    const result = await workerProcessor!({ data: { scheduleId: 5, createdBy: 9 }, updateProgress });

    expect(generateMock).toHaveBeenCalledWith(5, 9);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({ assignmentsCreated: 3 });
    // Progress + completion events published to the requesting user.
    expect(publishMock).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'optimization.progress' }));
    expect(publishMock).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'optimization.completed' }));
  });

  it('is a no-op when Redis is disabled or already started', () => {
    redisEnabled = false;
    const q = load();
    q.initOptimizationWorker({} as never);
    // Worker constructor never invoked → no processor captured.
    expect(workerProcessor).toBeNull();
  });

  it('logs and emits SSE when a job fails', () => {
    const q = load();
    q.initOptimizationWorker({} as never);
    const failedHandler = workerOn.mock.calls.find(([evt]) => evt === 'failed')![1];

    failedHandler({ id: 'schedule:5', data: { scheduleId: 5, createdBy: 9 } }, new Error('solver blew up'));

    expect(publishMock).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'optimization.failed' }));
  });
});

describe('closeOptimizationQueue', () => {
  it('closes the worker and queue', async () => {
    const q = load();
    q.initOptimizationWorker({} as never);
    queueGetJob.mockResolvedValue(null);
    queueAdd.mockResolvedValue({ id: 'schedule:1' });
    await q.enqueueOptimization({ scheduleId: 1, createdBy: 2 }); // forces the queue to exist

    await q.closeOptimizationQueue();

    expect(workerClose).toHaveBeenCalled();
    expect(queueClose).toHaveBeenCalled();
  });
});
