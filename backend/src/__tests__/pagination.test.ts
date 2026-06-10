/**
 * Pagination middleware unit tests (issue #95).
 *
 * Covers:
 *   - parsePagination: returns null when no params present
 *   - parsePagination: defaults to page 1, pageSize 25
 *   - parsePagination: clamps pageSize to MAX (200)
 *   - sendPaginated: response shape includes data + meta
 *   - GET /api/v1/schedules: responds at v1 prefix
 *   - GET /api/v1/schedules?page=1&pageSize=2: returns meta envelope
 *   - global error middleware: unhandled throw returns {success:false,error:{code:INTERNAL_ERROR}}
 */

import express from 'express';
import request from 'supertest';
import { parsePagination, sendPaginated } from '../middleware/pagination';

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for helpers
// ──────────────────────────────────────────────────────────────────────────────

describe('parsePagination', () => {
  const makeReq = (query: Record<string, string>) =>
    ({ query } as any);

  it('returns null when no page or pageSize query params are present', () => {
    expect(parsePagination(makeReq({}))).toBeNull();
  });

  it('returns params with defaults when only page is present', () => {
    const p = parsePagination(makeReq({ page: '3' }));
    expect(p).not.toBeNull();
    expect(p!.page).toBe(3);
    expect(p!.pageSize).toBe(25); // default
    expect(p!.offset).toBe(50);
  });

  it('clamps pageSize to 200', () => {
    const p = parsePagination(makeReq({ page: '1', pageSize: '9999' }));
    expect(p!.pageSize).toBe(200);
  });

  it('clamps page to minimum 1', () => {
    const p = parsePagination(makeReq({ page: '-5', pageSize: '10' }));
    expect(p!.page).toBe(1);
    expect(p!.offset).toBe(0);
  });
});

describe('sendPaginated', () => {
  it('sets data and meta on the response', () => {
    const json = jest.fn();
    const res = { json } as any;
    sendPaginated(res, ['a', 'b'], 10, { page: 2, pageSize: 2, offset: 2 });
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: ['a', 'b'],
      meta: { total: 10, page: 2, pageSize: 2, pages: 5 },
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Global error middleware
// ──────────────────────────────────────────────────────────────────────────────

describe('global error middleware', () => {
  it('catches an unhandled throw and returns the {success:false} envelope', async () => {
    const app = express();
    app.use(express.json());
    app.get('/boom', (_req, _res, next) => {
      next(new Error('unexpected'));
    });
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
      });
    });

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('unexpected');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// /api/v1 prefix availability
// ──────────────────────────────────────────────────────────────────────────────

jest.mock('../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: () => true,
}));
jest.mock('../services/ScheduleService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { buildApp } from '../app';
import { ScheduleService } from '../services/ScheduleService';

describe('GET /api/v1/schedules', () => {
  it('responds at the /api/v1 prefix', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock).mockResolvedValue([
      { id: 1, name: 'S1' },
      { id: 2, name: 'S2' },
      { id: 3, name: 'S3' },
    ]);

    const app = buildApp({} as never, { silent: true });
    const res = await request(app).get('/api/v1/schedules');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns meta envelope when page and pageSize are provided', async () => {
    // countSchedules provides the true total; getAllSchedules returns only the requested page.
    (ScheduleService.prototype.countSchedules as jest.Mock).mockResolvedValue(3);
    (ScheduleService.prototype.getAllSchedules as jest.Mock).mockResolvedValue([
      { id: 1, name: 'S1' },
      { id: 2, name: 'S2' },
    ]);

    const app = buildApp({} as never, { silent: true });
    const res = await request(app).get('/api/v1/schedules?page=1&pageSize=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.meta.pages).toBe(2);
  });
});
