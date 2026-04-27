/**
 * Comprehensive happy + error path tests for all routes that previously had
 * only smoke or partial coverage. Middleware is stubbed and services are
 * mocked at the module boundary.
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

jest.mock('../services/AssignmentService');
jest.mock('../services/ScheduleService');
jest.mock('../services/ShiftService');
jest.mock('../services/EmployeeService');
jest.mock('../services/DepartmentService');
jest.mock('../services/UserService');
jest.mock('../services/SystemSettingsService');
jest.mock('../services/TimeOffService');
jest.mock('../services/ShiftSwapService');
jest.mock('../services/PreferencesService');
jest.mock('../services/AuditLogService');
jest.mock('../services/CalendarService');
jest.mock('../services/TwoFactorService');
jest.mock('../services/OnCallService');
jest.mock('../services/UserDirectoryService');
jest.mock('../services/BulkImportService');
jest.mock('../services/NotificationService');

import { AssignmentService } from '../services/AssignmentService';
import { ScheduleService } from '../services/ScheduleService';
import { ShiftService } from '../services/ShiftService';
import { EmployeeService } from '../services/EmployeeService';
import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { SystemSettingsService } from '../services/SystemSettingsService';
import { TimeOffService } from '../services/TimeOffService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { PreferencesService } from '../services/PreferencesService';
import { AuditLogService } from '../services/AuditLogService';
import { CalendarService } from '../services/CalendarService';
import { TwoFactorService } from '../services/TwoFactorService';
import { OnCallService } from '../services/OnCallService';
import { UserDirectoryService } from '../services/UserDirectoryService';
import { BulkImportService } from '../services/BulkImportService';
import { NotificationService } from '../services/NotificationService';

import { createAssignmentsRouter } from '../routes/assignments';
import { createSchedulesRouter } from '../routes/schedules';
import { createShiftsRouter } from '../routes/shifts';
import { createEmployeesRouter } from '../routes/employees';
import { createDepartmentsRouter } from '../routes/departments';
import { createSystemSettingsRouter } from '../routes/settings';
import { createTimeOffRouter } from '../routes/timeOff';
import { createShiftSwapRouter } from '../routes/shiftSwap';
import { createPreferencesRouter } from '../routes/preferences';
import { createAuditLogsRouter } from '../routes/auditLogs';
import { createCalendarRouter } from '../routes/calendar';
import { createTwoFactorRouter } from '../routes/twoFactor';
import { createOnCallRouter } from '../routes/onCall';
import { createDirectoryRouter } from '../routes/directory';
import { createBulkImportRouter } from '../routes/bulkImport';
import { createNotificationsRouter } from '../routes/notifications';
import { createAuthRouter } from '../routes/auth';

const fakePool = {} as never;

const mountApp = (prefix: string, router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example' };
});

/* ---------------------------------------------------------------------------
 * Assignments router – full coverage
 * ------------------------------------------------------------------------- */

