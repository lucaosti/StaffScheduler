/**
 * Tests for `routes/health.ts` (default export, no factory).
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

const isHealthy = jest.fn();
jest.mock('../config/database', () => ({
  database: { isHealthy: () => isHealthy() },
}));

// Redis is on by default; mock the module so these tests control whether it is
// reported and whether it is reachable, without opening a socket.
const isRedisConfigured = jest.fn();
const isRedisHealthy = jest.fn();
jest.mock('../config/redis', () => ({
  isRedisConfigured: () => isRedisConfigured(),
  isRedisHealthy: () => isRedisHealthy(),
}));

import healthRoutes from '../routes/health';

const mountApp = (): express.Express => {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
};

beforeEach(() => {
  isHealthy.mockReset();
  // Default: Redis not configured, so the base tests see only the database.
  isRedisConfigured.mockReturnValue(false);
  isRedisHealthy.mockReset();
});

describe('GET /api/health', () => {
  it('200 when DB is healthy', async () => {
    isHealthy.mockResolvedValueOnce(true);
    const res = await request(mountApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.services.database).toBe('connected');
  });

  it('omits redis from services when Redis is not configured', async () => {
    isHealthy.mockResolvedValueOnce(true);
    const res = await request(mountApp()).get('/api/health');
    expect(res.body.data.services).not.toHaveProperty('redis');
  });

  it('reports redis connected when configured and reachable', async () => {
    isHealthy.mockResolvedValueOnce(true);
    isRedisConfigured.mockReturnValue(true);
    isRedisHealthy.mockResolvedValueOnce(true);
    const res = await request(mountApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.services.redis).toBe('connected');
  });

  it('reports redis disconnected when configured but unreachable (DB still healthy → 200)', async () => {
    isHealthy.mockResolvedValueOnce(true);
    isRedisConfigured.mockReturnValue(true);
    isRedisHealthy.mockResolvedValueOnce(false);
    const res = await request(mountApp()).get('/api/health');
    // Redis is a soft dependency: its outage does not fail the health check.
    expect(res.status).toBe(200);
    expect(res.body.data.services.redis).toBe('disconnected');
  });

  it('503 when DB is unhealthy', async () => {
    isHealthy.mockResolvedValueOnce(false);
    const res = await request(mountApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('503 on unexpected error', async () => {
    isHealthy.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/health');
    expect(res.status).toBe(503);
  });
});

describe('GET /api/health/ready', () => {
  it('200 when DB is healthy', async () => {
    isHealthy.mockResolvedValueOnce(true);
    const res = await request(mountApp()).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
  });

  it('503 when DB is not ready', async () => {
    isHealthy.mockResolvedValueOnce(false);
    const res = await request(mountApp()).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_READY');
  });
});
