/**
 * Schedule-optimization job queue (BullMQ over Redis).
 *
 * Why a queue: schedule optimization can run for minutes (the CP-SAT solver or
 * the greedy fallback over a full month). Running it inside the HTTP request
 * — as `POST /schedules/:id/generate` used to — holds an Express worker and
 * the client socket open for the whole solve, times out behind proxies, and
 * gives the user no progress or cancellation. Moving it to a background job
 * makes `generate` return immediately with a job id; the client polls status
 * (and receives SSE progress), and can cancel.
 *
 * Why BullMQ: it is the de-facto Redis-backed job queue for Node, giving
 * durable jobs, retries, concurrency limits and cancellation without building
 * a bespoke scheduler. It requires Redis — which this system now runs by
 * default — so `isEnabled()` gates on Redis being configured. When Redis is
 * off (single-instance/local without Redis), callers fall back to running the
 * optimization synchronously, preserving the zero-Redis story at the cost of a
 * long request; that trade-off only affects deployments that opted out of the
 * infrastructure the async model needs.
 *
 * Dedup and re-runnability: the job id is deterministic per schedule
 * (`schedule-{id}`), so a second generate while one is in flight returns the
 * SAME job instead of starting a competing solve for the same schedule
 * (bounded concurrency "one active solve per schedule", plus a global worker
 * concurrency of 1 so a burst cannot saturate the box). A finished job is
 * retained briefly so its result is queryable, and replaced when a new run for
 * the same schedule is requested.
 *
 * The worker runs in-process by default (co-located with the API) but is a
 * self-contained module, so extracting it into a dedicated worker process is a
 * deployment change, not a code change.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { getRedis, isRedisConfigured, reconnectDelay } from '../config/redis';
import { OptimizationNotCancellableError } from '../errors';
import { runWithCancellation } from '../optimization/cancellation';
import { logger } from '../config/logger';
import { eventBus } from './EventBus';
import { setOptimizationQueueDepth } from '../observability/metrics';
import type { Pool } from 'mysql2/promise';

const QUEUE_NAME = 'schedule-optimization';
/** Keep a finished job for an hour so status/result stays queryable. */
const COMPLETED_TTL_SECONDS = 3600;

export interface OptimizationJobData {
  scheduleId: number;
  createdBy: number;
}

export interface OptimizationResult {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
  /** Engine that produced the schedule: 'or-tools' (optimal) or 'greedy' (draft/fallback). */
  engine: 'or-tools' | 'greedy';
  /** True when the optimum was requested but the run degraded to greedy. */
  degraded: boolean;
  /** Human-readable reason for a degraded run, when applicable. */
  degradedReason?: string;
}

export interface OptimizationJobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  progress: number;
  result?: OptimizationResult;
  failedReason?: string;
}

/** What `cancelOptimization` did: removed a job that had not started, or asked a running one to stop. */
export type CancelOutcome = 'removed' | 'cancelling';

/**
 * The failure reason of a job that ended because it was cancelled. BullMQ
 * stores a failed job's reason as its error message, so this is how the
 * status endpoint tells a cancellation from a failure.
 */
export const CANCELLED_REASON = 'Cancelled at the planner\'s request';

/** How often a running job checks whether it has been asked to stop. */
export const CANCEL_POLL_MS = 500;

/** A cancellation request outlives any solve; it is deleted as soon as the job ends. */
const CANCEL_FLAG_TTL_SECONDS = 3600;

// A hyphen, not a colon: BullMQ rejects custom ids containing ':' (they collide
// with its internal `repeat:` key format), and `schedule:{id}` made every
// generate fail with "Custom Id cannot contain :" wherever Redis was on (#889).
// The mocked unit suite could not see it; optimizationQueue.redis.integration
// runs the real library.
const jobIdFor = (scheduleId: number): string => `schedule-${scheduleId}`;

/** Redis key of a job's cancellation request (a plain key: no BullMQ id rules apply). */
const cancelKeyFor = (jobId: string): string => `optimization:cancel:${jobId}`;

/**
 * Refresh the queue-depth metric from the live waiting count. Best-effort: a
 * metrics update must never break enqueue/worker flow, so failures are swallowed.
 */
const refreshQueueDepth = (): void => {
  try {
    const pending = queue?.getWaitingCount?.();
    if (pending && typeof pending.then === 'function') {
      pending.then((count) => setOptimizationQueueDepth(count)).catch(() => undefined);
    }
  } catch {
    // A metrics update must never break the enqueue/worker flow.
  }
};

