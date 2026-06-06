/**
 * Route handler tests for `routes/departments.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * DepartmentService and UserService are fully mocked.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'admin',
  email: 'admin@example.com',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      ...currentUser,
      isActive: true,
      permissions: require('./helpers/permissions').permissionsForRole(currentUser.role),
    };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/DepartmentService');
jest.mock('../services/UserService');

import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { createDepartmentsRouter } from '../routes/departments';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/departments', createDepartmentsRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

// ── GET / ────────────────────────────────────────────────────────────────────

describe('departments router GET /', () => {
  it('admin retrieves all departments', async () => {
    (DepartmentService.prototype.getAllDepartments as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Engineering' }]);

    const res = await request(mountApp()).get('/api/departments');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('non-admin retrieves only own departments', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 2, name: 'HR' }]);

    const res = await request(mountApp()).get('/api/departments');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 500 when service throws', async () => {
    (DepartmentService.prototype.getAllDepartments as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp()).get('/api/departments');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /:id ─────────────────────────────────────────────────────────────────

describe('departments router GET /:id', () => {
  it('returns 400 for invalid id (0)', async () => {
    const res = await request(mountApp()).get('/api/departments/0');
    expect(res.status).toBe(400);
  });

  it('returns 200 when admin requests an existing department', async () => {
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Finance' });

    const res = await request(mountApp()).get('/api/departments/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
  });

  it('returns 404 when department does not exist', async () => {
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);
    // Admin bypasses the access check so getDepartmentsForUser won't be called
    const res = await request(mountApp()).get('/api/departments/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when non-admin requests a department they do not belong to', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 2, name: 'HR' }]);

    const res = await request(mountApp()).get('/api/departments/9');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 on unexpected error', async () => {
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));

    const res = await request(mountApp()).get('/api/departments/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST / ───────────────────────────────────────────────────────────────────

describe('departments router POST /', () => {
  it('returns 403 when employee tries to create', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };

    const res = await request(mountApp())
      .post('/api/departments')
      .send({ name: 'NewDept' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when body fails validation (name missing)', async () => {
    const res = await request(mountApp()).post('/api/departments').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 when admin creates a valid department', async () => {
    (DepartmentService.prototype.createDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 10, name: 'Sales' });

    const res = await request(mountApp())
      .post('/api/departments')
      .send({ name: 'Sales' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
  });

  it('returns 400 when managerId resolves to no user', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp())
      .post('/api/departments')
      .send({ name: 'Sales', managerId: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 500 on service failure', async () => {
    (DepartmentService.prototype.createDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .post('/api/departments')
      .send({ name: 'Sales' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────

describe('departments router PUT /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).put('/api/departments/0').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 403 when employee tries to update', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };

    const res = await request(mountApp())
      .put('/api/departments/3')
      .send({ name: 'NewName' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 when admin updates successfully', async () => {
    (DepartmentService.prototype.updateDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 3, name: 'Updated' });

    const res = await request(mountApp())
      .put('/api/departments/3')
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated');
  });

  it('returns 400 when managerId is invalid', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp())
      .put('/api/departments/3')
      .send({ managerId: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 500 on service error', async () => {
    (DepartmentService.prototype.updateDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .put('/api/departments/3')
      .send({ name: 'X' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('departments router DELETE /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).delete('/api/departments/0');
    expect(res.status).toBe(400);
  });

  it('returns 403 when non-admin tries to delete', async () => {
    currentUser = { id: 5, role: 'manager', email: 'm@x.com' };

    const res = await request(mountApp()).delete('/api/departments/3');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 when admin deletes successfully', async () => {
    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/departments/3');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 when department has active users', async () => {
    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Cannot delete department with active users'));

    const res = await request(mountApp()).delete('/api/departments/3');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 500 on unknown error', async () => {
    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('unexpected failure'));

    const res = await request(mountApp()).delete('/api/departments/3');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST /:id/users ───────────────────────────────────────────────────────────

describe('departments router POST /:id/users', () => {
  it('returns 400 when userId missing', async () => {
    const res = await request(mountApp())
      .post('/api/departments/3/users')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 403 when employee tries to add user', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };

    const res = await request(mountApp())
      .post('/api/departments/3/users')
      .send({ userId: 7 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when target user does not exist', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 3, name: 'Sales' });

    const res = await request(mountApp())
      .post('/api/departments/3/users')
      .send({ userId: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 404 when department does not exist', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7 });
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp())
      .post('/api/departments/99/users')
      .send({ userId: 7 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 on success', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7 });
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 3, name: 'Sales' });
    (DepartmentService.prototype.addUserToDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp())
      .post('/api/departments/3/users')
      .send({ userId: 7 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ── DELETE /:id/users/:userId ─────────────────────────────────────────────────

describe('departments router DELETE /:id/users/:userId', () => {
  it('returns 403 when employee tries to remove', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };

    const res = await request(mountApp()).delete('/api/departments/3/users/7');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 when admin removes user from department', async () => {
    (DepartmentService.prototype.removeUserFromDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/departments/3/users/7');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 500 on service error', async () => {
    (DepartmentService.prototype.removeUserFromDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).delete('/api/departments/3/users/7');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /:id/stats ────────────────────────────────────────────────────────────

describe('departments router GET /:id/stats', () => {
  it('returns 200 for admin', async () => {
    (DepartmentService.prototype.getDepartmentStatsByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ employeeCount: 10, activeShifts: 5 });

    const res = await request(mountApp()).get('/api/departments/3/stats');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when non-admin requests stats for department they do not belong to', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x.com' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 2 }]);

    const res = await request(mountApp()).get('/api/departments/9/stats');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 500 on error', async () => {
    (DepartmentService.prototype.getDepartmentStatsByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/departments/3/stats');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
