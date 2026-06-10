/**
 * Route handler tests for `routes/rbac.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * RbacService is fully mocked. Auth rejection is simulated by controlling
 * `authState.mode` (pass | reject401 | reject403).
 *
 * `createRbacRouter` returns `{ roles, permissions }` — both sub-routers are
 * mounted into a single Express app for testing.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

const authState = { mode: 'pass' as 'pass' | 'reject401' | 'reject403' };

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (authState.mode === 'reject401') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    req.user = { id: 1, role: 'admin', isActive: true, permissions: ['role.manage'] };
    next();
  },
  requirePermission: () => (_req: any, res: any, next: any) => {
    if (authState.mode === 'reject403') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Missing permission' } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/RbacService');

import { RbacService } from '../services/RbacService';
import { createRbacRouter } from '../routes/rbac';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  const { roles, permissions } = createRbacRouter(fakePool);
  app.use('/api/permissions', permissions);
  app.use('/api/roles', roles);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  authState.mode = 'pass';
});

// ── GET /permissions ──────────────────────────────────────────────────────────

describe('rbac GET /permissions', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/permissions');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when permission missing', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).get('/api/permissions');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with permission list', async () => {
    (RbacService.prototype.listPermissions as jest.Mock) = jest
      .fn()
      .mockResolvedValue([
        { id: 1, code: 'role.manage', description: 'Manage roles' },
        { id: 2, code: 'schedule.manage', description: 'Manage schedules' },
      ]);

    const res = await request(mountApp()).get('/api/permissions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 500 on service error', async () => {
    (RbacService.prototype.listPermissions as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/permissions');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /roles ────────────────────────────────────────────────────────────────

describe('rbac GET /roles', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/roles');
    expect(res.status).toBe(401);
  });

  it('returns 403 when permission missing', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).get('/api/roles');
    expect(res.status).toBe(403);
  });

  it('returns 200 with role list', async () => {
    (RbacService.prototype.listRoles as jest.Mock) = jest
      .fn()
      .mockResolvedValue([
        { id: 1, name: 'Administrator', isSystem: true, permissions: [] },
        { id: 2, name: 'Manager', isSystem: false, permissions: [] },
      ]);

    const res = await request(mountApp()).get('/api/roles');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 200 with empty list', async () => {
    (RbacService.prototype.listRoles as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/roles');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 on service error', async () => {
    (RbacService.prototype.listRoles as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/roles');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST /roles ───────────────────────────────────────────────────────────────

describe('rbac POST /roles', () => {
  it('returns 201 on successful creation', async () => {
    (RbacService.prototype.createRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 10, name: 'Scheduler', isSystem: false, permissions: [] });

    const res = await request(mountApp())
      .post('/api/roles')
      .send({ name: 'Scheduler', description: 'Schedule manager', permissionCodes: ['schedule.manage'] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
  });

  it('returns 409 on duplicate role name', async () => {
    (RbacService.prototype.createRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Role already exists'));

    const res = await request(mountApp())
      .post('/api/roles')
      .send({ name: 'Administrator' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 on validation error', async () => {
    (RbacService.prototype.createRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('name is required'));

    const res = await request(mountApp())
      .post('/api/roles')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── GET /roles/:id ────────────────────────────────────────────────────────────

describe('rbac GET /roles/:id', () => {
  it('returns 200 when role found', async () => {
    (RbacService.prototype.getRoleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, name: 'Administrator', isSystem: true, permissions: [] });

    const res = await request(mountApp()).get('/api/roles/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 when role not found', async () => {
    (RbacService.prototype.getRoleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/roles/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on service error', async () => {
    (RbacService.prototype.getRoleById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/roles/1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PUT /roles/:id ────────────────────────────────────────────────────────────

describe('rbac PUT /roles/:id', () => {
  it('returns 200 on successful update', async () => {
    (RbacService.prototype.updateRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 2, name: 'Updated Role', isSystem: false, permissions: [] });

    const res = await request(mountApp())
      .put('/api/roles/2')
      .send({ name: 'Updated Role', permissionCodes: ['schedule.read'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Role');
  });

  it('returns 404 when role not found', async () => {
    (RbacService.prototype.updateRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Role not found'));

    const res = await request(mountApp())
      .put('/api/roles/99')
      .send({ name: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 on validation error', async () => {
    (RbacService.prototype.updateRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('invalid permission code'));

    const res = await request(mountApp())
      .put('/api/roles/2')
      .send({ permissionCodes: ['nonexistent'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /roles/:id ─────────────────────────────────────────────────────────

describe('rbac DELETE /roles/:id', () => {
  it('returns 200 on successful delete', async () => {
    (RbacService.prototype.deleteRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/roles/5');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 when trying to delete a system role', async () => {
    (RbacService.prototype.deleteRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Role cannot be deleted because it is a system role'));

    const res = await request(mountApp()).delete('/api/roles/1');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 404 when role not found', async () => {
    (RbacService.prototype.deleteRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Role not found'));

    const res = await request(mountApp()).delete('/api/roles/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── POST /roles/users/:userId (assign role) ───────────────────────────────────

describe('rbac POST /roles/users/:userId', () => {
  it('returns 201 on successful role assignment', async () => {
    (RbacService.prototype.assignRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp())
      .post('/api/roles/users/7')
      .send({ roleId: 2 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(RbacService.prototype.assignRole).toHaveBeenCalledWith(7, 2, null, null, 1);
  });

  it('returns 201 with optional scope and expiry', async () => {
    (RbacService.prototype.assignRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp())
      .post('/api/roles/users/7')
      .send({ roleId: 3, scopeOrgUnitId: 5, expiresAt: '2027-01-01T00:00:00Z' });

    expect(res.status).toBe(201);
    expect(RbacService.prototype.assignRole).toHaveBeenCalledWith(7, 3, 5, '2027-01-01T00:00:00Z', 1);
  });

  it('returns 400 when roleId is missing', async () => {
    const res = await request(mountApp())
      .post('/api/roles/users/7')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on service error', async () => {
    (RbacService.prototype.assignRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('User not found'));

    const res = await request(mountApp())
      .post('/api/roles/users/99')
      .send({ roleId: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /roles/users/:userId/:roleId (remove role) ────────────────────────

describe('rbac DELETE /roles/users/:userId/:roleId', () => {
  it('returns 200 on successful role removal', async () => {
    (RbacService.prototype.removeRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/roles/users/7/2');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(RbacService.prototype.removeRole).toHaveBeenCalledWith(7, 2, null, 1);
  });

  it('returns 200 when scope query param is provided', async () => {
    (RbacService.prototype.removeRole as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/roles/users/7/2?scopeOrgUnitId=5');
    expect(res.status).toBe(200);
    expect(RbacService.prototype.removeRole).toHaveBeenCalledWith(7, 2, 5, 1);
  });

  it('returns 400 on service error', async () => {
    (RbacService.prototype.removeRole as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Assignment not found'));

    const res = await request(mountApp()).delete('/api/roles/users/7/99');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
