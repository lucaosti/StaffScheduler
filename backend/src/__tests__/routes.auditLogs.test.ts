/**
 * Audit log route tests — pagination branches (routes/auditLogs.ts).
 *
 * Covers:
 *   - GET without page/pageSize: response has no `meta` key (legacy mode).
 *   - GET with ?page=1&pageSize=10: response includes structured `meta` block.
 *
 * Auth and module middleware are stubbed so the tests exercise only the
 * pagination-branching logic in the route handler.
 *
 * @author Luca Ostinelli
 */

import express, { Request, Response } from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: () => void) => {
    (req as any).user = {
      id: 1,
      role: 'admin',
      isActive: true,
      permissions: ['audit.read'],
    };
    next();
  },
  requirePermission: (_code: string) => (_req: Request, _res: Response, next: () => void) =>
    next(),
  requireModule: (_code: string) => (_req: Request, _res: Response, next: () => void) =>
    next(),
  requireModuleForUser: (_code: string) => (_req: Request, _res: Response, next: () => void) =>
    next(),
}));

jest.mock('../services/AuditLogService');

import { AuditLogService } from '../services/AuditLogService';
import { createAuditLogsRouter } from '../routes/auditLogs';

const fakePool = {} as never;

const mountApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/audit-logs', createAuditLogsRouter(fakePool));
  return app;
};

const fakeItems = [
  {
    id: 1,
    userId: 5,
    action: 'user.create',
    entityType: 'user',
    entityId: 10,
    description: 'test',
    beforeSnapshot: null,
    afterSnapshot: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

describe('GET /api/audit-logs — without page/pageSize', () => {
  it('returns { success, data } without a meta key', async () => {
    (AuditLogService.prototype.list as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ total: 1, items: fakeItems });

    const res = await request(mountApp()).get('/api/audit-logs');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Legacy mode: the entire page object is returned as data, no meta block.
    expect(res.body.data).toEqual({ total: 1, items: fakeItems });
    expect(res.body).not.toHaveProperty('meta');
  });
});

describe('GET /api/audit-logs — with ?page=1&pageSize=10', () => {
  it('returns { success, data: items[], meta: { page, pageSize, total, pages } }', async () => {
    (AuditLogService.prototype.list as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ total: 1, items: fakeItems });

    const res = await request(mountApp()).get('/api/audit-logs?page=1&pageSize=10');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(fakeItems);
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      pages: 1,
    });
  });
});
