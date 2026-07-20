/**
 * Route coverage batch 4 — fills gaps not hit by existing route test files:
 *   routes/calendar.ts     — GET /feed.ics resolveToken null → 401 (lines 77-78)
 *   routes/shiftSwap.ts    — POST / service.create throws → 400 (lines 33-34)
 *   routes/skillGap.ts     — GET / service.analyze throws → 500 (lines 36-37)
 *   routes/directory.ts    — GET /users/:id profile null → 404 (line 41);
 *                            PUT /users/:id/fields throws → 400 (line 103)
 *   routes/departments.ts  — POST /:id/users department.manage but canManage=false → 403 (line 219);
 *                            DELETE /:id/users/:userId same → 403 (line 273)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      id: 1,
      email: 'a@x',
      isActive: true,
      permissions: require('./helpers/permissions').ALL_PERMISSIONS,
      allowedOrgUnitIds: null,
    };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user?.permissions?.includes(code)),
}));

jest.mock('../services/CalendarService');
jest.mock('../services/ShiftSwapService');
jest.mock('../services/SkillGapService');
jest.mock('../services/UserDirectoryService');
jest.mock('../services/DepartmentService');
jest.mock('../services/UserService');

import { CalendarService } from '../services/CalendarService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { SkillGapService } from '../services/SkillGapService';
import { UserDirectoryService } from '../services/UserDirectoryService';
import { DepartmentService } from '../services/DepartmentService';

import { createCalendarRouter } from '../routes/calendar';
import { createShiftSwapRouter } from '../routes/shiftSwap';
import { createSkillGapRouter } from '../routes/skillGap';
import { createDirectoryRouter } from '../routes/directory';
import { createDepartmentsRouter } from '../routes/departments';
import { NotFoundError, ValidationError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mount = (prefix: string, router: express.Router) => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  app.use(errorHandler);
  return app;
};

// ─── routes/calendar.ts ──────────────────────────────────────────────────────

describe('calendar route — resolveToken null', () => {
  it('GET /feed.ics returns 401 when token resolves to null', async () => {
    (CalendarService.prototype.resolveToken as jest.Mock).mockResolvedValueOnce(null);
    const app = mount('/api/calendar', createCalendarRouter(fakePool));
    const res = await request(app).get('/api/calendar/feed.ics?token=badtoken');
    expect(res.status).toBe(401);
    expect(res.text).toMatch(/invalid token/);
  });
});

// ─── routes/shiftSwap.ts ─────────────────────────────────────────────────────

describe('shiftSwap route — create catch', () => {
  it('POST / returns 404 NOT_FOUND when service.create rejects with a missing entity', async () => {
    (ShiftSwapService.prototype.create as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Assignment not found')
    );
    const app = mount('/api/shift-swaps', createShiftSwapRouter(fakePool));
    const res = await request(app)
      .post('/api/shift-swaps')
      .send({ requesterAssignmentId: 1, targetAssignmentId: 2 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/Assignment not found/);
  });
});

// ─── routes/skillGap.ts ──────────────────────────────────────────────────────

describe('skillGap route — analyze catch', () => {
  it('GET / returns 500 INTERNAL_ERROR when service.analyze throws', async () => {
    (SkillGapService.prototype.analyze as jest.Mock).mockRejectedValueOnce(new Error('db error'));
    const app = mount('/api/skill-gap', createSkillGapRouter(fakePool));
    const res = await request(app)
      .get('/api/skill-gap')
      .query({ departmentId: '3', start: '2026-05-01', end: '2026-05-31' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── routes/directory.ts ─────────────────────────────────────────────────────

describe('directory route — GET /users/:id null profile', () => {
  it('returns 404 NOT_FOUND when getProfile returns null', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock).mockResolvedValueOnce(null);
    const app = mount('/api/directory', createDirectoryRouter(fakePool));
    const res = await request(app).get('/api/directory/users/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('directory route — PUT /users/:id/fields catch', () => {
  it('returns 400 VALIDATION_ERROR when setFields throws', async () => {
    (UserDirectoryService.prototype.setFields as jest.Mock).mockRejectedValueOnce(
      new ValidationError("Invalid field key 'bad key!'")
    );
    const app = mount('/api/directory', createDirectoryRouter(fakePool));
    const res = await request(app)
      .put('/api/directory/users/1/fields')
      .send({ fields: [{ key: 'bad key!', value: 'v' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── routes/departments.ts ────────────────────────────────────────────────────

describe('departments route — POST /:id/users department.manage canManage=false', () => {
  const authMock = require('../middleware/auth');
  const ORIGINAL = authMock.authenticate;
  afterAll(() => { authMock.authenticate = ORIGINAL; });

  it('returns 403 when user has department.manage but is not manager of that dept', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = {
        id: 10,
        email: 'mgr@x',
        isActive: true,
        permissions: ['department.manage'],
        allowedOrgUnitIds: null,
      };
      next();
    };
    // getDepartmentsForUser returns dept with different managerId → canManage = false
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock).mockResolvedValueOnce([
      { id: 1, managerId: 99 }, // managerId 99 ≠ user.id 10
    ]);
    const app = mount('/api/departments', createDepartmentsRouter(fakePool));
    const res = await request(app)
      .post('/api/departments/1/users')
      .send({ userId: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('departments route — DELETE /:id/users/:userId department.manage canManage=false', () => {
  const authMock = require('../middleware/auth');
  const ORIGINAL = authMock.authenticate;
  afterAll(() => { authMock.authenticate = ORIGINAL; });

  it('returns 403 when user has department.manage but is not manager of that dept', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = {
        id: 10,
        email: 'mgr@x',
        isActive: true,
        permissions: ['department.manage'],
        allowedOrgUnitIds: null,
      };
      next();
    };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock).mockResolvedValueOnce([
      { id: 1, managerId: 99 },
    ]);
    const app = mount('/api/departments', createDepartmentsRouter(fakePool));
    const res = await request(app).delete('/api/departments/1/users/5');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
