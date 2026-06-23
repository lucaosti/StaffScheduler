/**
 * Route error-handler coverage supplement.
 * Covers catch blocks (→ 500 responses) and conditional branches not exercised
 * by the happy-path tests in routes.expanded.test.ts.
 *
 * Files targeted:
 *   routes/onCall.ts       — GET /me, GET /periods, GET /periods/:id,
 *                            GET /periods/:id/assignments, DELETE /assign/:userId
 *   routes/notifications.ts — GET /, GET /unread-count, PATCH /:id/read,
 *                             PATCH /read-all
 *   routes/reports.ts      — missing params (400), service errors (500)
 *   routes/twoFactor.ts    — POST /setup, /disable, /verify catch blocks
 *   routes/preferences.ts  — GET /me catch, GET /:userId catch
 *   routes/employees.ts    — scope filter, dept string parse, pagination, GET /:id error
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// ── Auth middleware stub ──────────────────────────────────────────────────────
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
  userHasPermission: () => true,
}));

// ── Service mocks ─────────────────────────────────────────────────────────────
jest.mock('../services/OnCallService');
jest.mock('../services/NotificationService');
jest.mock('../services/ReportsService');
jest.mock('../services/TwoFactorService');
jest.mock('../services/PreferencesService');
jest.mock('../services/EmployeeService');
jest.mock('../services/AuditLogService');

import { OnCallService } from '../services/OnCallService';
import { NotificationService } from '../services/NotificationService';
import { ReportsService } from '../services/ReportsService';
import { TwoFactorService } from '../services/TwoFactorService';
import { PreferencesService } from '../services/PreferencesService';
import { EmployeeService } from '../services/EmployeeService';

import { createOnCallRouter } from '../routes/onCall';
import { createNotificationsRouter } from '../routes/notifications';
import { createReportsRouter } from '../routes/reports';
import { createTwoFactorRouter } from '../routes/twoFactor';
import { createPreferencesRouter } from '../routes/preferences';
import { createEmployeesRouter } from '../routes/employees';

const fakePool = {} as never;

const mount = (prefix: string, router: express.Router) => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

// ─── routes/onCall.ts ─────────────────────────────────────────────────────────

describe('onCall route error handlers', () => {
  const app = () => mount('/api/on-call', createOnCallRouter(fakePool));

  it('GET /me 500 when service throws', async () => {
    (OnCallService.prototype.listForUser as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/on-call/me');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('GET /periods 500 when service throws', async () => {
    (OnCallService.prototype.listPeriods as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/on-call/periods');
    expect(res.status).toBe(500);
  });

  it('GET /periods/:id 500 when service throws unexpected error', async () => {
    (OnCallService.prototype.getPeriodById as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/on-call/periods/1');
    expect(res.status).toBe(500);
  });

  it('GET /periods/:id/assignments 500 when service throws', async () => {
    (OnCallService.prototype.listAssignments as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/on-call/periods/1/assignments');
    expect(res.status).toBe(500);
  });

  it('DELETE /periods/:id/assign/:userId 500 when service throws', async () => {
    (OnCallService.prototype.unassign as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).delete('/api/on-call/periods/1/assign/7');
    expect(res.status).toBe(500);
  });
});

// ─── routes/notifications.ts ──────────────────────────────────────────────────

describe('notifications route error handlers', () => {
  const app = () => mount('/api/notifications', createNotificationsRouter(fakePool));

  it('GET / 500 when service throws', async () => {
    (NotificationService.prototype.listForUser as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/notifications');
    expect(res.status).toBe(500);
  });

  it('GET /unread-count 500 when service throws', async () => {
    (NotificationService.prototype.unreadCount as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/notifications/unread-count');
    expect(res.status).toBe(500);
  });

  it('PATCH /:id/read 500 when service throws', async () => {
    (NotificationService.prototype.markRead as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).patch('/api/notifications/1/read');
    expect(res.status).toBe(500);
  });

  it('PATCH /read-all 500 when service throws', async () => {
    (NotificationService.prototype.markAllRead as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).patch('/api/notifications/read-all');
    expect(res.status).toBe(500);
  });
});

// ─── routes/reports.ts ────────────────────────────────────────────────────────

describe('reports route — missing params and error handlers', () => {
  const app = () => mount('/api/reports', createReportsRouter(fakePool));

  it('GET /hours-worked 500 when service throws', async () => {
    (ReportsService.prototype.hoursWorkedByUser as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/reports/hours-worked?start=2026-01-01&end=2026-01-31');
    expect(res.status).toBe(500);
  });

  it('GET /cost-by-department 400 when start or end missing', async () => {
    const res = await request(app()).get('/api/reports/cost-by-department?start=2026-01-01');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /cost-by-department 500 when service throws', async () => {
    (ReportsService.prototype.costByDepartment as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/reports/cost-by-department?start=2026-01-01&end=2026-01-31');
    expect(res.status).toBe(500);
  });

  it('GET /fairness/:scheduleId 400 when id is not a positive integer', async () => {
    const res = await request(app()).get('/api/reports/fairness/abc');
    expect(res.status).toBe(400);
  });

  it('GET /fairness/:scheduleId 500 when service throws', async () => {
    (ReportsService.prototype.fairnessForSchedule as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/reports/fairness/5');
    expect(res.status).toBe(500);
  });
});

// ─── routes/twoFactor.ts ─────────────────────────────────────────────────────

describe('twoFactor route error handlers', () => {
  const app = () => mount('/api/auth/2fa', createTwoFactorRouter(fakePool));

  it('POST /setup 500 when service throws', async () => {
    (TwoFactorService.prototype.beginSetup as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).post('/api/auth/2fa/setup').send({});
    expect(res.status).toBe(500);
  });

  it('POST /disable 400 when no code is supplied', async () => {
    const res = await request(app()).post('/api/auth/2fa/disable').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /disable 401 when the code is invalid', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock).mockResolvedValueOnce(false);
    (TwoFactorService.prototype.consumeRecoveryCode as jest.Mock).mockResolvedValueOnce(false);
    const res = await request(app()).post('/api/auth/2fa/disable').send({ code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOTP_INVALID');
  });

  it('POST /disable 500 when service throws', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock).mockResolvedValueOnce(true);
    (TwoFactorService.prototype.disable as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).post('/api/auth/2fa/disable').send({ code: '123456' });
    expect(res.status).toBe(500);
  });

  it('POST /verify 500 when service throws', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).post('/api/auth/2fa/verify').send({ code: '123456' });
    expect(res.status).toBe(500);
  });
});

// ─── routes/preferences.ts ───────────────────────────────────────────────────

describe('preferences route error handlers', () => {
  const app = () => mount('/api/preferences', createPreferencesRouter(fakePool));

  it('GET /me 500 when service throws', async () => {
    (PreferencesService.prototype.getByUserId as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/preferences/me');
    expect(res.status).toBe(500);
  });

  it('GET /:userId 500 when service throws', async () => {
    (PreferencesService.prototype.getByUserId as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/preferences/2');
    expect(res.status).toBe(500);
  });
});

// ─── routes/employees.ts — branches + error handler ─────────────────────────

describe('employees route — scope filter, dept parse, pagination, error', () => {
  const app = () => mount('/api/employees', createEmployeesRouter(fakePool));

  beforeEach(() => {
    (EmployeeService.prototype.getAllEmployees as jest.Mock).mockResolvedValue([]);
    (EmployeeService.prototype.countEmployees as jest.Mock).mockResolvedValue(0);
  });

  it('GET / applies orgUnitIds scope from req.user.allowedOrgUnitIds when non-null', async () => {
    // Override the authenticate stub to set allowedOrgUnitIds
    const authMock = require('../middleware/auth');
    const origAuth = authMock.authenticate;
    authMock.authenticate = (req: any, _res: any, next: any) => {
      req.user = {
        id: 1, email: 'a@x', isActive: true,
        permissions: require('./helpers/permissions').ALL_PERMISSIONS,
        allowedOrgUnitIds: [3, 5],
      };
      next();
    };
    const res = await request(app()).get('/api/employees');
    authMock.authenticate = origAuth;
    expect(res.status).toBe(200);
    expect(EmployeeService.prototype.getAllEmployees).toHaveBeenCalled();
  });

  it('GET / parses numeric department query param as departmentId', async () => {
    const res = await request(app()).get('/api/employees?department=4');
    expect(res.status).toBe(200);
    const call = (EmployeeService.prototype.getAllEmployees as jest.Mock).mock.calls[0];
    expect(call[0]?.departmentId).toBe(4);
  });

  it('GET / passes non-numeric department as departmentName', async () => {
    const res = await request(app()).get('/api/employees?department=Engineering');
    expect(res.status).toBe(200);
    const call = (EmployeeService.prototype.getAllEmployees as jest.Mock).mock.calls[0];
    expect(call[0]?.departmentName).toBe('Engineering');
  });

  it('GET / uses pagination when page param is provided', async () => {
    const res = await request(app()).get('/api/employees?page=1&pageSize=10');
    expect(res.status).toBe(200);
    expect(EmployeeService.prototype.countEmployees).toHaveBeenCalled();
  });

  it('GET /:id 500 when service throws', async () => {
    (EmployeeService.prototype.getEmployeeById as jest.Mock).mockRejectedValueOnce(new Error('db'));
    const res = await request(app()).get('/api/employees/1');
    expect(res.status).toBe(500);
  });
});
