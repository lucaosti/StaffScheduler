/**
 * Integration test for the /api/system/info route.
 *
 * Mounts the router on a tiny Express app and exercises both the demo and
 * production paths plus the failure fallback.
 */

import express from 'express';
import request from 'supertest';
import { createSystemRouter } from '../routes/system';

type ExecuteResult = [unknown[], unknown];

const buildApp = (executeImpl: jest.Mock): express.Express => {
  const fakePool = { execute: executeImpl } as unknown as Parameters<typeof createSystemRouter>[0];
  const app = express();
  app.use('/api/system', createSystemRouter(fakePool));
  return app;
};

describe('GET /api/system/info', () => {
  it('reports mode=demo when system_settings has the demo row', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockResolvedValueOnce([[{ value: 'demo' }], null]);
    const app = buildApp(execute);

    const res = await request(app).get('/api/system/info');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'demo' } });
  });

  it('defaults to mode=production when no row is present', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockResolvedValueOnce([[], null]);
    const app = buildApp(execute);

    const res = await request(app).get('/api/system/info');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'production' } });
  });

  it('falls back to production when the database query fails', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockRejectedValueOnce(new Error('DB down'));
    const app = buildApp(execute);

    const res = await request(app).get('/api/system/info');

    // The endpoint must never 500 — it's polled at app boot.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'production' } });
  });
});
