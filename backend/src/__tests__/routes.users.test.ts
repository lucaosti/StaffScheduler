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
    req.user = { ...currentUser, isActive: true };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireManager: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/UserService');

import { UserService } from '../services/UserService';
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
});

describe('users router GET /', () => {
  it('admin lists all users (with filters)', async () => {
    const all = jest.fn().mockResolvedValue([{ id: 1 }]);
    (UserService.prototype.getAllUsers as jest.Mock) = all;
    const res = await request(mountApp()).get(
      '/api/users?search=foo&department=2&role=manager'
    );
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledWith({ search: 'foo', departmentId: 2, role: 'manager' });
  });

  it('admin lists without optional filters', async () => {
    const all = jest.fn().mockResolvedValue([]);
    (UserService.prototype.getAllUsers as jest.Mock) = all;
    const res = await request(mountApp()).get('/api/users');
    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledWith({ search: undefined, departmentId: undefined, role: undefined });
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
    const res = await request(mountApp()).post('/api/users').send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 when fields missing', async () => {
    const res = await request(mountApp()).post('/api/users').send({ email: 'a@x.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
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
