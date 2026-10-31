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
// The shared client carries the cross-replica cancellation flag (#966).
const redisSet = jest.fn();
const redisExists = jest.fn();
const redisDel = jest.fn();
jest.mock('../config/redis', () => ({
  isRedisConfigured: () => redisEnabled,
  getRedis: () => (redisEnabled ? { set: redisSet, exists: redisExists, del: redisDel } : null),
  reconnectDelay: () => 1000,
}));

// Captured BullMQ doubles.
const queueAdd = jest.fn();
const queueGetJob = jest.fn();
const queueClose = jest.fn();
const queueOn = jest.fn();
const workerOn = jest.fn();
const workerClose = jest.fn();
let workerProcessor: ((job: unknown) => Promise<unknown>) | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: queueAdd,
    getJob: queueGetJob,
    close: queueClose,
    on: queueOn,
    getWaitingCount: jest.fn().mockResolvedValue(0),
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
  [queueAdd, queueGetJob, queueClose, queueOn, workerOn, workerClose, publishMock, generateMock].forEach((m) =>
    m.mockReset()
  );
  redisSet.mockReset().mockResolvedValue('OK');
  redisExists.mockReset().mockResolvedValue(0);
  redisDel.mockReset().mockResolvedValue(1);
});

describe('gating on Redis', () => {
  it('is disabled and enqueue/status/cancel are no-ops without Redis', async () => {
    redisEnabled = false;
    const q = load();
    expect(q.isOptimizationQueueEnabled()).toBe(false);
    await expect(q.enqueueOptimization({ scheduleId: 1, createdBy: 2 })).resolves.toBeNull();
    await expect(q.getOptimizationStatus(1)).resolves.toBeNull();
    await expect(q.cancelOptimization(1)).resolves.toBeNull();
  });
});

describe('enqueueOptimization', () => {
  it('adds a job with a per-schedule id when none exists', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    queueAdd.mockResolvedValue({ id: 'schedule-5' });

    const id = await q.enqueueOptimization({ scheduleId: 5, createdBy: 9 });

    expect(id).toBe('schedule-5');
    expect(queueAdd).toHaveBeenCalledWith('optimize', { scheduleId: 5, createdBy: 9 }, { jobId: 'schedule-5' });
  });

  it('returns the existing job without adding when one is in flight', async () => {
    const q = load();
    queueGetJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() });

    const id = await q.enqueueOptimization({ scheduleId: 5, createdBy: 9 });

    expect(id).toBe('schedule-5');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('replaces a finished job so a re-run can start', async () => {
    const q = load();
    const remove = jest.fn();
    queueGetJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('completed'), remove });
    queueAdd.mockResolvedValue({ id: 'schedule-5' });

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
      id: 'schedule-5',
      getState: jest.fn().mockResolvedValue('completed'),
      progress: 100,
      returnvalue: { scheduleId: 5, assignmentsCreated: 3, totalShifts: 4, coveragePercentage: 75, status: 'OK' },
      failedReason: undefined,
    });

    const status = await q.getOptimizationStatus(5);
    expect(status).toMatchObject({ jobId: 'schedule-5', state: 'completed', progress: 100 });
    expect(status!.result?.assignmentsCreated).toBe(3);
  });

  it('defaults progress to 0 and state to unknown when the job reports neither', async () => {
    const q = load();
    queueGetJob.mockResolvedValue({
      id: 'schedule-5',
      getState: jest.fn().mockResolvedValue(undefined),
      progress: undefined,
      returnvalue: undefined,
      failedReason: undefined,
    });

    const status = await q.getOptimizationStatus(5);
    expect(status).toMatchObject({ jobId: 'schedule-5', state: 'unknown', progress: 0 });
  });
});

describe('cancelOptimization', () => {
  const jobIn = (state: string, remove = jest.fn().mockResolvedValue(undefined)) => ({
    id: 'schedule-5',
    getState: jest.fn().mockResolvedValue(state),
    remove,
  });

  it('returns null when there is no job', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    await expect(q.cancelOptimization(5)).resolves.toBeNull();
  });

  it('removes a job that has not started yet', async () => {
    const q = load();
    const job = jobIn('waiting');
    queueGetJob.mockResolvedValue(job);
    await expect(q.cancelOptimization(5)).resolves.toBe('removed');
    expect(job.remove).toHaveBeenCalled();
  });

  // #966: remove() on a running job rejects ("locked by another worker"),
  // which used to surface as a 500. A running job is asked to stop instead.
  it('asks a running job to stop, through a flag every replica can see, without removing it', async () => {
    const q = load();
    const job = jobIn('active');
    queueGetJob.mockResolvedValue(job);
    await expect(q.cancelOptimization(5)).resolves.toBe('cancelling');
    expect(job.remove).not.toHaveBeenCalled();
    expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('schedule-5'), '1', 'EX', expect.any(Number));
  });

  it('asks the job to stop when it started between the state read and the removal', async () => {
    const q = load();
    const job = jobIn('waiting', jest.fn().mockRejectedValue(new Error('Job schedule-5 could not be removed because it is locked by another worker')));
    queueGetJob.mockResolvedValue(job);
    await expect(q.cancelOptimization(5)).resolves.toBe('cancelling');
    expect(redisSet).toHaveBeenCalled();
  });

  it.each(['completed', 'failed'])('refuses a %s job with a typed 409', async (state) => {
    const q = load();
    queueGetJob.mockResolvedValue(jobIn(state));
    await expect(q.cancelOptimization(5)).rejects.toMatchObject({ status: 409, code: 'OPTIMIZATION_NOT_CANCELLABLE' });
  });
});

