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
 * (`schedule:{id}`), so a second generate while one is in flight returns the
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
import { isRedisConfigured } from '../config/redis';
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
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
  progress: number;
  result?: OptimizationResult;
  failedReason?: string;
}

const jobIdFor = (scheduleId: number): string => `schedule:${scheduleId}`;

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
// maxRetriesPerRequest must be null for BullMQ blocking commands.
const connection = (): ConnectionOptions => ({
  // ioredis accepts a URL as the first positional arg, but ConnectionOptions
  // wants an object; parse the essentials from the configured URL.
  ...parseRedisUrl(config.redis.url),
  maxRetriesPerRequest: null,
});

/** Minimal redis:// URL parser sufficient for host/port/password/db. */
const parseRedisUrl = (url: string): { host: string; port: number; password?: string; db?: number } => {
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
  const state = (await job.getState()) as OptimizationJobStatus['state'];
  const progress = typeof job.progress === 'number' ? job.progress : 0;
  return {
    jobId: job.id!,
    state: state ?? 'unknown',
    progress,
    result: job.returnvalue ?? undefined,
    failedReason: job.failedReason ?? undefined,
  };
};

/** Cancels a schedule's optimization job. Returns true when a job was removed. */
export const cancelOptimization = async (scheduleId: number): Promise<boolean> => {
  const q = getOptimizationQueue();
  if (!q) return false;
  const job = await q.getJob(jobIdFor(scheduleId));
  if (!job) return false;
  // remove() drops a waiting job; for an active one it also signals the worker
  // via the abort/lock so it stops persisting once the current step finishes.
  await job.remove();
  return true;
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
      const result = await orchestrator.generateOptimizedSchedule(scheduleId, createdBy);

      await job.updateProgress(100);
      eventBus.publish(createdBy, {
        type: 'optimization.completed',
        payload: { scheduleId, ...result },
      });
      refreshQueueDepth();
      return result as OptimizationResult;
    },
    {
      connection: connection(),
      // One solve at a time across the process: optimization is CPU/child-
      // process heavy, so serialising protects the box from a burst.
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('Optimization job failed', { jobId: job?.id, message: err.message });
    refreshQueueDepth();
    if (job) {
      eventBus.publish(job.data.createdBy, {
        type: 'optimization.failed',
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
