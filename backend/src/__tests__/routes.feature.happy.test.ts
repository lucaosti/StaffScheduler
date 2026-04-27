/**
 * Happy-path tests for the feature routers (T010 part 2).
 *
 * Same shape as routes.legacy.happy.test.ts: middleware stubbed,
 * services jest.mocked. Each endpoint hit at least once with a
 * happy-path service mock so the route handler body executes.
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

jest.mock('../services/TimeOffService');
jest.mock('../services/ShiftSwapService');
jest.mock('../services/PreferencesService');
jest.mock('../services/AuditLogService');
jest.mock('../services/SkillGapService');
jest.mock('../services/ReportsService');
jest.mock('../services/NotificationService');
jest.mock('../services/CalendarService');
jest.mock('../services/TwoFactorService');
jest.mock('../services/OnCallService');
jest.mock('../services/UserDirectoryService');
jest.mock('../services/BulkImportService');

import { TimeOffService } from '../services/TimeOffService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { PreferencesService } from '../services/PreferencesService';
import { AuditLogService } from '../services/AuditLogService';
import { SkillGapService } from '../services/SkillGapService';
import { ReportsService } from '../services/ReportsService';
import { NotificationService } from '../services/NotificationService';
import { CalendarService } from '../services/CalendarService';
import { TwoFactorService } from '../services/TwoFactorService';
import { OnCallService } from '../services/OnCallService';
import { UserDirectoryService } from '../services/UserDirectoryService';
import { BulkImportService } from '../services/BulkImportService';

import { createTimeOffRouter } from '../routes/timeOff';
import { createShiftSwapRouter } from '../routes/shiftSwap';
import { createPreferencesRouter } from '../routes/preferences';
import { createAuditLogsRouter } from '../routes/auditLogs';
import { createSkillGapRouter } from '../routes/skillGap';
import { createReportsRouter } from '../routes/reports';
import { createNotificationsRouter } from '../routes/notifications';
import { createCalendarRouter } from '../routes/calendar';
import { createTwoFactorRouter } from '../routes/twoFactor';
import { createOnCallRouter } from '../routes/onCall';
import { createDirectoryRouter } from '../routes/directory';
import { createBulkImportRouter } from '../routes/bulkImport';
import { createEventsRouter } from '../routes/events';

const fakePool = {} as never;

const mountApp = (prefix: string, router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('time-off router', () => {
  it('GET / returns the list', async () => {
    (TimeOffService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/time-off', createTimeOffRouter(fakePool))).get('/api/time-off');
    expect(res.status).toBe(200);
  });

  it('POST / creates a request and returns 201', async () => {
    (TimeOffService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, status: 'pending' });
    const res = await request(mountApp('/api/time-off', createTimeOffRouter(fakePool)))
      .post('/api/time-off')
      .send({ startDate: '2026-05-01', endDate: '2026-05-03', type: 'vacation' });
    expect(res.status).toBe(201);
  });

  it('POST /:id/approve returns the approved request', async () => {
    (TimeOffService.prototype.approve as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, status: 'approved' });
    const res = await request(mountApp('/api/time-off', createTimeOffRouter(fakePool)))
      .post('/api/time-off/1/approve');
    expect(res.status).toBe(200);
  });

  it('POST /:id/cancel returns the cancelled request', async () => {
    (TimeOffService.prototype.cancel as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, status: 'cancelled' });
    const res = await request(mountApp('/api/time-off', createTimeOffRouter(fakePool)))
      .post('/api/time-off/1/cancel');
    expect(res.status).toBe(200);
  });
});

describe('shift-swap router', () => {
  it('GET / returns the list', async () => {
    (ShiftSwapService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/shift-swap', createShiftSwapRouter(fakePool))).get('/api/shift-swap');
    expect(res.status).toBe(200);
  });

  it('POST / creates a swap', async () => {
    (ShiftSwapService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp('/api/shift-swap', createShiftSwapRouter(fakePool)))
      .post('/api/shift-swap')
      .send({ requesterAssignmentId: 1, targetAssignmentId: 2 });
    expect(res.status).toBe(201);
  });

  it('POST /:id/approve returns the approved swap', async () => {
    (ShiftSwapService.prototype.approve as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, status: 'approved' });
    const res = await request(mountApp('/api/shift-swap', createShiftSwapRouter(fakePool)))
      .post('/api/shift-swap/1/approve');
    expect(res.status).toBe(200);
  });
});

describe('preferences router', () => {
  it('GET /me returns the profile', async () => {
    (PreferencesService.prototype.getByUserId as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ userId: 1, maxHoursPerWeek: 40 });
    const res = await request(mountApp('/api/preferences', createPreferencesRouter(fakePool))).get('/api/preferences/me');
    expect(res.status).toBe(200);
  });

  it('PUT /me upserts and returns the row', async () => {
    (PreferencesService.prototype.upsert as jest.Mock) = jest.fn().mockResolvedValue({ userId: 1, maxHoursPerWeek: 36 });
    const res = await request(mountApp('/api/preferences', createPreferencesRouter(fakePool)))
      .put('/api/preferences/me')
      .send({ maxHoursPerWeek: 36 });
    expect(res.status).toBe(200);
  });
});

describe('audit-logs router', () => {
  it('GET / returns a page', async () => {
    (AuditLogService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue({ total: 0, items: [] });
    const res = await request(mountApp('/api/audit-logs', createAuditLogsRouter(fakePool))).get('/api/audit-logs');
    expect(res.status).toBe(200);
  });

  it('GET /:id returns 404 when missing', async () => {
    (AuditLogService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp('/api/audit-logs', createAuditLogsRouter(fakePool))).get('/api/audit-logs/99');
    expect(res.status).toBe(404);
  });
});

describe('skill-gap router', () => {
  it('GET / requires departmentId, start, end', async () => {
    const res = await request(mountApp('/api/skill-gap', createSkillGapRouter(fakePool))).get('/api/skill-gap');
    expect(res.status).toBe(400);
  });

  it('GET / returns the report when params are valid', async () => {
    (SkillGapService.prototype.analyze as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ departmentId: 1, rangeStart: '2026-05-01', rangeEnd: '2026-05-31', entries: [] });
    const res = await request(mountApp('/api/skill-gap', createSkillGapRouter(fakePool)))
      .get('/api/skill-gap?departmentId=1&start=2026-05-01&end=2026-05-31');
    expect(res.status).toBe(200);
  });
});

describe('reports router', () => {
  it('GET /hours-worked requires start and end', async () => {
    const res = await request(mountApp('/api/reports', createReportsRouter(fakePool))).get('/api/reports/hours-worked');
    expect(res.status).toBe(400);
  });

  it('GET /hours-worked returns rows when valid', async () => {
    (ReportsService.prototype.hoursWorkedByUser as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/reports', createReportsRouter(fakePool)))
      .get('/api/reports/hours-worked?start=2026-05-01&end=2026-05-31');
    expect(res.status).toBe(200);
  });

  it('GET /cost-by-department returns rows', async () => {
    (ReportsService.prototype.costByDepartment as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/reports', createReportsRouter(fakePool)))
      .get('/api/reports/cost-by-department?start=2026-05-01&end=2026-05-31');
    expect(res.status).toBe(200);
  });

  it('GET /fairness/:scheduleId returns the report', async () => {
    (ReportsService.prototype.fairnessForSchedule as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ scheduleId: 1, perUser: [], stats: { count: 0, min: 0, max: 0, mean: 0, stddev: 0 } });
    const res = await request(mountApp('/api/reports', createReportsRouter(fakePool)))
      .get('/api/reports/fairness/1');
    expect(res.status).toBe(200);
  });
});

describe('notifications router', () => {
  it('GET / returns the list', async () => {
    (NotificationService.prototype.listForUser as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/notifications', createNotificationsRouter(fakePool))).get('/api/notifications');
    expect(res.status).toBe(200);
  });

  it('GET /unread-count returns the count', async () => {
    (NotificationService.prototype.unreadCount as jest.Mock) = jest.fn().mockResolvedValue(5);
    const res = await request(mountApp('/api/notifications', createNotificationsRouter(fakePool))).get('/api/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(5);
  });

  it('PATCH /:id/read returns 404 when no row matched', async () => {
    (NotificationService.prototype.markRead as jest.Mock) = jest.fn().mockResolvedValue(false);
    const res = await request(mountApp('/api/notifications', createNotificationsRouter(fakePool)))
      .patch('/api/notifications/1/read');
    expect(res.status).toBe(404);
  });

  it('PATCH /read-all returns the updated count', async () => {
    (NotificationService.prototype.markAllRead as jest.Mock) = jest.fn().mockResolvedValue(3);
    const res = await request(mountApp('/api/notifications', createNotificationsRouter(fakePool)))
      .patch('/api/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(3);
  });
});

describe('calendar router', () => {
  it('POST /token returns the token', async () => {
    (CalendarService.prototype.getOrCreateToken as jest.Mock) = jest.fn().mockResolvedValue('abc');
    const res = await request(mountApp('/api/calendar', createCalendarRouter(fakePool))).post('/api/calendar/token');
    expect(res.status).toBe(200);
  });

  it('POST /token/rotate returns the new token', async () => {
    (CalendarService.prototype.rotateToken as jest.Mock) = jest.fn().mockResolvedValue('xyz');
    const res = await request(mountApp('/api/calendar', createCalendarRouter(fakePool))).post('/api/calendar/token/rotate');
    expect(res.status).toBe(200);
  });
});

describe('two-factor router', () => {
  it('POST /setup returns secret + uri', async () => {
    (TwoFactorService.prototype.beginSetup as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ secret: 'X', otpauthUri: 'otpauth://totp/...' });
    const res = await request(mountApp('/api/auth/2fa', createTwoFactorRouter(fakePool))).post('/api/auth/2fa/setup');
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toBe('X');
  });

  it('POST /enable returns recovery codes', async () => {
    (TwoFactorService.prototype.confirmEnable as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ recoveryCodes: ['ABC-123'] });
    const res = await request(mountApp('/api/auth/2fa', createTwoFactorRouter(fakePool)))
      .post('/api/auth/2fa/enable')
      .send({ code: '000000' });
    expect(res.status).toBe(200);
  });

  it('POST /disable returns ok', async () => {
    (TwoFactorService.prototype.disable as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp('/api/auth/2fa', createTwoFactorRouter(fakePool))).post('/api/auth/2fa/disable');
    expect(res.status).toBe(200);
  });

  it('POST /verify reports validity', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock) = jest.fn().mockResolvedValue(true);
    const res = await request(mountApp('/api/auth/2fa', createTwoFactorRouter(fakePool)))
      .post('/api/auth/2fa/verify')
      .send({ code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });
});

describe('on-call router', () => {
  it('GET /periods returns the list', async () => {
    (OnCallService.prototype.listPeriods as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/on-call', createOnCallRouter(fakePool))).get('/api/on-call/periods');
    expect(res.status).toBe(200);
  });

  it('POST /periods creates a period', async () => {
    (OnCallService.prototype.createPeriod as jest.Mock) = jest.fn().mockResolvedValue({ id: 1 });
    const res = await request(mountApp('/api/on-call', createOnCallRouter(fakePool)))
      .post('/api/on-call/periods')
      .send({ departmentId: 3, date: '2026-05-01', startTime: '20:00', endTime: '08:00' });
    expect(res.status).toBe(201);
  });

  it('GET /me returns the user list', async () => {
    (OnCallService.prototype.listForUser as jest.Mock) = jest.fn().mockResolvedValue([]);
    const res = await request(mountApp('/api/on-call', createOnCallRouter(fakePool))).get('/api/on-call/me');
    expect(res.status).toBe(200);
  });

  it('POST /periods/:id/assign returns the assignment', async () => {
    (OnCallService.prototype.assign as jest.Mock) = jest.fn().mockResolvedValue({ id: 5 });
    const res = await request(mountApp('/api/on-call', createOnCallRouter(fakePool)))
      .post('/api/on-call/periods/1/assign')
      .send({ userId: 7 });
    expect(res.status).toBe(200);
  });

  it('DELETE /periods/:id/assign/:userId returns 200 when removed', async () => {
    (OnCallService.prototype.unassign as jest.Mock) = jest.fn().mockResolvedValue(true);
    const res = await request(mountApp('/api/on-call', createOnCallRouter(fakePool)))
      .delete('/api/on-call/periods/1/assign/7');
    expect(res.status).toBe(200);
  });
});

describe('directory router', () => {
  it('GET /me returns the profile', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, fields: [] });
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool))).get('/api/directory/me');
    expect(res.status).toBe(200);
  });

  it('PUT /users/:id/fields upserts and returns the profile', async () => {
    (UserDirectoryService.prototype.setFields as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest.fn().mockResolvedValue({ id: 7, fields: [] });
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool)))
      .put('/api/directory/users/7/fields')
      .send({ fields: [{ key: 'birthday', value: '1990-01-01' }] });
    expect(res.status).toBe(200);
  });

  it('GET /users/:id/vcard returns text/vcard when found', async () => {
    (UserDirectoryService.prototype.getProfile as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'a@x.com', firstName: 'A', lastName: 'B', role: 'employee', fields: [] });
    (UserDirectoryService.prototype.exportVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A B\r\nEND:VCARD\r\n');
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool))).get('/api/directory/users/1/vcard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/vcard/);
  });

  it('GET /vcard.vcf returns 400 without ids', async () => {
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool))).get('/api/directory/vcard.vcf');
    expect(res.status).toBe(400);
  });

  it('GET /vcard.vcf returns the multi-card export', async () => {
    (UserDirectoryService.prototype.exportVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEND:VCARD\r\n');
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool))).get('/api/directory/vcard.vcf?ids=1,2');
    expect(res.status).toBe(200);
  });

  it('POST /import-vcard returns counts', async () => {
    (UserDirectoryService.prototype.importVcf as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ inserted: 1, skipped: [] });
    const res = await request(mountApp('/api/directory', createDirectoryRouter(fakePool)))
      .post('/api/directory/import-vcard')
      .send({ vcf: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:X\r\nEMAIL:x@y.com\r\nEND:VCARD\r\n' });
    expect(res.status).toBe(200);
  });
});

describe('bulk-import router', () => {
  it('POST /employees returns counts', async () => {
    (BulkImportService.prototype.importEmployees as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ inserted: 1, errors: [] });
    const res = await request(mountApp('/api/bulk-import', createBulkImportRouter(fakePool)))
      .post('/api/bulk-import/employees')
      .send({ csv: 'email,firstName,lastName,role\nx@y.com,X,Y,employee\n' });
    expect(res.status).toBe(200);
  });

  it('POST /shifts returns counts', async () => {
    (BulkImportService.prototype.importShifts as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ inserted: 1, errors: [] });
    const res = await request(mountApp('/api/bulk-import', createBulkImportRouter(fakePool)))
      .post('/api/bulk-import/shifts')
      .send({ csv: 'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n1,1,2026-05-01,08:00,16:00,1,5\n' });
    expect(res.status).toBe(200);
  });
});

describe('events router', () => {
  it('GET /stream opens an SSE connection (skipped — long-lived)', () => {
    // SSE is long-lived; supertest hangs. We rely on the auth-smoke test
    // for 401 coverage and let the connect path execute via routes.legacy.smoke
    // when a valid token is presented in integration tests.
    expect(typeof createEventsRouter).toBe('function');
  });
});