describe('cooperative cancellation in the worker (#966)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts the run it is executing once the cancellation flag appears, and fails the job as cancelled', async () => {
    // From one isolated registry: the signal must be read from the same
    // AsyncLocalStorage instance the queue module runs the job under.
    let q!: typeof import('../services/OptimizationQueue');
    let currentCancellationSignal!: typeof import('../optimization/cancellation')['currentCancellationSignal'];
    jest.isolateModules(() => {
      q = require('../services/OptimizationQueue');
      currentCancellationSignal = require('../optimization/cancellation').currentCancellationSignal;
    });
    q.initOptimizationWorker({} as never);

    // A solve that honours the signal it runs under, as the real engines do.
    let solving = false;
    generateMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          solving = true;
          currentCancellationSignal()!.addEventListener('abort', () => reject(new Error('solver stopped')));
        })
    );
    const run = workerProcessor!({ id: 'schedule-5', data: { scheduleId: 5, createdBy: 9 }, updateProgress: jest.fn() });
    const outcome = run.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(0);
    expect(solving).toBe(true);

    // The planner cancels while the solve runs; the next poll sees it.
    redisExists.mockResolvedValue(1);
    await jest.advanceTimersByTimeAsync(q.CANCEL_POLL_MS * 2);

    const failure = await outcome;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(q.CANCELLED_REASON);
    expect(redisDel).toHaveBeenCalledWith(expect.stringContaining('schedule-5'));
  });

  it('reports a job failed as cancelled as state "cancelled"', async () => {
    const q = load();
    queueGetJob.mockResolvedValue({
      id: 'schedule-5',
      getState: jest.fn().mockResolvedValue('failed'),
      progress: 10,
      returnvalue: null,
      failedReason: q.CANCELLED_REASON,
    });
    await expect(q.getOptimizationStatus(5)).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('publishes optimization.cancelled, not optimization.failed, for a cancelled job', () => {
    const q = load();
    q.initOptimizationWorker({} as never);
    const failedHandler = workerOn.mock.calls.find(([evt]) => evt === 'failed')![1];
    failedHandler({ id: 'schedule-5', data: { scheduleId: 5, createdBy: 9 } }, new Error(q.CANCELLED_REASON));
    expect(publishMock).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'optimization.cancelled' }));
    expect(publishMock).not.toHaveBeenCalledWith(9, expect.objectContaining({ type: 'optimization.failed' }));
  });
});

describe('connection failures (#969)', () => {
  it('listens for errors on the worker, so a Redis outage is logged rather than thrown', () => {
    const q = load();
    q.initOptimizationWorker({} as never);
    const errorHandler = workerOn.mock.calls.find(([evt]) => evt === 'error')?.[1];
    const activeHandler = workerOn.mock.calls.find(([evt]) => evt === 'active')?.[1];
    expect(errorHandler).toBeDefined();
    // Repeated errors of one outage, the recovery that re-arms the log, a new outage.
    expect(() => {
      errorHandler(new Error('connect ECONNREFUSED'));
      errorHandler(new Error('connect ECONNREFUSED'));
      activeHandler();
      errorHandler(new Error('connect ECONNREFUSED'));
    }).not.toThrow();
  });

  it('listens for errors on the queue too', async () => {
    const q = load();
    queueGetJob.mockResolvedValue(null);
    queueAdd.mockResolvedValue({ id: 'schedule-1' });
    await q.enqueueOptimization({ scheduleId: 1, createdBy: 2 });
    const errorHandler = queueOn.mock.calls.find(([evt]) => evt === 'error')?.[1];
    expect(errorHandler).toBeDefined();
    expect(() => errorHandler(new Error('connect ECONNREFUSED'))).not.toThrow();
  });

  it('reconnects with the shared capped backoff instead of BullMQ defaults', () => {
    const { Worker } = require('bullmq');
    const q = load();
    q.initOptimizationWorker({} as never);
    const options = (Worker as jest.Mock).mock.calls[(Worker as jest.Mock).mock.calls.length - 1][2];
    expect(options.connection.retryStrategy(50)).toBe(1000);
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

    failedHandler({ id: 'schedule-5', data: { scheduleId: 5, createdBy: 9 } }, new Error('solver blew up'));

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

describe('parseRedisUrl', () => {
  it('parses host, port, password, and db from a full redis:// URL', () => {
    const { parseRedisUrl } = load();
    expect(parseRedisUrl('redis://:secret@cache.internal:6380/2')).toEqual({
      host: 'cache.internal',
      port: 6380,
      password: 'secret',
      db: 2,
    });
  });

  it('defaults port/password/db when the URL omits them', () => {
    const { parseRedisUrl } = load();
    expect(parseRedisUrl('redis://cache.internal')).toEqual({
      host: 'cache.internal',
      port: 6379,
      password: undefined,
      db: undefined,
    });
  });

  it('falls back to localhost:6379 when the URL cannot be parsed', () => {
    const { parseRedisUrl } = load();
    expect(parseRedisUrl('not-a-url')).toEqual({ host: '127.0.0.1', port: 6379 });
  });

  it('defaults host to 127.0.0.1 when the URL has no authority', () => {
    const { parseRedisUrl } = load();
    expect(parseRedisUrl('redis:///2').host).toBe('127.0.0.1');
  });
});
