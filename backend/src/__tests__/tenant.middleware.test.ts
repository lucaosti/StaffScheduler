/**
 * Tenant resolver middleware tests (F13).
 */

import express from 'express';
import request from 'supertest';
import { DEFAULT_TENANT_ID, resolveTenant } from '../middleware/tenant';

const buildApp = (executeImpl: jest.Mock): express.Express => {
  const app = express();
  const fakePool = { execute: executeImpl } as never;
  app.use(resolveTenant(fakePool));
  app.get('/probe', (req, res) => res.json({ tenantId: req.tenantId ?? null }));
  return app;
};

describe('resolveTenant', () => {
  it('falls back to the default tenant when no header is sent', async () => {
    const execute = jest.fn();
    const res = await request(buildApp(execute)).get('/probe');
    expect(res.body.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects non-numeric headers with 400', async () => {
    const execute = jest.fn();
    const res = await request(buildApp(execute)).get('/probe').set('X-Tenant-Id', 'not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TENANT');
  });

  it('returns 404 when the tenant does not exist or is inactive', async () => {
    const execute = jest.fn().mockResolvedValueOnce([[], null]);
    const res = await request(buildApp(execute)).get('/probe').set('X-Tenant-Id', '999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('attaches req.tenantId on a valid header', async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ id: 7 }], null]);
    const res = await request(buildApp(execute)).get('/probe').set('X-Tenant-Id', '7');
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(7);
  });
});
