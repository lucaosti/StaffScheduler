/**
 * Prometheus metrics module tests.
 *
 * Verify the registry renders the expected series, the HTTP middleware records a
 * request under its matched route pattern, the queue-depth gauge updates, and
 * the pool gauge samples a mysql2-shaped pool defensively.
 */

import type { Request, Response } from 'express';
import {
  registry,
  httpMetricsMiddleware,
  setOptimizationQueueDepth,
  registerPoolMetrics,
  renderMetrics,
} from '../observability/metrics';

describe('metrics registry', () => {
  it('renders default process metrics and the custom series', async () => {
    const { contentType, body } = await renderMetrics();
    expect(contentType).toContain('text/plain');
    expect(body).toContain('process_cpu_user_seconds_total'); // default metric
    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('optimization_queue_depth');
  });
});

describe('httpMetricsMiddleware', () => {
  it('records a completed request under its route pattern', async () => {
    const finishHandlers: Array<() => void> = [];
    const req = { method: 'GET', baseUrl: '/api/v1/schedules', route: { path: '/:id' } } as unknown as Request;
    const res = {
      statusCode: 200,
      on: (event: string, cb: () => void) => {
        if (event === 'finish') finishHandlers.push(cb);
      },
    } as unknown as Response;
    const next = jest.fn();

    httpMetricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    finishHandlers.forEach((h) => h()); // simulate response finish

    const body = await registry.metrics();
    expect(body).toContain('route="/api/v1/schedules/:id"');
    expect(body).toContain('status_code="200"');
  });

  it('labels an unmatched request as (unmatched)', async () => {
    const finish: Array<() => void> = [];
    const req = { method: 'GET', baseUrl: '', route: undefined, path: '/nope/123' } as unknown as Request;
    const res = {
      statusCode: 404,
      on: (e: string, cb: () => void) => e === 'finish' && finish.push(cb),
    } as unknown as Response;
    httpMetricsMiddleware(req, res, jest.fn());
    finish.forEach((h) => h());
    const body = await registry.metrics();
    expect(body).toContain('route="(unmatched)"');
  });
});

describe('setOptimizationQueueDepth', () => {
  it('sets the gauge (never negative)', async () => {
    setOptimizationQueueDepth(7);
    expect(await registry.getSingleMetricAsString('optimization_queue_depth')).toContain('7');
    setOptimizationQueueDepth(-3);
    // Clamped to 0.
    const body = await registry.getSingleMetricAsString('optimization_queue_depth');
    expect(body).toMatch(/optimization_queue_depth 0/);
  });
});

describe('registerPoolMetrics', () => {
  it('samples a mysql2-shaped pool at scrape time', async () => {
    const fakePool = {
      pool: {
        _allConnections: { length: 10 },
        _freeConnections: { length: 4 },
        _connectionQueue: { length: 2 },
      },
    };
    registerPoolMetrics(fakePool as never);
    const body = await registry.metrics();
    expect(body).toContain('db_pool_connections{state="total"} 10');
    expect(body).toContain('db_pool_connections{state="free"} 4');
    expect(body).toContain('db_pool_connections{state="in_use"} 6');
    expect(body).toContain('db_pool_connections{state="queued"} 2');
  });

  it('does not throw when the pool shape is unexpected', async () => {
    registerPoolMetrics({} as never);
    await expect(registry.metrics()).resolves.toBeDefined();
  });
});
