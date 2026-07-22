/**
 * GET /metrics route tests — the Prometheus scrape endpoint and its bearer guard.
 */

import express from 'express';
import request from 'supertest';
import { config } from '../config';
import { createMetricsRouter } from '../routes/metrics';

const app = () => {
  const a = express();
  a.use('/metrics', createMetricsRouter());
  return a;
};

const originalToken = config.metrics.token;
afterEach(() => {
  config.metrics.token = originalToken;
});

describe('GET /metrics', () => {
  it('is open and returns Prometheus text when no token is configured', async () => {
    config.metrics.token = '';
    const res = await request(app()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
  });

  it('rejects a scrape without the configured bearer token', async () => {
    config.metrics.token = 'secret-token';
    const res = await request(app()).get('/metrics');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong bearer token', async () => {
    config.metrics.token = 'secret-token';
    const res = await request(app()).get('/metrics').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token', async () => {
    config.metrics.token = 'secret-token';
    const res = await request(app()).get('/metrics').set('Authorization', 'Bearer secret-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });
});
