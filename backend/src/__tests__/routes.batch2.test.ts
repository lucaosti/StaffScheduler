/**
 * Route coverage batch 2 — fills gaps not hit by existing route test files:
 *   routes/users.ts      — validateRoleAssignment (lines 29, 33),
 *                          GET / with pagination for admin (lines 51,55)
 *                          and manager (lines 64,68)
 *   routes/shifts.ts     — GET / pagination (lines 155,159),
 *                          GET /:id org-unit scope filter → 403 (lines 188-190)
 *   routes/assignments.ts — GET /department/:id catch → 500 (line 185),
 *                            PATCH /:id/confirm null existing → 404 (line 235),
 *                            PATCH /:id/decline null existing → 404 (line 275)
 *   routes/auditLogs.ts  — GET / service error → 500 (lines 58-59),
 *                          GET /:id service error → 500 (lines 72-73)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// ── Auth middleware stub ──────────────────────────────────────────────────────
// userHasPermission checks the actual permissions array so tests can control
// access by setting req.user.permissions per test group.
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
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user?.permissions?.includes(code)),
  invalidateAuthContext: jest.fn(),
}));

// ── Service mocks ─────────────────────────────────────────────────────────────
jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/ShiftService');
jest.mock('../services/AssignmentService');
jest.mock('../services/AuditLogService');

import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { ShiftService } from '../services/ShiftService';
import { AssignmentService } from '../services/AssignmentService';
import { AuditLogService } from '../services/AuditLogService';

import { createUsersRouter } from '../routes/users';
import { createShiftsRouter } from '../routes/shifts';
import { createAssignmentsRouter } from '../routes/assignments';
import { createAuditLogsRouter } from '../routes/auditLogs';

const fakePool = {} as never;

const mount = (prefix: string, router: express.Router) => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

// ─── routes/users.ts ─────────────────────────────────────────────────────────

describe('users route — validateRoleAssignment paths', () => {
  const authMock = require('../middleware/auth');
  const ORIGINAL = authMock.authenticate;

  // User has user.manage but NOT role.manage → validateRoleAssignment runs.
  beforeEach(() => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 1, email: 'a@x', isActive: true, permissions: ['user.manage'], allowedOrgUnitIds: null };
      next();
    };
  });
  afterAll(() => { authMock.authenticate = ORIGINAL; });

  it('POST / 403 when role is not found', async () => {
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValueOnce(null);
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).post('/api/users').send({
      email: 'new@test.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
      roleIds: [999],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toMatch(/Role 999 not found/);
  });

  it('POST / 403 when role grants permissions the actor does not hold', async () => {
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValueOnce({
      id: 1,
      name: 'superadmin',
      permissions: ['settings.manage', 'role.manage'],
    });
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).post('/api/users').send({
      email: 'new@test.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
      roleIds: [1],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cannot assign a role/i);
  });
});

describe('users route — GET / pagination branches', () => {
  const authMock = require('../middleware/auth');
  const ORIGINAL = authMock.authenticate;
  afterAll(() => { authMock.authenticate = ORIGINAL; });

  beforeEach(() => {
    (UserService.prototype.countUsers as jest.Mock).mockResolvedValue(5);
    (UserService.prototype.getAllUsers as jest.Mock).mockResolvedValue([]);
    (UserService.prototype.countUsersForManager as jest.Mock).mockResolvedValue(3);
    (UserService.prototype.getUsersForManager as jest.Mock).mockResolvedValue([]);
  });

  it('admin with pagination calls countUsers and returns paginated response', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 1, email: 'a@x', isActive: true, permissions: ['user.read_all'], allowedOrgUnitIds: null };
      next();
    };
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).get('/api/users?page=1&pageSize=10');
    expect(res.status).toBe(200);
    expect(UserService.prototype.countUsers).toHaveBeenCalled();
    expect(UserService.prototype.getAllUsers).toHaveBeenCalled();
  });

  it('admin without pagination returns flat list', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 1, email: 'a@x', isActive: true, permissions: ['user.read_all'], allowedOrgUnitIds: null };
      next();
    };
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(UserService.prototype.getAllUsers).toHaveBeenCalled();
  });

  it('manager with pagination calls countUsersForManager and returns paginated response', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 2, email: 'mgr@x', isActive: true, permissions: ['user.read'], allowedOrgUnitIds: null };
      next();
    };
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).get('/api/users?page=1&pageSize=10');
    expect(res.status).toBe(200);
    expect(UserService.prototype.countUsersForManager).toHaveBeenCalled();
    expect(UserService.prototype.getUsersForManager).toHaveBeenCalled();
  });

  it('manager without pagination calls getUsersForManager (no count)', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 2, email: 'mgr@x', isActive: true, permissions: ['user.read'], allowedOrgUnitIds: null };
      next();
    };
    const app = mount('/api/users', createUsersRouter(fakePool));
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(UserService.prototype.getUsersForManager).toHaveBeenCalled();
    expect(UserService.prototype.countUsersForManager).not.toHaveBeenCalled();
  });
});

// ─── routes/shifts.ts ─────────────────────────────────────────────────────────

describe('shifts route — pagination and org-unit scope filter', () => {
  const authMock = require('../middleware/auth');
  const ORIGINAL = authMock.authenticate;
  afterAll(() => { authMock.authenticate = ORIGINAL; });

  it('GET / with pagination calls countShifts and returns paginated response', async () => {
    (ShiftService.prototype.countShifts as jest.Mock).mockResolvedValueOnce(0);
    (ShiftService.prototype.getAllShifts as jest.Mock).mockResolvedValueOnce([]);
    const app = mount('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts?page=1&pageSize=10');
    expect(res.status).toBe(200);
    expect(ShiftService.prototype.countShifts).toHaveBeenCalled();
    expect(ShiftService.prototype.getAllShifts).toHaveBeenCalled();
  });

  it('GET /:id returns 403 when shift org-unit is outside caller scope', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 1, email: 'a@x', isActive: true, permissions: require('./helpers/permissions').ALL_PERMISSIONS, allowedOrgUnitIds: [99] };
      next();
    };
    // Shift belongs to org_unit 1, which is not in scope [99].
    (ShiftService.prototype.getShiftById as jest.Mock).mockResolvedValueOnce({
      id: 1,
      scheduleId: 1,
      departmentOrgUnitId: 1,
    });
    const app = mount('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts/1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /:id returns 403 when shift orgUnitId is null and caller has restricted scope', async () => {
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = { id: 1, email: 'a@x', isActive: true, permissions: require('./helpers/permissions').ALL_PERMISSIONS, allowedOrgUnitIds: [5] };
      next();
    };
    (ShiftService.prototype.getShiftById as jest.Mock).mockResolvedValueOnce({
      id: 2,
      scheduleId: 1,
      departmentOrgUnitId: null,
      orgUnitId: null,
    });
    const app = mount('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts/2');
    expect(res.status).toBe(403);
  });
});

// ─── routes/assignments.ts ────────────────────────────────────────────────────

describe('assignments route — dept error, confirm null, decline null', () => {
  const app = () => mount('/api/assignments', createAssignmentsRouter(fakePool));

  it('GET /department/:id 500 when service throws', async () => {
    (AssignmentService.prototype.getAssignmentsByDepartment as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/assignments/department/3');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('PATCH /:id/confirm 404 when getAssignmentById returns null', async () => {
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValueOnce(null);
    const res = await request(app()).patch('/api/assignments/1/confirm');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /:id/decline 404 when getAssignmentById returns null', async () => {
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValueOnce(null);
    const res = await request(app()).patch('/api/assignments/1/decline');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── routes/auditLogs.ts ──────────────────────────────────────────────────────

describe('auditLogs route — service error handlers', () => {
  const app = () => mount('/api/audit-logs', createAuditLogsRouter(fakePool));

  it('GET / 500 when service.list throws', async () => {
    (AuditLogService.prototype.list as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/audit-logs');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('GET /:id 500 when service.getById throws', async () => {
    (AuditLogService.prototype.getById as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/audit-logs/1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
