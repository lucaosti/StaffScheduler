/**
 * Health Check Routes
 *
 * Provides system health monitoring and status endpoints.
 * Used for application monitoring and load balancer health checks.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { database } from '../config/database';

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
  try {
    const dbHealthy = await database.isHealthy();

    const healthCheck = {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: config.server.env,
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        },
        cpu: process.cpuUsage()
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
  } catch (error) {
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Health check failed'
      }
    });
  }
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
  const isReady = await database.isHealthy();

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