describe('assignments router (extended)', () => {
  const app = () => mountApp('/api/assignments', createAssignmentsRouter(fakePool));

  it('GET / 500 on error', async () => {
    (AssignmentService.prototype.getAllAssignments as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/assignments');
    expect(res.status).toBe(500);
  });

  it('GET /:id 400 on NaN', async () => {
    const res = await request(app()).get('/api/assignments/abc');
    expect(res.status).toBe(400);
  });

  it('GET /:id 404 when missing', async () => {
    (AssignmentService.prototype.getAssignmentById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(app()).get('/api/assignments/9');
    expect(res.status).toBe(404);
  });

  it('GET /:id 200 when found', async () => {
    (AssignmentService.prototype.getAssignmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 9 });
    const res = await request(app()).get('/api/assignments/9');
    expect(res.status).toBe(200);
  });

  it('GET /:id 500 on error', async () => {
    (AssignmentService.prototype.getAssignmentById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/assignments/9');
    expect(res.status).toBe(500);
  });

  it('POST / 500 on error', async () => {
    (AssignmentService.prototype.createAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/api/assignments').send({});
    expect(res.status).toBe(500);
  });

  it('PUT /:id 400 on NaN', async () => {
    const res = await request(app()).put('/api/assignments/abc').send({});
    expect(res.status).toBe(400);
  });

  it('PUT /:id 200 on update', async () => {
    (AssignmentService.prototype.updateAssignment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 9 });
    const res = await request(app()).put('/api/assignments/9').send({});
    expect(res.status).toBe(200);
  });

  it('PUT /:id 404 when not found', async () => {
    (AssignmentService.prototype.updateAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Assignment not found'));
    const res = await request(app()).put('/api/assignments/9').send({});
    expect(res.status).toBe(404);
  });

  it('PUT /:id 500 on other error', async () => {
    (AssignmentService.prototype.updateAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    const res = await request(app()).put('/api/assignments/9').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /:id 400 on NaN', async () => {
    const res = await request(app()).delete('/api/assignments/abc');
    expect(res.status).toBe(400);
  });

  it('DELETE /:id 200', async () => {
    (AssignmentService.prototype.deleteAssignment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    const res = await request(app()).delete('/api/assignments/9');
    expect(res.status).toBe(200);
  });

  it('DELETE /:id 404 when not found', async () => {
    (AssignmentService.prototype.deleteAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Assignment not found'));
    const res = await request(app()).delete('/api/assignments/9');
    expect(res.status).toBe(404);
  });

  it('DELETE /:id 500 on other error', async () => {
    (AssignmentService.prototype.deleteAssignment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    const res = await request(app()).delete('/api/assignments/9');
    expect(res.status).toBe(500);
  });

  it('GET /user/:userId 400 on NaN', async () => {
    const res = await request(app()).get('/api/assignments/user/abc');
    expect(res.status).toBe(400);
  });

  it('GET /user/:userId 500 on error', async () => {
    (AssignmentService.prototype.getAssignmentsByUser as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/assignments/user/1');
    expect(res.status).toBe(500);
  });

  it('GET /shift/:shiftId 200 / 400 / 500', async () => {
    let res = await request(app()).get('/api/assignments/shift/abc');
    expect(res.status).toBe(400);

    (AssignmentService.prototype.getAssignmentsByShift as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/assignments/shift/1');
    expect(res.status).toBe(200);

    (AssignmentService.prototype.getAssignmentsByShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/assignments/shift/1');
    expect(res.status).toBe(500);
  });

  it('GET /department/:departmentId 200 / 400 / 500', async () => {
    let res = await request(app()).get('/api/assignments/department/abc');
    expect(res.status).toBe(400);

    (AssignmentService.prototype.getAssignmentsByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/assignments/department/1?status=open');
    expect(res.status).toBe(200);

    (AssignmentService.prototype.getAssignmentsByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/assignments/department/1');
    expect(res.status).toBe(500);
  });

  it('POST /bulk 400 when not array', async () => {
    const res = await request(app()).post('/api/assignments/bulk').send({ assignments: 'no' });
    expect(res.status).toBe(400);
  });

  it('POST /bulk 201 success', async () => {
    (AssignmentService.prototype.bulkCreateAssignments as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const res = await request(app()).post('/api/assignments/bulk').send({ assignments: [{}, {}] });
    expect(res.status).toBe(201);
    expect(res.body.data.count).toBe(2);
  });

  it('POST /bulk 500 on error', async () => {
    (AssignmentService.prototype.bulkCreateAssignments as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/assignments/bulk').send({ assignments: [] });
    expect(res.status).toBe(500);
  });

  for (const action of ['confirm', 'decline', 'complete'] as const) {
    describe(`PATCH /:id/${action}`, () => {
      const method = `${action}Assignment` as keyof typeof AssignmentService.prototype;
      it('400 on NaN', async () => {
        const res = await request(app()).patch(`/api/assignments/abc/${action}`);
        expect(res.status).toBe(400);
      });
      it('200 success', async () => {
        (AssignmentService.prototype[method] as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
        const res = await request(app()).patch(`/api/assignments/1/${action}`);
        expect(res.status).toBe(200);
      });
      it('404 not found', async () => {
        (AssignmentService.prototype[method] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Assignment not found'));
        const res = await request(app()).patch(`/api/assignments/1/${action}`);
        expect(res.status).toBe(404);
      });
      if (action === 'confirm') {
        it('409 already confirmed', async () => {
          (AssignmentService.prototype[method] as jest.Mock) = jest
            .fn()
            .mockRejectedValue(new Error('Already confirmed'));
          const res = await request(app()).patch(`/api/assignments/1/${action}`);
          expect(res.status).toBe(409);
        });
      }
      it('500 on other error', async () => {
        (AssignmentService.prototype[method] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('boom'));
        const res = await request(app()).patch(`/api/assignments/1/${action}`);
        expect(res.status).toBe(500);
      });
    });
  }

  it('GET /shift/:shiftId/available-employees 200 / 400 / 500', async () => {
    let res = await request(app()).get('/api/assignments/shift/abc/available-employees');
    expect(res.status).toBe(400);

    (AssignmentService.prototype.getAvailableEmployeesForShift as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/assignments/shift/1/available-employees');
    expect(res.status).toBe(200);

    (AssignmentService.prototype.getAvailableEmployeesForShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/assignments/shift/1/available-employees');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Schedules router – full coverage
 * ------------------------------------------------------------------------- */

describe('schedules router (extended)', () => {
  const app = () => mountApp('/api/schedules', createSchedulesRouter(fakePool));

  it('GET / 500 on error', async () => {
    (ScheduleService.prototype.getAllSchedules as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/schedules');
    expect(res.status).toBe(500);
  });

  it('GET /:id 400 on NaN', async () => {
    const res = await request(app()).get('/api/schedules/abc');
    expect(res.status).toBe(400);
  });

  it('GET /:id 200 found', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    const res = await request(app()).get('/api/schedules/1');
    expect(res.status).toBe(200);
  });

  it('GET /:id 500 on error', async () => {
    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/schedules/1');
    expect(res.status).toBe(500);
  });

  it('GET /:id/shifts 400/404/200/500', async () => {
    let res = await request(app()).get('/api/schedules/abc/shifts');
    expect(res.status).toBe(400);

    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue(null);
    res = await request(app()).get('/api/schedules/1/shifts');
    expect(res.status).toBe(404);

    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).get('/api/schedules/1/shifts');
    expect(res.status).toBe(200);

    (ScheduleService.prototype.getScheduleWithShifts as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/schedules/1/shifts');
    expect(res.status).toBe(500);
  });

  it('POST / 500 on error', async () => {
    (ScheduleService.prototype.createSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/schedules').send({});
    expect(res.status).toBe(500);
  });

  it('PUT /:id 400/200/404/500', async () => {
    let res = await request(app()).put('/api/schedules/abc').send({});
    expect(res.status).toBe(400);

    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/schedules/1').send({});
    expect(res.status).toBe(200);

    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));
    res = await request(app()).put('/api/schedules/1').send({});
    expect(res.status).toBe(404);

    (ScheduleService.prototype.updateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).put('/api/schedules/1').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /:id 400/200/404/409/500', async () => {
    let res = await request(app()).delete('/api/schedules/abc');
    expect(res.status).toBe(400);

    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).delete('/api/schedules/1');
    expect(res.status).toBe(200);

    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Schedule not found'));
    res = await request(app()).delete('/api/schedules/1');
    expect(res.status).toBe(404);

    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Only draft schedules can be deleted'));
    res = await request(app()).delete('/api/schedules/1');
    expect(res.status).toBe(409);

    (ScheduleService.prototype.deleteSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).delete('/api/schedules/1');
    expect(res.status).toBe(500);
  });

  it('GET /department/:departmentId 200/400/500', async () => {
    let res = await request(app()).get('/api/schedules/department/abc');
    expect(res.status).toBe(400);

    (ScheduleService.prototype.getSchedulesByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/schedules/department/1');
    expect(res.status).toBe(200);

    (ScheduleService.prototype.getSchedulesByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/schedules/department/1');
    expect(res.status).toBe(500);
  });

  it('GET /user/:userId 200/400/500', async () => {
    let res = await request(app()).get('/api/schedules/user/abc');
    expect(res.status).toBe(400);

    (ScheduleService.prototype.getSchedulesByUser as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/schedules/user/1');
    expect(res.status).toBe(200);

    (ScheduleService.prototype.getSchedulesByUser as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/schedules/user/1');
    expect(res.status).toBe(500);
  });

  for (const action of ['publish', 'archive'] as const) {
    describe(`PATCH /:id/${action}`, () => {
      const method = `${action}Schedule` as keyof typeof ScheduleService.prototype;
      it('400/200/404/500', async () => {
        let res = await request(app()).patch(`/api/schedules/abc/${action}`);
        expect(res.status).toBe(400);

        (ScheduleService.prototype[method] as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
        res = await request(app()).patch(`/api/schedules/1/${action}`);
        expect(res.status).toBe(200);

        (ScheduleService.prototype[method] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('Schedule not found'));
        res = await request(app()).patch(`/api/schedules/1/${action}`);
        expect(res.status).toBe(404);

        (ScheduleService.prototype[method] as jest.Mock) = jest
          .fn()
          .mockRejectedValue(new Error('boom'));
        res = await request(app()).patch(`/api/schedules/1/${action}`);
        expect(res.status).toBe(500);
      });
    });
  }

  it('POST /:id/duplicate 400/201/500', async () => {
    let res = await request(app()).post('/api/schedules/abc/duplicate').send({});
    expect(res.status).toBe(400);

    res = await request(app()).post('/api/schedules/1/duplicate').send({});
    expect(res.status).toBe(400); // missing fields

    (ScheduleService.prototype.duplicateSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 2 });
    res = await request(app())
      .post('/api/schedules/1/duplicate')
      .send({ name: 'Copy', startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(res.status).toBe(201);

    (ScheduleService.prototype.duplicateSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app())
      .post('/api/schedules/1/duplicate')
      .send({ name: 'C', startDate: 'a', endDate: 'b' });
    expect(res.status).toBe(500);
  });

  it('POST /:id/generate 400/404/200/500', async () => {
    let res = await request(app()).post('/api/schedules/abc/generate');
    expect(res.status).toBe(400);

    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).post('/api/schedules/1/generate');
    expect(res.status).toBe(404);

    (ScheduleService.prototype.getScheduleById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    (ScheduleService.prototype.generateOptimizedSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ status: 'ok' });
    res = await request(app()).post('/api/schedules/1/generate');
    expect(res.status).toBe(200);

    (ScheduleService.prototype.generateOptimizedSchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/schedules/1/generate');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Shifts router – extended coverage
 * ------------------------------------------------------------------------- */

describe('shifts router (extended)', () => {
  const app = () => mountApp('/api/shifts', createShiftsRouter(fakePool));

  it('GET /templates 500 on error', async () => {
    (ShiftService.prototype.getAllShiftTemplates as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/shifts/templates');
    expect(res.status).toBe(500);
  });

  it('GET /templates/:id 400/404/200/500', async () => {
    let res = await request(app()).get('/api/shifts/templates/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).get('/api/shifts/templates/1');
    expect(res.status).toBe(404);

    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).get('/api/shifts/templates/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/shifts/templates/1');
    expect(res.status).toBe(500);
  });

  it('POST /templates 201/500', async () => {
    (ShiftService.prototype.createShiftTemplate as jest.Mock) = jest.fn().mockResolvedValue(7);
    (ShiftService.prototype.getShiftTemplateById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7 });
    let res = await request(app()).post('/api/shifts/templates').send({});
    expect(res.status).toBe(201);

    (ShiftService.prototype.createShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/shifts/templates').send({});
    expect(res.status).toBe(500);
  });

  it('PUT /templates/:id 400/404/200/500', async () => {
    let res = await request(app()).put('/api/shifts/templates/abc').send({});
    expect(res.status).toBe(400);

    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).put('/api/shifts/templates/1').send({});
    expect(res.status).toBe(404);

    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/shifts/templates/1').send({});
    expect(res.status).toBe(200);

    (ShiftService.prototype.updateShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).put('/api/shifts/templates/1').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /templates/:id 400/404/200/500', async () => {
    let res = await request(app()).delete('/api/shifts/templates/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest.fn().mockResolvedValue(false);
    res = await request(app()).delete('/api/shifts/templates/1');
    expect(res.status).toBe(404);

    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest.fn().mockResolvedValue(true);
    res = await request(app()).delete('/api/shifts/templates/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.deleteShiftTemplate as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).delete('/api/shifts/templates/1');
    expect(res.status).toBe(500);
  });

  it('GET / 500 on error', async () => {
    (ShiftService.prototype.getAllShifts as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/shifts');
    expect(res.status).toBe(500);
  });

  it('GET /:id 400/404/200/500', async () => {
    let res = await request(app()).get('/api/shifts/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.getShiftById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).get('/api/shifts/1');
    expect(res.status).toBe(404);

    (ShiftService.prototype.getShiftById as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    res = await request(app()).get('/api/shifts/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.getShiftById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/shifts/1');
    expect(res.status).toBe(500);
  });

  it('POST / 500 on error', async () => {
    (ShiftService.prototype.createShift as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/shifts').send({});
    expect(res.status).toBe(500);
  });

  it('PUT /:id 400/200/404/500', async () => {
    let res = await request(app()).put('/api/shifts/abc').send({});
    expect(res.status).toBe(400);

    (ShiftService.prototype.updateShift as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/shifts/1').send({});
    expect(res.status).toBe(200);

    (ShiftService.prototype.updateShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Shift not found'));
    res = await request(app()).put('/api/shifts/1').send({});
    expect(res.status).toBe(404);

    (ShiftService.prototype.updateShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).put('/api/shifts/1').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /:id 400/200/404/500', async () => {
    let res = await request(app()).delete('/api/shifts/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.deleteShift as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    res = await request(app()).delete('/api/shifts/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.deleteShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Shift not found'));
    res = await request(app()).delete('/api/shifts/1');
    expect(res.status).toBe(404);

    (ShiftService.prototype.deleteShift as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).delete('/api/shifts/1');
    expect(res.status).toBe(500);
  });

  it('GET /schedule/:id 400/200/500', async () => {
    let res = await request(app()).get('/api/shifts/schedule/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.getShiftsBySchedule as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/shifts/schedule/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.getShiftsBySchedule as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/shifts/schedule/1');
    expect(res.status).toBe(500);
  });

  it('GET /department/:id 400/200/500', async () => {
    let res = await request(app()).get('/api/shifts/department/abc');
    expect(res.status).toBe(400);

    (ShiftService.prototype.getShiftsByDepartment as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/shifts/department/1');
    expect(res.status).toBe(200);

    (ShiftService.prototype.getShiftsByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/shifts/department/1');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Employees router – extended coverage
 * ------------------------------------------------------------------------- */

describe('employees router (extended)', () => {
  const app = () => mountApp('/api/employees', createEmployeesRouter(fakePool));

  it('GET / 500 on error', async () => {
    (EmployeeService.prototype.getAllEmployees as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/employees');
    expect(res.status).toBe(500);
  });

  it('POST / 500 on error', async () => {
    (EmployeeService.prototype.createEmployee as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/employees').send({});
    expect(res.status).toBe(500);
  });

  it('PUT /:id 400/200/404/500', async () => {
    let res = await request(app()).put('/api/employees/abc').send({});
    expect(res.status).toBe(400);

    (EmployeeService.prototype.updateEmployee as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/employees/1').send({});
    expect(res.status).toBe(200);

    (EmployeeService.prototype.updateEmployee as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Employee not found'));
    res = await request(app()).put('/api/employees/1').send({});
    expect(res.status).toBe(404);

    (EmployeeService.prototype.updateEmployee as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).put('/api/employees/1').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /:id 400/200/404/500', async () => {
    let res = await request(app()).delete('/api/employees/abc');
    expect(res.status).toBe(400);

    (EmployeeService.prototype.deleteEmployee as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).delete('/api/employees/1');
    expect(res.status).toBe(200);

    (EmployeeService.prototype.deleteEmployee as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Employee not found'));
    res = await request(app()).delete('/api/employees/1');
    expect(res.status).toBe(404);

    (EmployeeService.prototype.deleteEmployee as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).delete('/api/employees/1');
    expect(res.status).toBe(500);
  });

  it('GET /department/:id 400/500', async () => {
    let res = await request(app()).get('/api/employees/department/abc');
    expect(res.status).toBe(400);

    (EmployeeService.prototype.getEmployeesByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/employees/department/1');
    expect(res.status).toBe(500);
  });

  it('GET /:id/skills 400/200/500', async () => {
    let res = await request(app()).get('/api/employees/abc/skills');
    expect(res.status).toBe(400);

    (EmployeeService.prototype.getEmployeeSkills as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/employees/1/skills');
    expect(res.status).toBe(200);

    (EmployeeService.prototype.getEmployeeSkills as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/employees/1/skills');
    expect(res.status).toBe(500);
  });

  it('POST /:id/skills 400/200/500', async () => {
    let res = await request(app()).post('/api/employees/abc/skills').send({});
    expect(res.status).toBe(400);

    (EmployeeService.prototype.addEmployeeSkill as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    res = await request(app()).post('/api/employees/1/skills').send({ skillId: 1, proficiencyLevel: 3 });
    expect(res.status).toBe(200);

    (EmployeeService.prototype.addEmployeeSkill as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/employees/1/skills').send({ skillId: 1, proficiencyLevel: 3 });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id/skills/:skillId 400/200/500', async () => {
    let res = await request(app()).delete('/api/employees/abc/skills/abc');
    expect(res.status).toBe(400);

    (EmployeeService.prototype.removeEmployeeSkill as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).delete('/api/employees/1/skills/1');
    expect(res.status).toBe(200);

    (EmployeeService.prototype.removeEmployeeSkill as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).delete('/api/employees/1/skills/1');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Departments router – extended coverage
 * ------------------------------------------------------------------------- */

describe('departments router (extended)', () => {
  const app = () => mountApp('/api/departments', createDepartmentsRouter(fakePool));

  it('GET / 200 (admin) / 200 (non-admin) / 500', async () => {
    (DepartmentService.prototype.getAllDepartments as jest.Mock) = jest.fn().mockResolvedValue([]);
    let res = await request(app()).get('/api/departments');
    expect(res.status).toBe(200);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/departments');
    expect(res.status).toBe(200);

    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/departments');
    expect(res.status).toBe(500);
  });

  it('GET /:id 200/404/403/500', async () => {
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    let res = await request(app()).get('/api/departments/1');
    expect(res.status).toBe(200);

    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).get('/api/departments/1');
    expect(res.status).toBe(404);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/departments/1');
    expect(res.status).toBe(403);

    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/departments/1');
    expect(res.status).toBe(500);
  });

  it('POST / 403/400/201/500', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    let res = await request(app()).post('/api/departments').send({});
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    res = await request(app()).post('/api/departments').send({});
    expect(res.status).toBe(400);

    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).post('/api/departments').send({ name: 'X', managerId: 5 });
    expect(res.status).toBe(400);

    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, role: 'employee' });
    res = await request(app()).post('/api/departments').send({ name: 'X', managerId: 5 });
    expect(res.status).toBe(400);

    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 5, role: 'manager' });
    (DepartmentService.prototype.createDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).post('/api/departments').send({ name: 'X', managerId: 5 });
    expect(res.status).toBe(201);

    (DepartmentService.prototype.createDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/departments').send({ name: 'X' });
    expect(res.status).toBe(500);
  });

  it('PUT /:id 403/200 admin / 403 manager-without-rights / 200 manager / 400 invalid manager / 500', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    let res = await request(app()).put('/api/departments/1').send({});
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (DepartmentService.prototype.updateDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/departments/1').send({});
    expect(res.status).toBe(200);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).put('/api/departments/1').send({});
    expect(res.status).toBe(403);

    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, managerId: 5 }]);
    (DepartmentService.prototype.updateDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    res = await request(app()).put('/api/departments/1').send({});
    expect(res.status).toBe(200);

    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).put('/api/departments/1').send({ managerId: 9 });
    expect(res.status).toBe(400);

    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 9, role: 'employee' });
    res = await request(app()).put('/api/departments/1').send({ managerId: 9 });
    expect(res.status).toBe(400);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (DepartmentService.prototype.updateDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).put('/api/departments/1').send({});
    expect(res.status).toBe(500);
  });

  it('DELETE /:id 403/200/409/500', async () => {
    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    let res = await request(app()).delete('/api/departments/1');
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).delete('/api/departments/1');
    expect(res.status).toBe(200);

    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Cannot delete department with active users'));
    res = await request(app()).delete('/api/departments/1');
    expect(res.status).toBe(409);

    (DepartmentService.prototype.deleteDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    res = await request(app()).delete('/api/departments/1');
    expect(res.status).toBe(500);
  });

  it('POST /:id/users 403/200/400/404/500', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    let res = await request(app()).post('/api/departments/1/users').send({});
    expect(res.status).toBe(403);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).post('/api/departments/1/users').send({});
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).post('/api/departments/1/users').send({ userId: 9 });
    expect(res.status).toBe(400);

    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({ id: 9 });
    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).post('/api/departments/1/users').send({ userId: 9 });
    expect(res.status).toBe(404);

    (DepartmentService.prototype.getDepartmentById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1 });
    (DepartmentService.prototype.addUserToDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).post('/api/departments/1/users').send({ userId: 9 });
    expect(res.status).toBe(200);

    (DepartmentService.prototype.addUserToDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/departments/1/users').send({ userId: 9 });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id/users/:userId 403/200/500', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    let res = await request(app()).delete('/api/departments/1/users/2');
    expect(res.status).toBe(403);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).delete('/api/departments/1/users/2');
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (DepartmentService.prototype.removeUserFromDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).delete('/api/departments/1/users/2');
    expect(res.status).toBe(200);

    (DepartmentService.prototype.removeUserFromDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).delete('/api/departments/1/users/2');
    expect(res.status).toBe(500);
  });

  it('GET /:id/stats 200/403/500', async () => {
    (DepartmentService.prototype.getDepartmentStatsByDepartment as jest.Mock) = jest
      .fn()
      .mockResolvedValue({});
    let res = await request(app()).get('/api/departments/1/stats');
    expect(res.status).toBe(200);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    (DepartmentService.prototype.getDepartmentsForUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    res = await request(app()).get('/api/departments/1/stats');
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (DepartmentService.prototype.getDepartmentStatsByDepartment as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/departments/1/stats');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Settings router – extended coverage
 * ------------------------------------------------------------------------- */

describe('settings router (extended)', () => {
  const app = () => mountApp('/api/settings', createSystemSettingsRouter(fakePool));

  it('GET / 500 on error', async () => {
    (SystemSettingsService.prototype.getAllSettings as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).get('/api/settings');
    expect(res.status).toBe(500);
  });

  it('GET /category/:c 200/500', async () => {
    (SystemSettingsService.prototype.getSettingsByCategory as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    let res = await request(app()).get('/api/settings/category/general');
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.getSettingsByCategory as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/settings/category/general');
    expect(res.status).toBe(500);
  });

  it('currency endpoints', async () => {
    (SystemSettingsService.prototype.getCurrency as jest.Mock) = jest.fn().mockResolvedValue('EUR');
    let res = await request(app()).get('/api/settings/currency');
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.getCurrency as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/settings/currency');
    expect(res.status).toBe(500);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    res = await request(app()).put('/api/settings/currency').send({ currency: 'EUR' });
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    res = await request(app()).put('/api/settings/currency').send({ currency: 'XXX' });
    expect(res.status).toBe(400);

    (SystemSettingsService.prototype.setCurrency as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    res = await request(app()).put('/api/settings/currency').send({ currency: 'USD' });
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.setCurrency as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).put('/api/settings/currency').send({ currency: 'USD' });
    expect(res.status).toBe(500);
  });

  it('time-period endpoints', async () => {
    (SystemSettingsService.prototype.getTimePeriod as jest.Mock) = jest
      .fn()
      .mockResolvedValue('monthly');
    let res = await request(app()).get('/api/settings/time-period');
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.getTimePeriod as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/settings/time-period');
    expect(res.status).toBe(500);

    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    res = await request(app()).put('/api/settings/time-period').send({ timePeriod: 'monthly' });
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    res = await request(app()).put('/api/settings/time-period').send({ timePeriod: 'xxx' });
    expect(res.status).toBe(400);

    (SystemSettingsService.prototype.setTimePeriod as jest.Mock) = jest
      .fn()
      .mockResolvedValue(undefined);
    res = await request(app()).put('/api/settings/time-period').send({ timePeriod: 'weekly' });
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.setTimePeriod as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).put('/api/settings/time-period').send({ timePeriod: 'weekly' });
    expect(res.status).toBe(500);
  });

  it('GET /:cat/:key 200/404/500', async () => {
    (SystemSettingsService.prototype.getSetting as jest.Mock) = jest.fn().mockResolvedValue('v');
    let res = await request(app()).get('/api/settings/cat/key');
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.getSetting as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).get('/api/settings/cat/key');
    expect(res.status).toBe(404);

    (SystemSettingsService.prototype.getSetting as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/settings/cat/key');
    expect(res.status).toBe(500);
  });

  it('PUT /:cat/:key full path coverage', async () => {
    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    let res = await request(app()).put('/api/settings/cat/key').send({ value: 'v' });
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    res = await request(app()).put('/api/settings/cat/key').send({});
    expect(res.status).toBe(400);

    res = await request(app()).put('/api/settings/general/currency').send({ value: 'XXX' });
    expect(res.status).toBe(400);

    res = await request(app()).put('/api/settings/schedule/default_time_period').send({ value: 'xxx' });
    expect(res.status).toBe(400);

    (SystemSettingsService.prototype.updateSetting as jest.Mock) = jest.fn().mockResolvedValue(false);
    res = await request(app()).put('/api/settings/cat/key').send({ value: 'v' });
    expect(res.status).toBe(404);

    (SystemSettingsService.prototype.updateSetting as jest.Mock) = jest.fn().mockResolvedValue(true);
    res = await request(app()).put('/api/settings/cat/key').send({ value: 'v' });
    expect(res.status).toBe(200);

    const protectedErr: any = new Error('System setting cannot be modified');
    (SystemSettingsService.prototype.updateSetting as jest.Mock) = jest
      .fn()
      .mockRejectedValue(protectedErr);
    res = await request(app()).put('/api/settings/cat/key').send({ value: 'v' });
    expect(res.status).toBe(403);

    (SystemSettingsService.prototype.updateSetting as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).put('/api/settings/cat/key').send({ value: 'v' });
    expect(res.status).toBe(500);
  });

  it('POST /:cat/:key/reset 403/404/200/500', async () => {
    currentUser = { id: 5, role: 'manager', email: 'm@x' };
    let res = await request(app()).post('/api/settings/cat/key/reset');
    expect(res.status).toBe(403);

    currentUser = { id: 1, role: 'admin', email: 'a@x' };
    (SystemSettingsService.prototype.resetSetting as jest.Mock) = jest.fn().mockResolvedValue(false);
    res = await request(app()).post('/api/settings/cat/key/reset');
    expect(res.status).toBe(404);

    (SystemSettingsService.prototype.resetSetting as jest.Mock) = jest.fn().mockResolvedValue(true);
    res = await request(app()).post('/api/settings/cat/key/reset');
    expect(res.status).toBe(200);

    (SystemSettingsService.prototype.resetSetting as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    res = await request(app()).post('/api/settings/cat/key/reset');
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * TimeOff / ShiftSwap / Preferences extras
 * ------------------------------------------------------------------------- */

describe('time-off router (extended)', () => {
  const app = () => mountApp('/api/time-off', createTimeOffRouter(fakePool));

  it('GET /:id own / forbidden / not found / 500', async () => {
    (TimeOffService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    let res = await request(app()).get('/api/time-off/1');
    expect(res.status).toBe(404);

    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (TimeOffService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, userId: 999 });
    res = await request(app()).get('/api/time-off/1');
    expect(res.status).toBe(403);

    (TimeOffService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, userId: 5 });
    res = await request(app()).get('/api/time-off/1');
    expect(res.status).toBe(200);

    (TimeOffService.prototype.getById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/time-off/1');
    expect(res.status).toBe(500);
  });

  it('GET / 500 on error / 200 employee', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (TimeOffService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    let res = await request(app()).get('/api/time-off');
    expect(res.status).toBe(200);

    (TimeOffService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/time-off');
    expect(res.status).toBe(500);
  });

  it('POST 400 on error', async () => {
    (TimeOffService.prototype.create as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(app()).post('/api/time-off').send({});
    expect(res.status).toBe(400);
  });

  for (const action of ['approve', 'reject'] as const) {
    it(`POST /:id/${action} 200/404/409`, async () => {
      (TimeOffService.prototype[action] as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
      let res = await request(app()).post(`/api/time-off/1/${action}`).send({});
      expect(res.status).toBe(200);

      (TimeOffService.prototype[action] as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('Time-off request not found'));
      res = await request(app()).post(`/api/time-off/1/${action}`).send({});
      expect(res.status).toBe(404);

      (TimeOffService.prototype[action] as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('already done'));
      res = await request(app()).post(`/api/time-off/1/${action}`).send({});
      expect(res.status).toBe(409);
    });
  }

  it('POST /:id/cancel handles 200/404/403/409', async () => {
    const cancel = (mock: jest.Mock) => {
      (TimeOffService.prototype.cancel as jest.Mock) = mock;
    };
    cancel(jest.fn().mockResolvedValue({ id: 1 }));
    let res = await request(app()).post('/api/time-off/1/cancel');
    expect(res.status).toBe(200);

    cancel(jest.fn().mockRejectedValue(new Error('Time-off request not found')));
    res = await request(app()).post('/api/time-off/1/cancel');
    expect(res.status).toBe(404);

    cancel(jest.fn().mockRejectedValue(new Error('Forbidden')));
    res = await request(app()).post('/api/time-off/1/cancel');
    expect(res.status).toBe(403);

    cancel(jest.fn().mockRejectedValue(new Error('already')));
    res = await request(app()).post('/api/time-off/1/cancel');
    expect(res.status).toBe(409);
  });
});

describe('shift-swap router (extended)', () => {
  const app = () => mountApp('/api/shift-swap', createShiftSwapRouter(fakePool));

  it('GET /:id own/manager/forbidden/missing/500', async () => {
    (ShiftSwapService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    let res = await request(app()).get('/api/shift-swap/1');
    expect(res.status).toBe(404);

    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (ShiftSwapService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ requesterUserId: 5, targetUserId: 6 });
    res = await request(app()).get('/api/shift-swap/1');
    expect(res.status).toBe(200);

    (ShiftSwapService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ requesterUserId: 99, targetUserId: 999 });
    res = await request(app()).get('/api/shift-swap/1');
    expect(res.status).toBe(403);

    (ShiftSwapService.prototype.getById as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    res = await request(app()).get('/api/shift-swap/1');
    expect(res.status).toBe(500);
  });

  it('GET / 500 on error / employee path', async () => {
    currentUser = { id: 5, role: 'employee', email: 'e@x' };
    (ShiftSwapService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    let res = await request(app()).get('/api/shift-swap');
    expect(res.status).toBe(500);

    (ShiftSwapService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    res = await request(app()).get('/api/shift-swap');
    expect(res.status).toBe(200);
  });

  it('approve/decline/cancel error paths', async () => {
    (ShiftSwapService.prototype.approve as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Swap not found'));
    let res = await request(app()).post('/api/shift-swap/1/approve');
    expect(res.status).toBe(404);

    (ShiftSwapService.prototype.approve as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('already'));
    res = await request(app()).post('/api/shift-swap/1/approve');
    expect(res.status).toBe(409);

    (ShiftSwapService.prototype.decline as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    res = await request(app()).post('/api/shift-swap/1/decline');
    expect(res.status).toBe(200);

    (ShiftSwapService.prototype.decline as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Swap not found'));
    res = await request(app()).post('/api/shift-swap/1/decline');
    expect(res.status).toBe(404);

    (ShiftSwapService.prototype.decline as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('already'));
    res = await request(app()).post('/api/shift-swap/1/decline');
    expect(res.status).toBe(409);

    (ShiftSwapService.prototype.cancel as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    res = await request(app()).post('/api/shift-swap/1/cancel');
    expect(res.status).toBe(200);

    (ShiftSwapService.prototype.cancel as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('not found'));
    res = await request(app()).post('/api/shift-swap/1/cancel');
    expect(res.status).toBe(404);

    (ShiftSwapService.prototype.cancel as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Forbidden'));
    res = await request(app()).post('/api/shift-swap/1/cancel');
    expect(res.status).toBe(403);

    (ShiftSwapService.prototype.cancel as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('already'));
    res = await request(app()).post('/api/shift-swap/1/cancel');
    expect(res.status).toBe(409);
  });
});

describe('preferences router (extended)', () => {
  const app = () => mountApp('/api/preferences', createPreferencesRouter(fakePool));

  it('PUT /me 400 on validation', async () => {
    (PreferencesService.prototype.upsert as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(app()).put('/api/preferences/me').send({});
    expect(res.status).toBe(400);
  });

  it('GET /:userId returns', async () => {
    (PreferencesService.prototype.getByUserId as jest.Mock) = jest.fn().mockResolvedValue({});
    const res = await request(app()).get('/api/preferences/2');
    expect(res.status).toBe(200);
  });

  it('PUT /:userId 200 / 400', async () => {
    (PreferencesService.prototype.upsert as jest.Mock) = jest.fn().mockResolvedValue({});
    let res = await request(app()).put('/api/preferences/2').send({});
    expect(res.status).toBe(200);

    (PreferencesService.prototype.upsert as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    res = await request(app()).put('/api/preferences/2').send({});
    expect(res.status).toBe(400);
  });
});

/* ---------------------------------------------------------------------------
 * On-call extras
 * ------------------------------------------------------------------------- */

describe('on-call router (extended)', () => {
  const app = () => mountApp('/api/on-call', createOnCallRouter(fakePool));

  it('POST /periods 400 on error', async () => {
    (OnCallService.prototype.createPeriod as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    const res = await request(app()).post('/api/on-call/periods').send({});
    expect(res.status).toBe(400);
  });

  it('GET /periods/:id 200/404', async () => {
    (OnCallService.prototype.getPeriodById as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    let res = await request(app()).get('/api/on-call/periods/1');
    expect(res.status).toBe(200);

    (OnCallService.prototype.getPeriodById as jest.Mock) = jest.fn().mockResolvedValue(null);
    res = await request(app()).get('/api/on-call/periods/1');
    expect(res.status).toBe(404);
  });

  it('PUT /periods/:id 200/404/400', async () => {
    (OnCallService.prototype.updatePeriod as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    let res = await request(app()).put('/api/on-call/periods/1').send({});
    expect(res.status).toBe(200);

    (OnCallService.prototype.updatePeriod as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Period not found'));
    res = await request(app()).put('/api/on-call/periods/1').send({});
    expect(res.status).toBe(404);

    (OnCallService.prototype.updatePeriod as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    res = await request(app()).put('/api/on-call/periods/1').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /periods/:id 200/404', async () => {
    (OnCallService.prototype.deletePeriod as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    let res = await request(app()).delete('/api/on-call/periods/1');
    expect(res.status).toBe(200);

    (OnCallService.prototype.deletePeriod as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Period not found'));
    res = await request(app()).delete('/api/on-call/periods/1');
    expect(res.status).toBe(404);
  });

  it('GET /periods/:id/assignments 200', async () => {
    (OnCallService.prototype.listAssignments as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(app()).get('/api/on-call/periods/1/assignments');
    expect(res.status).toBe(200);
  });

  it('POST /periods/:id/assign error paths', async () => {
    (OnCallService.prototype.assign as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('Period not found'));
    let res = await request(app()).post('/api/on-call/periods/1/assign').send({ userId: 7 });
    expect(res.status).toBe(404);

    (OnCallService.prototype.assign as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('max capacity reached'));
    res = await request(app()).post('/api/on-call/periods/1/assign').send({ userId: 7 });
    expect(res.status).toBe(409);

    (OnCallService.prototype.assign as jest.Mock) = jest.fn().mockRejectedValue(new Error('bad'));
    res = await request(app()).post('/api/on-call/periods/1/assign').send({ userId: 7 });
    expect(res.status).toBe(400);
  });

  it('DELETE /periods/:id/assign/:userId 404 when not removed', async () => {
    (OnCallService.prototype.unassign as jest.Mock) = jest.fn().mockResolvedValue(false);
    const res = await request(app()).delete('/api/on-call/periods/1/assign/7');
    expect(res.status).toBe(404);
  });
});

/* ---------------------------------------------------------------------------
 * Two-factor extras
 * ------------------------------------------------------------------------- */

describe('two-factor router (extended)', () => {
  const app = () => mountApp('/api/auth/2fa', createTwoFactorRouter(fakePool));

  it('POST /enable 400 on error', async () => {
    (TwoFactorService.prototype.confirmEnable as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    const res = await request(app()).post('/api/auth/2fa/enable').send({});
    expect(res.status).toBe(400);
  });
});

/* ---------------------------------------------------------------------------
 * Audit logs
 * ------------------------------------------------------------------------- */

describe('audit-logs router (extended)', () => {
  const app = () => mountApp('/api/audit-logs', createAuditLogsRouter(fakePool));

  it('GET /:id 200', async () => {
    (AuditLogService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(app()).get('/api/audit-logs/1');
    expect(res.status).toBe(200);
  });
});

/* ---------------------------------------------------------------------------
 * Calendar extras
 * ------------------------------------------------------------------------- */

describe('calendar router (extended)', () => {
  const app = () => mountApp('/api/calendar', createCalendarRouter(fakePool));

  it('GET /me does not require auth via 200 on token resolved', async () => {
    (CalendarService.prototype.getOrCreateToken as jest.Mock) = jest.fn().mockResolvedValue('x');
    const res = await request(app()).post('/api/calendar/token');
    expect(res.status).toBe(200);
  });
});

/* ---------------------------------------------------------------------------
 * Notifications extras
 * ------------------------------------------------------------------------- */

describe('notifications router (extended)', () => {
  const app = () => mountApp('/api/notifications', createNotificationsRouter(fakePool));

  it('PATCH /:id/read 200 on success', async () => {
    (NotificationService.prototype.markRead as jest.Mock) = jest.fn().mockResolvedValue(true);
    const res = await request(app()).patch('/api/notifications/1/read');
    expect(res.status).toBe(200);
  });
});

/* ---------------------------------------------------------------------------
 * Bulk import extras
 * ------------------------------------------------------------------------- */

describe('bulk-import router (extended)', () => {
  const app = () => mountApp('/api/import', createBulkImportRouter(fakePool));

  it('POST /employees 400 missing csv', async () => {
    const res = await request(app()).post('/api/import/employees').send({});
    expect(res.status).toBe(400);
  });

  it('POST /employees 400 with errors', async () => {
    (BulkImportService.prototype.importEmployees as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ inserted: 0, errors: [{ row: 1, error: 'bad' }] });
    const res = await request(app()).post('/api/import/employees').send({ csv: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /employees 500 on throw', async () => {
    (BulkImportService.prototype.importEmployees as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/import/employees').send({ csv: 'x' });
    expect(res.status).toBe(500);
  });

  it('POST /shifts 400 missing csv', async () => {
    const res = await request(app()).post('/api/import/shifts').send({});
    expect(res.status).toBe(400);
  });

  it('POST /shifts 400 with errors', async () => {
    (BulkImportService.prototype.importShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ inserted: 0, errors: [{ row: 1, error: 'bad' }] });
    const res = await request(app()).post('/api/import/shifts').send({ csv: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /shifts 500 on throw', async () => {
    (BulkImportService.prototype.importShifts as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/import/shifts').send({ csv: 'x' });
    expect(res.status).toBe(500);
  });
});

/* ---------------------------------------------------------------------------
 * Directory extras
 * ------------------------------------------------------------------------- */

describe('directory router (extended)', () => {
  const app = () => mountApp('/api/directory', createDirectoryRouter(fakePool));

  it('GET /users/:id/vcard 404 when missing', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(app()).get('/api/directory/users/1/vcard');
    expect(res.status).toBe(404);
  });

  it('GET /me 404 when profile missing', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(app()).get('/api/directory/me');
    expect(res.status).toBe(404);
  });

  it('GET /me 200 when profile present', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'a@x' });
    const res = await request(app()).get('/api/directory/me');
    expect(res.status).toBe(200);
  });

  it('GET /users/:id 404 when profile missing', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(app()).get('/api/directory/users/2');
    expect(res.status).toBe(404);
  });

  it('PUT /users/:id/fields 200 + service error -> 400', async () => {
    (UserDirectoryService.prototype.setFields as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 2 });
    const ok = await request(app())
      .put('/api/directory/users/2/fields')
      .send({ fields: [{ key: 'k', value: 'v' }] });
    expect(ok.status).toBe(200);

    (UserDirectoryService.prototype.setFields as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('bad'));
    const bad = await request(app())
      .put('/api/directory/users/2/fields')
      .send({ fields: 'not-array' });
    expect(bad.status).toBe(400);
  });

  it('DELETE /users/:id/fields/:key – 200 / 404', async () => {
    (UserDirectoryService.prototype.removeField as jest.Mock) = jest.fn().mockResolvedValue(true);
    expect((await request(app()).delete('/api/directory/users/1/fields/k')).status).toBe(200);

    (UserDirectoryService.prototype.removeField as jest.Mock) = jest.fn().mockResolvedValue(false);
    expect((await request(app()).delete('/api/directory/users/1/fields/k')).status).toBe(404);
  });

  it('GET /users/:id/vcard 200 returns vcf', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'a@x' });
    (UserDirectoryService.prototype.exportVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue('BEGIN:VCARD');
    const res = await request(app()).get('/api/directory/users/1/vcard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('BEGIN:VCARD');
  });

  it('GET /vcard.vcf 400 when ids missing, 200 when present', async () => {
    const bad = await request(app()).get('/api/directory/vcard.vcf');
    expect(bad.status).toBe(400);

    (UserDirectoryService.prototype.exportVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue('BEGIN:VCARD');
    const ok = await request(app()).get('/api/directory/vcard.vcf?ids=1,2');
    expect(ok.status).toBe(200);
  });

  it('POST /import-vcard 400 on missing body, 200 on success', async () => {
    const bad = await request(app()).post('/api/directory/import-vcard').send({});
    expect(bad.status).toBe(400);

    (UserDirectoryService.prototype.importVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ created: 1, updated: 0 });
    const ok = await request(app())
      .post('/api/directory/import-vcard')
      .set('Content-Type', 'application/json')
      .send({ vcf: 'BEGIN:VCARD\nEND:VCARD', defaultPassword: 'pw' });
    expect(ok.status).toBe(200);
  });
});

describe('events router', () => {
  it('GET /stream emits hello frame and unsubscribes on close', async () => {
    const { createEventsRouter } = await import('../routes/events');
    const app = mountApp('/api/events', createEventsRouter());
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => {
      const req = http.request({ port, path: '/api/events/stream' }, (res) => {
        res.on('data', (chunk) => {
          if (chunk.toString().includes('hello')) {
            req.destroy();
          }
        });
        res.on('close', () => resolve());
      });
      req.on('error', () => resolve());
      req.end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

/* ---------------------------------------------------------------------------
 * Auth router – extra paths
 * ------------------------------------------------------------------------- */

describe('auth router (extended)', () => {
  const app = () => mountApp('/api/auth', createAuthRouter(fakePool));

  it('POST /login 400 on missing fields', async () => {
    const res = await request(app()).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('POST /login 401 on invalid credentials', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(app()).post('/api/auth/login').send({
      email: 'x@y.com',
      password: 'bad',
    });
    expect(res.status).toBe(401);
  });

  it('POST /login 200 on valid credentials', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue({
      id: 1,
      email: 'a@x',
      firstName: 'A',
      lastName: 'B',
      role: 'admin',
    });
    const res = await request(app()).post('/api/auth/login').send({
      email: 'a@x',
      password: 'pw',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.token).toBe('string');
  });

  it('POST /login 401 on service throw', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockRejectedValue(new Error('x'));
    const res = await request(app()).post('/api/auth/login').send({
      email: 'a@x',
      password: 'pw',
    });
    expect(res.status).toBe(401);
  });

  it('GET /verify 200', async () => {
    const res = await request(app()).get('/api/auth/verify');
    expect(res.status).toBe(200);
  });

  it('POST /refresh 200', async () => {
    const res = await request(app()).post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.token).toBe('string');
  });

  it('POST /logout 200', async () => {
    const res = await request(app()).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});
