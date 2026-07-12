/**
 * Route handler tests for `routes/shifts.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * ShiftService is fully mocked.
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

jest.mock('../services/ShiftService');

import { ShiftService } from '../services/ShiftService';
import { createShiftsRouter } from '../routes/shifts';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/shifts', createShiftsRouter(fakePool));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

// ── Shift Template Routes ─────────────────────────────────────────────────────

describe('shifts router GET /templates', () => {
  it('returns 200 with all templates', async () => {
    (ShiftService.prototype.getAllShiftTemplates as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Morning' }, { id: 2, name: 'Evening' }]);

    const res = await request(mountApp()).get('/api/shifts/templates');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 500 on error', async () => {
    (ShiftService.prototype.getAllShiftTemplates as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/shifts/templates');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router GET /templates/:id', () => {
  it('returns 200 when template found', async () => {
    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Morning' });

    const res = await request(mountApp()).get('/api/shifts/templates/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
  });

  it('returns 404 when template not found', async () => {
    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/shifts/templates/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).get('/api/shifts/templates/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/shifts/templates/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router POST /templates', () => {
  const validTemplateBody = {
    name: 'Night',
    departmentId: 1,
    startTime: '22:00',
    endTime: '06:00',
    minStaff: 1,
    maxStaff: 3,
  };

  it('returns 201 on successful creation', async () => {
    (ShiftService.prototype.createShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 10, name: 'Night' });

    const res = await request(mountApp())
      .post('/api/shifts/templates')
      .send(validTemplateBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(10);
  });

  it('returns 500 on service error', async () => {
    (ShiftService.prototype.createShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .post('/api/shifts/templates')
      .send(validTemplateBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router PUT /templates/:id', () => {
  it('returns 200 on successful update', async () => {
    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Updated Template' });

    const res = await request(mountApp())
      .put('/api/shifts/templates/5')
      .send({ name: 'Updated Template' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Template');
  });

  it('returns 404 when template not found', async () => {
    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp())
      .put('/api/shifts/templates/99')
      .send({ name: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).put('/api/shifts/templates/0').send({});
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp())
      .put('/api/shifts/templates/5')
      .send({ name: 'X' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router DELETE /templates/:id', () => {
  it('returns 200 on successful delete', async () => {
    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue(true);

    const res = await request(mountApp()).delete('/api/shifts/templates/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when template not found', async () => {
    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue(false);

    const res = await request(mountApp()).delete('/api/shifts/templates/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).delete('/api/shifts/templates/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).delete('/api/shifts/templates/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── Shift Routes ──────────────────────────────────────────────────────────────

describe('shifts router GET /', () => {
  it('returns 200 with list of shifts', async () => {
    (ShiftService.prototype.getAllShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(mountApp()).get('/api/shifts');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 200 with empty list', async () => {
    (ShiftService.prototype.getAllShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/shifts');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 on error', async () => {
    (ShiftService.prototype.getAllShifts as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/shifts');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('forwards startDate/endDate/departmentId/status query params to the service', async () => {
    const getAllShifts = jest.fn().mockResolvedValue([]);
    (ShiftService.prototype.getAllShifts as jest.Mock) = getAllShifts;

    await request(mountApp()).get('/api/shifts?startDate=2026-07-01&endDate=2026-07-31&departmentId=3&status=confirmed');

    expect(getAllShifts).toHaveBeenCalledWith(
      { startDate: '2026-07-01', endDate: '2026-07-31', departmentId: 3, status: 'confirmed' }
    );
  });

  it('omits date-range filters entirely when no query params are given', async () => {
    const getAllShifts = jest.fn().mockResolvedValue([]);
    (ShiftService.prototype.getAllShifts as jest.Mock) = getAllShifts;

    await request(mountApp()).get('/api/shifts');

    expect(getAllShifts).toHaveBeenCalledWith({});
  });
});

describe('shifts router GET /:id', () => {
  it('returns 200 when shift found', async () => {
    (ShiftService.prototype.getShiftById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, date: '2026-06-10' });

    const res = await request(mountApp()).get('/api/shifts/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
  });

  it('returns 404 when shift not found', async () => {
    (ShiftService.prototype.getShiftById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);

    const res = await request(mountApp()).get('/api/shifts/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).get('/api/shifts/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    (ShiftService.prototype.getShiftById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));

    const res = await request(mountApp()).get('/api/shifts/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router POST /', () => {
  const validShiftBody = {
    scheduleId: 1,
    departmentId: 2,
    date: '2026-06-10',
    startTime: '08:00',
    endTime: '16:00',
    minStaff: 2,
    maxStaff: 5,
  };

  it('returns 201 on successful creation', async () => {
    (ShiftService.prototype.createShift as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 15, ...validShiftBody });

    const res = await request(mountApp()).post('/api/shifts').send(validShiftBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(15);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(mountApp())
      .post('/api/shifts')
      .send({ scheduleId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when date is missing', async () => {
    const { date: _date, ...bodyWithoutDate } = validShiftBody;
    const res = await request(mountApp())
      .post('/api/shifts')
      .send(bodyWithoutDate);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 on service error', async () => {
    (ShiftService.prototype.createShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).post('/api/shifts').send(validShiftBody);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router PUT /:id', () => {
  it('returns 200 on successful update', async () => {
    (ShiftService.prototype.updateShift as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, date: '2026-06-11' });

    const res = await request(mountApp())
      .put('/api/shifts/5')
      .send({ date: '2026-06-11' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when service throws not found error', async () => {
    (ShiftService.prototype.updateShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Shift not found'));

    const res = await request(mountApp())
      .put('/api/shifts/99')
      .send({ date: '2026-06-11' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).put('/api/shifts/0').send({});
    expect(res.status).toBe(400);
  });

  it('returns 500 on unknown error', async () => {
    (ShiftService.prototype.updateShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp())
      .put('/api/shifts/5')
      .send({ date: '2026-06-11' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('shifts router DELETE /:id', () => {
  it('returns 200 on successful delete', async () => {
    (ShiftService.prototype.deleteShift as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/shifts/5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when shift not found', async () => {
    (ShiftService.prototype.deleteShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Shift not found'));

    const res = await request(mountApp()).delete('/api/shifts/99');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(mountApp()).delete('/api/shifts/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on unknown error', async () => {
    (ShiftService.prototype.deleteShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db failure'));

    const res = await request(mountApp()).delete('/api/shifts/5');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /schedule/:scheduleId ─────────────────────────────────────────────────

describe('shifts router GET /schedule/:scheduleId', () => {
  it('returns 200 with shifts for schedule', async () => {
    (ShiftService.prototype.getShiftsBySchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(mountApp()).get('/api/shifts/schedule/3');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 400 for invalid scheduleId', async () => {
    const res = await request(mountApp()).get('/api/shifts/schedule/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (ShiftService.prototype.getShiftsBySchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/shifts/schedule/3');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /department/:departmentId ─────────────────────────────────────────────

describe('shifts router GET /department/:departmentId', () => {
  it('returns 200 with shifts for department', async () => {
    (ShiftService.prototype.getShiftsByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 3 }]);

    const res = await request(mountApp()).get('/api/shifts/department/2');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 for invalid departmentId', async () => {
    const res = await request(mountApp()).get('/api/shifts/department/0');
    expect(res.status).toBe(400);
  });

  it('returns 500 on error', async () => {
    (ShiftService.prototype.getShiftsByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/shifts/department/2');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
