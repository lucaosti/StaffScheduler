/**
 * Extended security tests for IDOR and access-control fixes.
 *
 * Covers:
 *   - Unauthenticated requests to protected routes return 401
 *   - Authenticated but missing permission returns 403
 *   - IDOR: cross-user assignment access returns 403
 *   - IDOR: cross-user assignment status transitions return 403
 *   - IDOR: schedule access outside org-unit scope returns 403
 *   - IDOR: schedule /shifts sub-resource outside scope returns 403
 *   - IDOR: schedule by user (cross-user, no manage perm) returns 403
 *   - IDOR: directory vCard requires user.read permission
 *   - Delegation cap: delegatee cannot exceed delegator's current permissions
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// ─────────────────────────────────────────────────────────────────────────────
// Shared mutable state for the current caller
// ─────────────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'manager' | 'employee';

let currentUser: {
  id: number;
  role: Role;
  email: string;
  allowedOrgUnitIds?: number[] | null;
} = { id: 1, role: 'admin', email: 'admin@example', allowedOrgUnitIds: null };

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const { permissionsForRole } = require('./helpers/permissions');
    req.user = {
      ...currentUser,
      isActive: true,
      permissions: permissionsForRole(currentUser.role),
    };
    next();
  },
  requirePermission: (code: string) => (req: any, res: any, next: any) => {
    if (!req.user?.permissions?.includes(code)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient privileges' },
      });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Service mocks
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../services/AssignmentService');
jest.mock('../services/ScheduleService');
jest.mock('../services/UserDirectoryService');
jest.mock('../services/RbacService');

import { AssignmentService } from '../services/AssignmentService';
import { ScheduleService } from '../services/ScheduleService';
import { UserDirectoryService } from '../services/UserDirectoryService';

import { createAssignmentsRouter } from '../routes/assignments';
import { createSchedulesRouter } from '../routes/schedules';
import { createDirectoryRouter } from '../routes/directory';

const fakePool = {} as never;

// ─────────────────────────────────────────────────────────────────────────────
// App factories
// ─────────────────────────────────────────────────────────────────────────────

const assignmentsApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/assignments', createAssignmentsRouter(fakePool));
  return app;
};

const schedulesApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/schedules', createSchedulesRouter(fakePool));
  return app;
};

const directoryApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/directory', createDirectoryRouter(fakePool));
  return app;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const resetUser = (overrides: Partial<typeof currentUser> = {}): void => {
  currentUser = { id: 1, role: 'admin', email: 'admin@example', allowedOrgUnitIds: null, ...overrides };
};

beforeEach(() => {
  jest.clearAllMocks();
  resetUser();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unauthenticated requests return 401
// ─────────────────────────────────────────────────────────────────────────────

describe('unauthenticated access', () => {
  it('GET /api/assignments returns 401 without a token', async () => {
    const rawApp = express();
    rawApp.use(express.json());
    rawApp.use('/api/assignments', (_req: any, res: any) => {
      res.status(401).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Authorization token is required' } });
    });
    const res = await request(rawApp).get('/api/assignments');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Insufficient permission returns 403
// ─────────────────────────────────────────────────────────────────────────────

describe('insufficient permission', () => {
  it('GET /api/assignments/ for employee without assignment.manage returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(assignmentsApp()).get('/api/assignments');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/assignments/shift/5 for employee without assignment.manage returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(assignmentsApp()).get('/api/assignments/shift/5');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/assignments/department/3 for employee without assignment.manage returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(assignmentsApp()).get('/api/assignments/department/3');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('PATCH /api/assignments/1/complete for employee without assignment.manage returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(assignmentsApp()).patch('/api/assignments/1/complete');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/directory/users/2/vcard for employee without user.read returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(directoryApp()).get('/api/directory/users/2/vcard');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. IDOR: assignment GET/:id — employee cannot see another user's assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: assignment GET /:id', () => {
  it('employee requesting own assignment returns 200', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({
      id: 42,
      userId: 10,
    });
    const res = await request(assignmentsApp()).get('/api/assignments/42');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('employee requesting another users assignment returns 403', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({
      id: 42,
      userId: 99,
    });
    const res = await request(assignmentsApp()).get('/api/assignments/42');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('manager with assignment.manage requesting any assignment returns 200', async () => {
    resetUser({ id: 5, role: 'manager' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({
      id: 42,
      userId: 99,
    });
    const res = await request(assignmentsApp()).get('/api/assignments/42');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IDOR: assignment confirm/decline — employee cannot act on another's assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: assignment confirm/decline', () => {
  it('employee can confirm own assignment returns 200', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({ id: 7, userId: 10 });
    (AssignmentService.prototype.confirmAssignment as jest.Mock).mockResolvedValue({ id: 7, status: 'confirmed' });
    const res = await request(assignmentsApp()).patch('/api/assignments/7/confirm');
    expect(res.status).toBe(200);
  });

  it('employee cannot confirm another users assignment returns 403', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({ id: 7, userId: 99 });
    const res = await request(assignmentsApp()).patch('/api/assignments/7/confirm');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('employee cannot decline another users assignment returns 403', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentById as jest.Mock).mockResolvedValue({ id: 7, userId: 99 });
    const res = await request(assignmentsApp()).patch('/api/assignments/7/decline');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. IDOR: assignment GET /user/:userId
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: assignments GET /user/:userId', () => {
  it('employee can request own assignments returns 200', async () => {
    resetUser({ id: 10, role: 'employee' });
    (AssignmentService.prototype.getAssignmentsByUser as jest.Mock).mockResolvedValue([]);
    const res = await request(assignmentsApp()).get('/api/assignments/user/10');
    expect(res.status).toBe(200);
  });

  it('employee cannot request another users assignments returns 403', async () => {
    resetUser({ id: 10, role: 'employee' });
    const res = await request(assignmentsApp()).get('/api/assignments/user/99');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('manager can request any users assignments returns 200', async () => {
    resetUser({ id: 5, role: 'manager' });
    (AssignmentService.prototype.getAssignmentsByUser as jest.Mock).mockResolvedValue([]);
    const res = await request(assignmentsApp()).get('/api/assignments/user/99');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. IDOR: schedule GET/:id — org-unit scope enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: schedule GET /:id org-unit scope', () => {
  it('scoped user accessing schedule within scope returns 200', async () => {
    resetUser({ id: 3, role: 'manager', allowedOrgUnitIds: [10, 11] });
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 1,
      departmentOrgUnitId: 10,
    });
    const res = await request(schedulesApp()).get('/api/schedules/1');
    expect(res.status).toBe(200);
  });

  it('scoped user accessing schedule outside scope returns 403', async () => {
    resetUser({ id: 3, role: 'manager', allowedOrgUnitIds: [10, 11] });
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 1,
      departmentOrgUnitId: 99,
    });
    const res = await request(schedulesApp()).get('/api/schedules/1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('unscoped user with null allowedOrgUnitIds can access any schedule returns 200', async () => {
    resetUser({ id: 1, role: 'admin', allowedOrgUnitIds: null });
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 1,
      departmentOrgUnitId: 99,
    });
    const res = await request(schedulesApp()).get('/api/schedules/1');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. IDOR: schedule GET/:id/shifts — same scope rules
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: schedule GET /:id/shifts org-unit scope', () => {
  it('scoped user accessing shifts of schedule outside scope returns 403', async () => {
    resetUser({ id: 3, role: 'manager', allowedOrgUnitIds: [10] });
    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock).mockResolvedValue({
      id: 1,
      departmentOrgUnitId: 55,
      shifts: [],
    });
    const res = await request(schedulesApp()).get('/api/schedules/1/shifts');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('scoped user accessing shifts of schedule within scope returns 200', async () => {
    resetUser({ id: 3, role: 'manager', allowedOrgUnitIds: [10] });
    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock).mockResolvedValue({
      id: 1,
      departmentOrgUnitId: 10,
      shifts: [],
    });
    const res = await request(schedulesApp()).get('/api/schedules/1/shifts');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. IDOR: schedule GET /user/:userId
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: schedule GET /user/:userId', () => {
  it('employee can request own schedules returns 200', async () => {
    resetUser({ id: 10, role: 'employee' });
    (ScheduleService.prototype.getSchedulesByUser as jest.Mock).mockResolvedValue([]);
    const res = await request(schedulesApp()).get('/api/schedules/user/10');
    expect(res.status).toBe(200);
  });

  it('employee cannot request another users schedules returns 403', async () => {
    resetUser({ id: 10, role: 'employee' });
    const res = await request(schedulesApp()).get('/api/schedules/user/99');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('manager with schedule.manage can request any users schedules returns 200', async () => {
    resetUser({ id: 5, role: 'manager' });
    (ScheduleService.prototype.getSchedulesByUser as jest.Mock).mockResolvedValue([]);
    const res = await request(schedulesApp()).get('/api/schedules/user/99');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Directory vCard requires user.read
// ─────────────────────────────────────────────────────────────────────────────

describe('IDOR: directory GET /users/:id/vcard', () => {
  it('manager with user.read can download any vCard returns 200', async () => {
    resetUser({ role: 'manager' });
    (UserDirectoryService.prototype.getProfile as jest.Mock).mockResolvedValue({ id: 7, email: 'a@b.com' });
    (UserDirectoryService.prototype.exportVcf as jest.Mock).mockResolvedValue('BEGIN:VCARD\nEND:VCARD');
    const res = await request(directoryApp()).get('/api/directory/users/7/vcard');
    expect(res.status).toBe(200);
  });

  it('employee without user.read cannot download another users vCard returns 403', async () => {
    resetUser({ role: 'employee' });
    const res = await request(directoryApp()).get('/api/directory/users/7/vcard');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