// BullMQ connects with its own client; give it the same URL as the caches.
// maxRetriesPerRequest must be null for BullMQ blocking commands. The retry
// strategy is the shared one (#969): reconnect for as long as Redis is away,
// capped and jittered, so the queue comes back by itself after an outage
// exactly when the caches do.
const connection = (): ConnectionOptions => ({
  // ioredis accepts a URL as the first positional arg, but ConnectionOptions
  // wants an object; parse the essentials from the configured URL.
  ...parseRedisUrl(config.redis.url),
  maxRetriesPerRequest: null,
  retryStrategy: reconnectDelay,
});

/**
 * Logs a queue/worker connection error once per outage. BullMQ re-emits its
 * connection's errors as 'error' events, and an EventEmitter 'error' with no
 * listener is THROWN — an uncaught exception that took the process down on
 * the first Redis blip (#969, the queue's share of #825).
 */
let connectionErrorLogged = false;
const onConnectionError = (source: string) => (err: Error): void => {
  if (connectionErrorLogged) return;
  connectionErrorLogged = true;
  logger.warn(`Optimization ${source} lost its Redis connection; it reconnects on its own`, {
    message: err.message,
  });
};

/** Minimal redis:// URL parser sufficient for host/port/password/db. Exported for direct unit testing. */
export const parseRedisUrl = (url: string): { host: string; port: number; password?: string; db?: number } => {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 6379,
      password: u.password || undefined,
      db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
};

let queue: Queue<OptimizationJobData, OptimizationResult> | null = null;
let worker: Worker<OptimizationJobData, OptimizationResult> | null = null;

/** True when the async job model is available (i.e. Redis is configured). */
export const isOptimizationQueueEnabled = (): boolean => isRedisConfigured();

/** Lazily creates and returns the queue, or null when Redis is off. */
export const getOptimizationQueue = (): Queue<OptimizationJobData, OptimizationResult> | null => {
  if (!isOptimizationQueueEnabled()) return null;
  if (!queue) {
    queue = new Queue<OptimizationJobData, OptimizationResult>(QUEUE_NAME, {
      connection: connection(),
      defaultJobOptions: {
        removeOnComplete: { age: COMPLETED_TTL_SECONDS },
        removeOnFail: { age: COMPLETED_TTL_SECONDS },
        attempts: 1, // a failed solve is reported, not blindly retried
      },
    });
    queue.on('error', onConnectionError('queue'));
  }
  return queue;
};

/**
 * Enqueues an optimization run, returning the job id. Idempotent per schedule:
 * a job already in flight for the same schedule is returned as-is; a finished
 * one is replaced. Returns null when the queue is disabled (caller runs sync).
 */
export const enqueueOptimization = async (
  data: OptimizationJobData
): Promise<string | null> => {
  const q = getOptimizationQueue();
  if (!q) return null;
  const jobId = jobIdFor(data.scheduleId);

  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed') {
      return jobId; // a solve is already in flight for this schedule
    }
    // A finished/failed job with this deterministic id would block re-adding —
    // remove it so a new run can start.
    await existing.remove();
  }

  await q.add('optimize', data, { jobId });
  refreshQueueDepth();
  return jobId;
};

/** Reads the status/progress/result of a schedule's optimization job. */
export const getOptimizationStatus = async (
  scheduleId: number
): Promise<OptimizationJobStatus | null> => {
  const q = getOptimizationQueue();
  if (!q) return null;
  const job = await q.getJob(jobIdFor(scheduleId));
  if (!job) return null;
  const raw = (await job.getState()) as OptimizationJobStatus['state'];
  const state = raw === 'failed' && job.failedReason === CANCELLED_REASON ? 'cancelled' : raw;
  const progress = typeof job.progress === 'number' ? job.progress : 0;
  return {
    jobId: job.id!,
    state: state ?? 'unknown',
    progress,
    result: job.returnvalue ?? undefined,
    failedReason: job.failedReason ?? undefined,
  };
};

/**
 * Cancels a schedule's optimization job (#966). Returns null when there is no
 * job (or no queue), `'removed'` when a job that had not started was dropped,
 * and `'cancelling'` when a running job was asked to stop; throws
 * `OptimizationNotCancellableError` (409) for a job that already finished.
 *
 * WHY A RUNNING JOB IS ASKED, NOT REMOVED. `job.remove()` on an active job
 * rejects — BullMQ will not remove a job "locked by another worker" — and
 * that rejection used to reach the client as a 500. Nor would removal stop
 * anything: the solve runs in the worker's process, possibly on another
 * replica. So the request is a Redis key every replica can see; the worker
 * running the job polls it and aborts the run's cancellation signal, which
 * kills the solver child and stops the run before it persists (see
 * optimization/cancellation.ts). Rejected: BullMQ's own `Worker.cancelJob`,
 * which only reaches a job held by the worker object it is called on — that
 * is, only when the request lands on the replica running the job.
 *
 * A waiting job that is picked up between the state read and the removal
 * makes `remove()` reject the same way; it is then running, and is asked to
 * stop like any other running job.
 */
