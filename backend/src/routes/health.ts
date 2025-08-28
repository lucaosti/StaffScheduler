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

const router = Router();

/**
 * Health Check Endpoint
 * 
 * Returns system health status and performance metrics.
 * Used by monitoring systems and load balancers.
 * 
 * @route GET /api/health
 * @returns {Object} System health status and metrics
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: config.server.env,
      services: {
        database: 'connected', // TODO: Add actual database ping
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        },
        cpu: process.cpuUsage()
      }
    };

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

// Readiness check (for Kubernetes)
router.get('/ready', async (req: Request, res: Response) => {
  // TODO: Add actual database connectivity check
  const isReady = true;
  
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
        message: 'Service not ready'
      }
    });
  }
});

export default router;
