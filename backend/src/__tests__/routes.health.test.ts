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

import healthRoutes from '../routes/health';

const mountApp = (): express.Express => {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
};

beforeEach(() => {
  isHealthy.mockReset();
});

describe('GET /api/health', () => {
  it('200 when DB is healthy', async () => {
    isHealthy.mockResolvedValueOnce(true);
    const res = await request(mountApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.services.database).toBe('connected');
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
