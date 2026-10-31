/**
 * Prometheus metrics.
 *
 * WHY prom-client (and not only OpenTelemetry): a pull-based Prometheus endpoint
 * is the lowest-friction way to get production visibility for a self-hosted
 * deployment — Prometheus scrapes `/metrics`, Grafana reads Prometheus, and no
 * push gateway or collector is required for the metrics half. (Traces are added
 * separately via OpenTelemetry, which correlates with the request id.) Keeping
 * the metric definitions in one module means every counter/gauge/histogram is
 * registered against one registry that the `/metrics` route renders.
 *
 * WHAT is measured, and why these:
 *   - default process metrics (event-loop lag, heap, GC) — the baseline every
 *     Node service should expose;
 *   - http_request_duration_seconds — a histogram labelled by method/route/
 *     status, the source of both the error-rate and p95-latency panels;
 *   - db_pool_connections — a gauge of the mysql2 pool (total/free/queued), so a
 *     pool exhaustion (the classic cause of latency cliffs here) is visible;
 *   - optimization_queue_depth — how many optimization jobs are waiting, the
 *     signal that the single-concurrency worker is falling behind;
 *   - redis_connected / redis_reconnect_attempts_total — the shared Redis
 *     connection's state and its attempts to come back after an outage.
 *
 * Route labels use the matched route *pattern* (e.g. `/api/v1/schedules/:id`),
 * never the concrete path, so an id per request cannot explode label
 * cardinality — the standard Prometheus pitfall.
 *
 * @author Luca Ostinelli
 */

import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'mysql2/promise';

/** Dedicated registry so the metric set is explicit and testable in isolation. */
export const registry = new client.Registry();

// Baseline process metrics (event loop, memory, GC, ...).
client.collectDefaultMetrics({ register: registry });

/** HTTP server latency + implicitly request/error counts (via the _count series). */
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Buckets tuned for a web API: sub-second detail plus a few slow buckets.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

// The pool to sample, set by registerPoolMetrics. Held at module scope so the
// gauge's collect() (invoked by prom-client at scrape time) can read it.
let poolRef: Pool | null = null;

/**
 * mysql2 pool occupancy, sampled at scrape time via the collect() callback.
 * Not bound to a variable: constructing it registers it on `registry`, and the
 * collect() closure is the only thing that touches it thereafter.
 */
new client.Gauge({
  name: 'db_pool_connections',
  help: 'MySQL connection pool connections by state',
  labelNames: ['state'] as const,
  registers: [registry],
  collect() {
    if (!poolRef) return;
    // The promise-pool wraps a callback pool whose internal arrays hold the
    // connection state; read defensively (not part of mysql2's public API) so a
    // version change degrades to "no sample" rather than throwing on scrape.
    const inner = (poolRef as unknown as { pool?: {
      _allConnections?: { length: number };
      _freeConnections?: { length: number };
      _connectionQueue?: { length: number };
    } }).pool;
    if (!inner) return;
    const all = inner._allConnections?.length ?? 0;
    const free = inner._freeConnections?.length ?? 0;
    const queued = inner._connectionQueue?.length ?? 0;
    this.set({ state: 'total' }, all);
    this.set({ state: 'free' }, free);
    this.set({ state: 'in_use' }, Math.max(0, all - free));
    this.set({ state: 'queued' }, queued);
  },
});

/** Optimization jobs waiting to run (0 when the queue is disabled/empty). */
const optimizationQueueDepth = new client.Gauge({
  name: 'optimization_queue_depth',
  help: 'Number of optimization jobs waiting in the queue',
  registers: [registry],
});

/**
 * Whether the shared Redis connection is up (1) or not (0), and how many
 * times it has tried to come back (#969). Together they distinguish "Redis is
 * down and we are retrying" from "Redis is down and we have stopped" — the
 * second used to be the silent default after ~11 s of outage.
 */
const redisConnected = new client.Gauge({
  name: 'redis_connected',
  help: 'Whether the shared Redis connection is ready (1) or not (0)',
  registers: [registry],
});
const redisReconnectAttempts = new client.Counter({
  name: 'redis_reconnect_attempts_total',
  help: 'Reconnection attempts made by the shared Redis connection',
  registers: [registry],
});

/**
 * Request-path operations served from the in-process fallback instead of
 * Redis (#970), by why: `unavailable` (connection down), `bypassed` (inside
 * the window after a failed command), `error` (the command itself failed or
 * timed out). A small fixed label set, never the key or the command.
 */
const redisFallbacks = new client.Counter({
  name: 'redis_fallback_total',
  help: 'Request-path cache operations served in-process instead of by Redis',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export function countRedisFallback(reason: 'unavailable' | 'bypassed' | 'error'): void {
  redisFallbacks.inc({ reason });
}

export function setRedisConnected(connected: boolean): void {
  redisConnected.set(connected ? 1 : 0);
}

export function countRedisReconnectAttempt(): void {
  redisReconnectAttempts.inc();
}

/** Point the pool gauge at the live mysql2 pool (sampled lazily on each scrape). */
export function registerPoolMetrics(pool: Pool): void {
  poolRef = pool;
}

/** Update the queue-depth gauge (called by the optimization worker/enqueue path). */
export function setOptimizationQueueDepth(depth: number): void {
  optimizationQueueDepth.set(Math.max(0, depth));
}

/**
 * Express middleware that times every request and records it under the matched
 * route pattern. Registered once, early, so it wraps the whole pipeline.
 */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // req.route is only populated once a route matches; everything else (404s,
    // middleware-only responses) collapses to a single low-cardinality label so
    // arbitrary paths can never explode the series count.
    const routePattern = req.route ? (req.baseUrl || '') + req.route.path : '(unmatched)';
    endTimer({
      method: req.method,
      route: routePattern || '(unknown)',
      status_code: String(res.statusCode),
    });
  });
  next();
}

/** Render the registry in Prometheus text format. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
