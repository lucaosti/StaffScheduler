/**
 * Health Check Routes
 *
 * Provides system health monitoring and status endpoints.
 * Used for application monitoring and load balancer health checks.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { database } from '../config/database';
import { getRedisHealth, isRedisConfigured, type RedisHealth } from '../config/redis';
import { settleWithin } from '../utils/timeout';

/** Longest the health endpoint waits on any one dependency before answering. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

// Single source of truth for the service version. Works from both src/ (ts-node)
// and dist/ (compiled) since the relative position to package.json is the same.
const { version: SERVICE_VERSION } = require('../../package.json') as { version: string };

const router = Router();

/**
 * Health Check Endpoint
 *
 * Returns system health status and performance metrics.
 * Performs a real database connectivity check before responding.
 * Responds with HTTP 503 if the database is unreachable.
 *
 * @route GET /api/health
 * @returns {Object} System health status and metrics
 */
router.get('/', async (_req: Request, res: Response) => {
  // Both checks bounded (#970): a dependency that is connected but frozen
  // never rejects, and a health check that waits on it hangs exactly when the
  // load balancer most needs an answer. Run in parallel, so the endpoint
  // answers within one limit, not the sum of two. A check that rejects counts
  // as down, so nothing here throws.
  const [dbHealthy, redisReported] = await Promise.all([
    settleWithin(database.isHealthy(), HEALTH_CHECK_TIMEOUT_MS, false),
    // Redis is optional: report its state only when configured, so a
    // single-instance deployment without Redis is not flagged "degraded" for
    // a dependency it deliberately does not use.
    isRedisConfigured()
      ? settleWithin<RedisHealth>(getRedisHealth(), HEALTH_CHECK_TIMEOUT_MS, 'degraded')
      : Promise.resolve(null),
  ]);

  // Unauthenticated endpoint: expose only what a load balancer needs.
  // Environment name, uptime and process metrics are internal details
  // that would otherwise leak to anyone who can reach the API.
  const healthCheck = {
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: SERVICE_VERSION,
    services: {
      database: dbHealthy ? 'connected' : 'disconnected',
      ...(redisReported !== null ? { redis: redisReported } : {}),
    }
  };

  if (!dbHealthy) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database connection unavailable'
      },
      data: healthCheck
    });
  }

  res.json({
    success: true,
    data: healthCheck
  });
});

/**
 * Readiness Check Endpoint
 *
 * Verifies that the service and its dependencies are ready to accept traffic.
 * Used by Kubernetes readiness probes and load balancers.
 *
 * @route GET /api/health/ready
 * @returns {Object} Readiness status
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const isReady = await settleWithin(database.isHealthy(), HEALTH_CHECK_TIMEOUT_MS, false);

  if (isReady) {
    res.json({
      success: true,
      data: { status: 'ready' }
    });
  } else {
    res.status(503).json({
      success: false,
      error: {
        code: 'NOT_READY',
        message: 'Service not ready: database unavailable'
      }
    });
  }
});

export default router;
