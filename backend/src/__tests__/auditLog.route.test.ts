/**
 * Route-level tests for the audit log router.
 *
 * Focuses on the /export endpoint which must be registered before /:id
 * to prevent Express matching the literal string "export" as a numeric ID.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';

// Bypass all auth middleware so the router handles the request directly.
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: never, _res: never, next: () => void) => next(),
  requirePermission: () => (_req: never, _res: never, next: () => void) => next(),
  requireModuleForUser: () => (_req: never, _res: never, next: () => void) => next(),
}));

import { createAuditLogsRouter } from '../routes/auditLogs';

const makePool = (rows: unknown[] = []) => ({
  execute: jest.fn().mockResolvedValue([rows, null]),
} as unknown as Pool);

const buildApp = (pool: Pool) => {
  const app = express();
  app.use(express.json());
  app.use('/api/audit-logs', createAuditLogsRouter(pool));
  return app;
};

describe('GET /api/audit-logs/export — route ordering', () => {
  it('reaches the export handler and returns 200, not a 400 from /:id validation', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/export');
    // If the route ordering is wrong, Express matches /:id with id='export',
    // Zod rejects the non-numeric id, and the response is 400 VALIDATION_ERROR.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta).toBeDefined();
  });

  it('returns CSV when format=csv is requested', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('audit_log_export.csv');
  });

  it('returns 400 for unsupported format', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/export?format=xml');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when fromDate is not ISO format', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/export?fromDate=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/audit-logs/:id — still reachable', () => {
  it('returns 404 for a numeric id with no matching record', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a non-numeric id segment', async () => {
    const pool = makePool([]);
    const res = await request(buildApp(pool)).get('/api/audit-logs/not-a-number');
    expect(res.status).toBe(400);
  });
});
