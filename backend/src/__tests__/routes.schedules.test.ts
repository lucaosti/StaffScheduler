/**
 * Route handler tests for `routes/schedules.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * ScheduleService is fully mocked.
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

jest.mock('../services/ScheduleService');

import { ScheduleService } from '../services/ScheduleService';
import { createSchedulesRouter } from '../routes/schedules';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/schedules', createSchedulesRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('schedules router GET /', () => {
  it('returns 200 with list of schedules', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Week 1' }]);

    const res = await request(mountApp()).get('/api/schedules');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 200 with empty list', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/schedules');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 on service error', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/schedules');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('schedules router GET /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).get('/api/schedules/0');
    expect(res.status).toBe(400);
  });

  it('returns 200 when schedule is found', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Week 2' });

    const res = await request(mountApp()).get('/api/schedules/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
  });

  it('returns 404 when schedule is not found', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/schedules/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on service error', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));

    const res = await request(mountApp()).get('/api/schedules/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /:id/shifts ───────────────────────────────────────────────────────────

describe('schedules router GET /:id/shifts', () => {
  it('returns 200 with schedule and shifts', async () => {
    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, shifts: [] });

    const res = await request(mountApp()).get('/api/schedules/5/shifts');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when schedule not found', async () => {
    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/schedules/99/shifts');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on error', async () => {
    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/schedules/5/shifts');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('schedules router POST /', () => {
  const validBody = {
    name: 'Schedule A',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    departmentId: 1,
  };

  it('returns 201 on successful creation', async () => {
    (ScheduleService.prototype.createSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 10, name: 'Schedule A' });

    const res = await request(mountApp()).post('/api/schedules').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
  });

  it('returns 400 when body is invalid (name missing)', async () => {
    const res = await request(mountApp())
      .post('/api/schedules')
      .send({ startDate: '2026-06-01', endDate: '2026-06-30', departmentId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when departmentId missing', async () => {
    const res = await request(mountApp())
      .post('/api/schedules')
      .send({ name: 'A', startDate: '2026-06-01', endDate: '2026-06-30' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 on service error', async () => {
    (ScheduleService.prototype.createSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).post('/api/schedules').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('schedules router PUT /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).put('/api/schedules/0').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful update', async () => {
    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Updated' });

    const res = await request(mountApp()).put('/api/schedules/5').send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated');
  });

  it('returns 404 when service throws not found error', async () => {
    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));

    const res = await request(mountApp()).put('/api/schedules/99').send({ name: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on unknown error', async () => {
    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp()).put('/api/schedules/5').send({ name: 'X' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('schedules router DELETE /:id', () => {
  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).delete('/api/schedules/0');
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful delete', async () => {
    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/schedules/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when schedule not found', async () => {
    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));

    const res = await request(mountApp()).delete('/api/schedules/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when schedule is not in draft status', async () => {
    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Only draft schedules can be deleted'));

    const res = await request(mountApp()).delete('/api/schedules/5');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 500 on unknown error', async () => {
    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp()).delete('/api/schedules/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /department/:departmentId ─────────────────────────────────────────────

describe('schedules router GET /department/:departmentId', () => {
  it('returns 200 with schedules for department', async () => {
    (ScheduleService.prototype.getSchedulesByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(mountApp()).get('/api/schedules/department/3');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 400 for invalid departmentId', async () => {
    const res = await request(mountApp()).get('/api/schedules/department/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (ScheduleService.prototype.getSchedulesByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/schedules/department/3');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /user/:userId ─────────────────────────────────────────────────────────

describe('schedules router GET /user/:userId', () => {
  it('returns 200 with schedules for user', async () => {
    (ScheduleService.prototype.getSchedulesByUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 3 }]);

    const res = await request(mountApp()).get('/api/schedules/user/7');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 for invalid userId', async () => {
    const res = await request(mountApp()).get('/api/schedules/user/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (ScheduleService.prototype.getSchedulesByUser as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/schedules/user/7');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PATCH /:id/publish ────────────────────────────────────────────────────────

describe('schedules router PATCH /:id/publish', () => {
  it('returns 200 on successful publish', async () => {
    (ScheduleService.prototype.publishSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, status: 'published' });

    const res = await request(mountApp()).patch('/api/schedules/5/publish');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when schedule not found', async () => {
    (ScheduleService.prototype.publishSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));

    const res = await request(mountApp()).patch('/api/schedules/99/publish');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on unknown error', async () => {
    (ScheduleService.prototype.publishSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('unexpected'));

    const res = await request(mountApp()).patch('/api/schedules/5/publish');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PATCH /:id/archive ────────────────────────────────────────────────────────

describe('schedules router PATCH /:id/archive', () => {
  it('returns 200 on successful archive', async () => {
    (ScheduleService.prototype.archiveSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, status: 'archived' });

    const res = await request(mountApp()).patch('/api/schedules/5/archive');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when schedule not found', async () => {
    (ScheduleService.prototype.archiveSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));

    const res = await request(mountApp()).patch('/api/schedules/99/archive');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on unknown error', async () => {
    (ScheduleService.prototype.archiveSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('unexpected'));

    const res = await request(mountApp()).patch('/api/schedules/5/archive');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST /:id/duplicate ───────────────────────────────────────────────────────

describe('schedules router POST /:id/duplicate', () => {
  const validBody = {
    name: 'Duplicate Schedule',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  };

  it('returns 201 on successful duplication', async () => {
    (ScheduleService.prototype.duplicateSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 20, name: 'Duplicate Schedule' });

    const res = await request(mountApp())
      .post('/api/schedules/5/duplicate')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(20);
  });

  it('returns 400 when name missing', async () => {
    const res = await request(mountApp())
      .post('/api/schedules/5/duplicate')
      .send({ startDate: '2026-07-01', endDate: '2026-07-31' });

    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    (ScheduleService.prototype.duplicateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .post('/api/schedules/5/duplicate')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── POST /:id/generate ────────────────────────────────────────────────────────

describe('schedules router POST /:id/generate', () => {
  it('returns 200 on successful generation', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5 });
    (ScheduleService.prototype.generateOptimizedSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ status: 'completed', assignmentsCreated: 10 });

    const res = await request(mountApp()).post('/api/schedules/5/generate');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when schedule not found before generation', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).post('/api/schedules/99/generate');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on generation error', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5 });
    (ScheduleService.prototype.generateOptimizedSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('optimizer failed'));

    const res = await request(mountApp()).post('/api/schedules/5/generate');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