export const cancelOptimization = async (scheduleId: number): Promise<CancelOutcome | null> => {
  const q = getOptimizationQueue();
  if (!q) return null;
  const jobId = jobIdFor(scheduleId);
  const job = await q.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') throw new OptimizationNotCancellableError();
  if (state !== 'active') {
    try {
      await job.remove();
      return 'removed';
    } catch {
      // Picked up meanwhile (locked by the worker now running it): ask it to stop.
    }
  }
  await requestCancellation(jobId);
  return 'cancelling';
};

// Non-null: a queue exists only when Redis is configured, and then so does the client.
const requestCancellation = async (jobId: string): Promise<void> => {
  await getRedis()!.set(cancelKeyFor(jobId), '1', 'EX', CANCEL_FLAG_TTL_SECONDS);
};

/** True when someone asked the job to stop. A failed read is "not yet": the next poll asks again. */
const isCancellationRequested = async (jobId: string): Promise<boolean> => {
  try {
    return (await getRedis()?.exists(cancelKeyFor(jobId))) === 1;
  } catch {
    return false;
  }
};

/**
 * Runs `work` under a cancellation signal that fires when the job's
 * cancellation flag appears, checked every CANCEL_POLL_MS. A cancelled run
 * rejects with CANCELLED_REASON, whatever error the engines stopped with, so
 * the job's failure reads as a cancellation. The flag is removed when the
 * run ends either way, so a later run of the same schedule starts clean.
 */
const runCancellable = async <T>(jobId: string, work: () => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const check = async (): Promise<void> => {
    if (!controller.signal.aborted && (await isCancellationRequested(jobId))) controller.abort();
  };
  const watcher = setInterval(() => void check(), CANCEL_POLL_MS);
  watcher.unref?.();
  try {
    await check();
    return await runWithCancellation(controller.signal, work);
  } catch (err) {
    if (controller.signal.aborted) throw new Error(CANCELLED_REASON);
    throw err;
  } finally {
    clearInterval(watcher);
    await getRedis()?.del(cancelKeyFor(jobId)).catch(() => undefined);
  }
};

/**
 * Starts the in-process worker that runs queued optimizations. Call once at
 * startup. No-op without Redis. The processor emits coarse progress via SSE
 * (queued → running → done) so the client shows movement even though the
 * solver itself is not step-instrumented.
 */
export const initOptimizationWorker = (pool: Pool): void => {
  if (!isOptimizationQueueEnabled() || worker) return;
  worker = new Worker<OptimizationJobData, OptimizationResult>(
    QUEUE_NAME,
    async (job: Job<OptimizationJobData>) => {
      const { scheduleId, createdBy } = job.data;
      await job.updateProgress(10);
      eventBus.publish(createdBy, {
        type: 'optimization.progress',
        payload: { scheduleId, state: 'running', progress: 10 },
      });

      // Lazy require avoids a load-time cycle (orchestrator → services → here).
      const { ScheduleOptimizationOrchestrator } = require('./ScheduleOptimizationOrchestrator');
      const orchestrator = new ScheduleOptimizationOrchestrator(pool);
      const result = await runCancellable<OptimizationResult>(job.id!, () =>
        orchestrator.generateOptimizedSchedule(scheduleId, createdBy)
      );

      await job.updateProgress(100);
      eventBus.publish(createdBy, {
        type: 'optimization.completed',
        payload: { ...result, scheduleId },
      });
      refreshQueueDepth();
      return result;
    },
    {
      connection: connection(),
      // One solve at a time across the process: optimization is CPU/child-
      // process heavy, so serialising protects the box from a burst.
      concurrency: 1,
    }
  );

  worker.on('error', onConnectionError('worker'));
  // A worker that is processing again has its connection back: re-arm the log.
  worker.on('active', () => {
    connectionErrorLogged = false;
  });

  worker.on('failed', (job, err) => {
    refreshQueueDepth();
    // A cancellation is the outcome the planner asked for, not a failure.
    const cancelled = err.message === CANCELLED_REASON;
    if (cancelled) logger.info('Optimization job cancelled', { jobId: job?.id });
    else logger.error('Optimization job failed', { jobId: job?.id, message: err.message });
    if (job) {
      eventBus.publish(job.data.createdBy, {
        type: cancelled ? 'optimization.cancelled' : 'optimization.failed',
        payload: { scheduleId: job.data.scheduleId, message: err.message },
      });
    }
  });
};

/** Closes the queue and worker on graceful shutdown. */
export const closeOptimizationQueue = async (): Promise<void> => {
  await Promise.all([worker?.close(), queue?.close()].filter(Boolean));
  worker = null;
  queue = null;
};
