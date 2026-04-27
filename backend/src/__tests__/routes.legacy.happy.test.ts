/**
 * Happy-path tests for the legacy routers (T010).
 *
 * Routes mount `authenticate` + sometimes `requireRole(...)`. We can't
 * easily fake a JWT for every test (each route's authenticate looks up
 * the user via the database singleton), so we replace the middleware
 * implementations with stubs that attach a fake admin user and call
 * next(). Service classes are jest.mocked at the module boundary so
 * tests don't need a real DB.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: 'admin@example', role: 'admin', isActive: true };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireManager: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/EmployeeService');
jest.mock('../services/ScheduleService');
jest.mock('../services/ShiftService');
jest.mock('../services/DepartmentService');
jest.mock('../services/AssignmentService');
jest.mock('../services/SystemSettingsService');

import { EmployeeService } from '../services/EmployeeService';
import { ScheduleService } from '../services/ScheduleService';
import { ShiftService } from '../services/ShiftService';
import { DepartmentService } from '../services/DepartmentService';
import { AssignmentService } from '../services/AssignmentService';
import { SystemSettingsService } from '../services/SystemSettingsService';

import { createEmployeesRouter } from '../routes/employees';
import { createSchedulesRouter } from '../routes/schedules';
import { createShiftsRouter } from '../routes/shifts';
import { createDepartmentsRouter } from '../routes/departments';
import { createAssignmentsRouter } from '../routes/assignments';
import { createSystemSettingsRouter } from '../routes/settings';

const mountApp = (prefix: string, router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

const fakePool = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* employees                                                          */
/* ------------------------------------------------------------------ */

describe('employees router happy paths', () => {
  it('GET / returns the list', async () => {
    (EmployeeService.prototype.getAllEmployees as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, email: 'a@x.com' }]);
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /:id returns 400 for non-numeric ids', async () => {
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).get('/api/employees/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('GET /:id returns 404 when service returns null', async () => {
    (EmployeeService.prototype.getEmployeeById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).get('/api/employees/99');
    expect(res.status).toBe(404);
  });

  it('POST / creates and returns 201', async () => {
    (EmployeeService.prototype.createEmployee as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7, email: 'new@x.com' });
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).post('/api/employees').send({ email: 'new@x.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(7);
  });

  it('PUT /:id returns the updated row', async () => {
    (EmployeeService.prototype.updateEmployee as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7, firstName: 'X' });
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).put('/api/employees/7').send({ firstName: 'X' });
    expect(res.status).toBe(200);
  });

  it('DELETE /:id returns 200 on success', async () => {
    (EmployeeService.prototype.deleteEmployee as jest.Mock) = jest.fn().mockResolvedValue(true);
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).delete('/api/employees/7');
    expect(res.status).toBe(200);
  });

  it('GET /department/:departmentId returns the list', async () => {
    (EmployeeService.prototype.getEmployeesByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    const app = mountApp('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).get('/api/employees/department/3');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* schedules                                                          */
/* ------------------------------------------------------------------ */

describe('schedules router happy paths', () => {
  it('GET / returns the list', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/schedules', createSchedulesRouter(fakePool));
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(200);
  });

  it('GET /:id returns 404 when missing', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const app = mountApp('/api/schedules', createSchedulesRouter(fakePool));
    const res = await request(app).get('/api/schedules/99');
    expect(res.status).toBe(404);
  });

  it('POST / returns 201 on create', async () => {
    (ScheduleService.prototype.createSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, name: 'May' });
    const app = mountApp('/api/schedules', createSchedulesRouter(fakePool));
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: 'May', departmentId: 1, startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(res.status).toBe(201);
  });

  it('PATCH /:id/publish returns the published schedule', async () => {
    (ScheduleService.prototype.publishSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'published' });
    const app = mountApp('/api/schedules', createSchedulesRouter(fakePool));
    const res = await request(app).patch('/api/schedules/1/publish');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
  });

  it('PATCH /:id/archive returns the archived schedule', async () => {
    (ScheduleService.prototype.archiveSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'archived' });
    const app = mountApp('/api/schedules', createSchedulesRouter(fakePool));
    const res = await request(app).patch('/api/schedules/1/archive');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* shifts                                                             */
/* ------------------------------------------------------------------ */

describe('shifts router happy paths', () => {
  it('GET /templates returns the list', async () => {
    (ShiftService.prototype.getAllShiftTemplates as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts/templates');
    expect(res.status).toBe(200);
  });

  it('GET / returns shifts', async () => {
    (ShiftService.prototype.getAllShifts as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts');
    expect(res.status).toBe(200);
  });

  it('POST / returns 201 on create', async () => {
    (ShiftService.prototype.createShift as jest.Mock) = jest.fn().mockResolvedValue({ id: 11 });
    const app = mountApp('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).post('/api/shifts').send({ scheduleId: 1 });
    expect(res.status).toBe(201);
  });

  it('GET /schedule/:scheduleId returns shifts', async () => {
    (ShiftService.prototype.getShiftsBySchedule as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/shifts', createShiftsRouter(fakePool));
    const res = await request(app).get('/api/shifts/schedule/1');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* departments                                                        */
/* ------------------------------------------------------------------ */

describe('departments router happy paths', () => {
  it('GET / returns the list', async () => {
    (DepartmentService.prototype.getAllDepartments as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/departments', createDepartmentsRouter(fakePool));
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
  });

  it('POST / returns 201 on create', async () => {
    (DepartmentService.prototype.createDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, name: 'Pediatrics' });
    const app = mountApp('/api/departments', createDepartmentsRouter(fakePool));
    const res = await request(app).post('/api/departments').send({ name: 'Pediatrics' });
    expect(res.status).toBe(201);
  });

  it('GET /:id returns 404 for missing', async () => {
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const app = mountApp('/api/departments', createDepartmentsRouter(fakePool));
    const res = await request(app).get('/api/departments/99');
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* assignments                                                        */
/* ------------------------------------------------------------------ */

describe('assignments router happy paths', () => {
  it('GET / returns the list', async () => {
    (AssignmentService.prototype.getAllAssignments as jest.Mock) = jest.fn().mockResolvedValue([]);
    const app = mountApp('/api/assignments', createAssignmentsRouter(fakePool));
    const res = await request(app).get('/api/assignments');
    expect(res.status).toBe(200);
  });

  it('POST / returns 201 on create', async () => {
    (AssignmentService.prototype.createAssignment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    const app = mountApp('/api/assignments', createAssignmentsRouter(fakePool));
    const res = await request(app).post('/api/assignments').send({ shiftId: 10, userId: 7 });
    expect(res.status).toBe(201);
  });

  it('PATCH /:id/confirm returns the confirmed assignment', async () => {
    (AssignmentService.prototype.confirmAssignment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'confirmed' });
    const app = mountApp('/api/assignments', createAssignmentsRouter(fakePool));
    const res = await request(app).patch('/api/assignments/1/confirm');
    expect(res.status).toBe(200);
  });

  it('GET /user/:userId returns the user assignments', async () => {
    (AssignmentService.prototype.getAssignmentsByUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    const app = mountApp('/api/assignments', createAssignmentsRouter(fakePool));
    const res = await request(app).get('/api/assignments/user/7');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* settings                                                           */
/* ------------------------------------------------------------------ */

describe('settings router happy paths', () => {
  it('GET / returns the list', async () => {
    (SystemSettingsService.prototype.getAllSettings as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    const app = mountApp('/api/settings', createSystemSettingsRouter(fakePool));
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
  });
});
