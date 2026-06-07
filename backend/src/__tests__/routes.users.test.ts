/**
 * Comprehensive happy + error path tests for `routes/users.ts`.
 *
 * Middleware is stubbed so the role of `req.user` is configurable per test
 * (admin / manager / employee). The UserService is fully mocked.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'admin',
  email: 'admin@example',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { ...currentUser, isActive: true, permissions: require("./helpers/permissions").permissionsForRole(currentUser.role) };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/UserService');
jest.mock('../services/RbacService');

import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { createUsersRouter } from '../routes/users';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example' };
  // Default RbacService stubs (auto-mock always returns undefined by default).
  (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue(null);
  (RbacService.prototype.getEffectivePermissions as jest.Mock).mockResolvedValue([]);
  (RbacService.prototype.getUserRoles as jest.Mock).mockResolvedValue([]);
});

describe('users router GET /', () => {
  it('admin lists all users (with filters)', async () => {
    const all = jest.fn().mockResolvedValue([{ id: 1 }]);
    (UserService.prototype.getAllUsers as jest.Mock) = all;
    const res = await request(mountApp()).get(
      '/api/users?search=foo&department=2&roleId=3'
    );
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledWith({ search: 'foo', departmentId: 2, roleId: 3 });
  });

  it('admin lists without optional filters', async () => {
    const all = jest.fn().mockResolvedValue([]);
    (UserService.prototype.getAllUsers as jest.Mock) = all;
    const res = await request(mountApp()).get('/api/users');
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledWith({ search: undefined, departmentId: undefined, roleId: undefined });
  });

  it('manager lists only own scope and applies post-filtering', async () => {
    currentUser = { id: 9, role: 'manager', email: 'm@x' };
    (UserService.prototype.getUsersForManager as jest.Mock) = jest.fn().mockResolvedValue([
      {
        id: 2,
        email: 'a@x.com',
        firstName: 'Anna',
        lastName: 'Bianchi',
        role: 'employee',
        employeeId: 'EMP01',
        departments: [{ departmentId: 5 }],
      },
      {
        id: 3,
        email: 'b@x.com',
        firstName: 'Luca',
        lastName: 'Rossi',
        role: 'employee',
        employeeId: 'EMP02',
        departments: [{ departmentId: 7 }],
      },
    ]);
    const res = await request(mountApp()).get(
      '/api/users?search=anna&department=5&role=employee'
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(2);
  });

  it('returns 500 when service throws', async () => {
    (UserService.prototype.getAllUsers as jest.Mock) = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await request(mountApp()).get('/api/users');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('users router POST /', () => {
  it('returns 403 for employees', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    const res = await request(mountApp()).post('/api/users').send({
      email: 'new@x.com', password: 'pw', firstName: 'A', lastName: 'B',
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when fields missing', async () => {
    const res = await request(mountApp()).post('/api/users').send({ email: 'a@x.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 when service creates', async () => {
    (UserService.prototype.createUser as jest.Mock) = jest.fn().mockResolvedValue({ id: 11 });
    const res = await request(mountApp())
      .post('/api/users')
      .send({
        email: 'a@x.com',
        password: 'pw1234',
        firstName: 'A',
        lastName: 'B',
        role: 'employee',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(11);
  });

  it('returns 403 when a manager tries to assign a role with escalated permissions', async () => {
    currentUser = { id: 9, role: 'manager', email: 'm@x' };
    const create = jest.fn().mockResolvedValue({ id: 11 });
    (UserService.prototype.createUser as jest.Mock) = create;
    // The roleId 99 maps to a role with settings.manage which the manager doesn't hold.
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue({
      id: 99,
      name: 'Administrator',
      isSystem: true,
      permissions: ['settings.manage', 'role.manage'],
    });
    const res = await request(mountApp())
      .post('/api/users')
      .send({ email: 'a@x.com', password: 'pw1234', firstName: 'A', lastName: 'B', roleIds: [99] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(create).not.toHaveBeenCalled();
  });

  it('allows an admin to assign any role', async () => {
    (UserService.prototype.createUser as jest.Mock) = jest.fn().mockResolvedValue({ id: 12 });
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue({
      id: 99,
      name: 'Administrator',
      isSystem: true,
      permissions: ['settings.manage', 'role.manage'],
    });
    const res = await request(mountApp())
      .post('/api/users')
      .send({ email: 'a@x.com', password: 'pw1234', firstName: 'A', lastName: 'B', roleIds: [99] });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(12);
  });

  it('returns 409 on duplicate', async () => {
    const dup: any = new Error('dup');
    dup.code = 'ER_DUP_ENTRY';
    (UserService.prototype.createUser as jest.Mock) = jest.fn().mockRejectedValue(dup);
    const res = await request(mountApp())
      .post('/api/users')
      .send({
        email: 'a@x.com',
        password: 'pw1234',
        firstName: 'A',
        lastName: 'B',
        role: 'employee',
      });
    expect(res.status).toBe(409);
  });

  it('returns 500 on unknown error', async () => {
    (UserService.prototype.createUser as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp())
      .post('/api/users')
      .send({
        email: 'a@x.com',
        password: 'pw1234',
        firstName: 'A',
        lastName: 'B',
        role: 'employee',
      });
    expect(res.status).toBe(500);
  });
});

describe('users router GET /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).get('/api/users/0');
    expect(res.status).toBe(400);
  });

  it('returns 404 when missing', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/users/99');
    expect(res.status).toBe(404);
  });

  it('returns 403 for employee querying another employee', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({ id: 99 });
    const res = await request(mountApp()).get('/api/users/99');
    expect(res.status).toBe(403);
  });

  it('returns 200 when found and authorized', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({ id: 99 });
    const res = await request(mountApp()).get('/api/users/99');
    expect(res.status).toBe(200);
  });

  it('returns 500 on unexpected error', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).get('/api/users/5');
    expect(res.status).toBe(500);
  });
});

describe('users router PUT /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).put('/api/users/0');
    expect(res.status).toBe(400);
  });

  it('returns 403 for employee editing another', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    const res = await request(mountApp()).put('/api/users/9').send({});
    expect(res.status).toBe(403);
  });

  it('returns 403 for employee touching restricted fields', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    const res = await request(mountApp()).put('/api/users/5').send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when a manager tries to assign a privileged role', async () => {
    currentUser = { id: 9, role: 'manager', email: 'm@x' };
    const update = jest.fn().mockResolvedValue({ id: 3 });
    (UserService.prototype.updateUser as jest.Mock) = update;
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue({
      id: 99,
      name: 'Administrator',
      isSystem: true,
      permissions: ['settings.manage', 'role.manage'],
    });
    const res = await request(mountApp()).put('/api/users/3').send({ roleIds: [99] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 403 when a user tries to change their own roles', async () => {
    const update = jest.fn().mockResolvedValue({ id: 1 });
    (UserService.prototype.updateUser as jest.Mock) = update;
    const res = await request(mountApp()).put('/api/users/1').send({ roleIds: [2] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-admin (manager) tries to assign the admin role to themselves', async () => {
    // A user must never be able to elevate their own role — both the
    // self-role-change guard and the anti-escalation check would block this.
    currentUser = { id: 9, role: 'manager', email: 'm@x' };
    const update = jest.fn().mockResolvedValue({ id: 9 });
    (UserService.prototype.updateUser as jest.Mock) = update;
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Administrator',
      isSystem: true,
      permissions: ['settings.manage', 'role.manage'],
    });
    const res = await request(mountApp()).put('/api/users/9').send({ roleIds: [1] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(update).not.toHaveBeenCalled();
  });

  it('allows an admin to assign a role to another user', async () => {
    (UserService.prototype.updateUser as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    (RbacService.prototype.getRoleById as jest.Mock).mockResolvedValue({
      id: 2,
      name: 'Manager',
      isSystem: false,
      permissions: ['schedule.manage'],
    });
    const res = await request(mountApp()).put('/api/users/9').send({ roleIds: [2] });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(9);
  });

  it('returns 404 when service returns null', async () => {
    (UserService.prototype.updateUser as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).put('/api/users/9').send({ firstName: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 200 on success', async () => {
    (UserService.prototype.updateUser as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    const res = await request(mountApp()).put('/api/users/9').send({ firstName: 'X' });
    expect(res.status).toBe(200);
  });

  it('returns 409 on duplicate', async () => {
    const dup: any = new Error('dup');
    dup.code = 'ER_DUP_ENTRY';
    (UserService.prototype.updateUser as jest.Mock) = jest.fn().mockRejectedValue(dup);
    const res = await request(mountApp()).put('/api/users/9').send({ firstName: 'X' });
    expect(res.status).toBe(409);
  });

  it('returns 500 on unknown error', async () => {
    (UserService.prototype.updateUser as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).put('/api/users/9').send({ firstName: 'X' });
    expect(res.status).toBe(500);
  });
});

describe('users router DELETE /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).delete('/api/users/0');
    expect(res.status).toBe(400);
  });

  it('returns 403 for employees', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    const res = await request(mountApp()).delete('/api/users/9');
    expect(res.status).toBe(403);
  });

  it('returns 400 when self-deleting', async () => {
    const res = await request(mountApp()).delete('/api/users/1');
    expect(res.status).toBe(400);
  });

  it('returns 200 on success', async () => {
    (UserService.prototype.deleteUser as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/users/9');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service throws "User not found"', async () => {
    (UserService.prototype.deleteUser as jest.Mock) = jest.fn().mockRejectedValue(new Error('User not found'));
    const res = await request(mountApp()).delete('/api/users/9');
    expect(res.status).toBe(404);
  });

  it('returns 500 on unknown error', async () => {
    (UserService.prototype.deleteUser as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(mountApp()).delete('/api/users/9');
    expect(res.status).toBe(500);
  });
});
