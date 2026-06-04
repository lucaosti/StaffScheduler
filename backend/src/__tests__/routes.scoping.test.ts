/**
 * Org-unit hierarchical access scoping — integration tests (issue #89).
 *
 * Scenarios covered:
 *   1. Unscoped admin (allowedOrgUnitIds = null) gets all records.
 *   2. Scoped manager (allowedOrgUnitIds = [2, 5]) sees only records whose
 *      department org_unit_id falls within the allowed set.
 *   3. Scoped manager is blocked (403) when reading a schedule whose
 *      department belongs to a sibling org unit not in the allowed set.
 *   4. Empty scope array (scoped but no valid subtree) returns empty list.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// ──────────────────────────────────────────────────────────────────────────────
// Module mocks
// ──────────────────────────────────────────────────────────────────────────────

jest.mock('../services/ScheduleService');
jest.mock('../services/EmployeeService');
jest.mock('../services/ShiftService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

// authenticate is mocked so we can inject allowedOrgUnitIds freely.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: jest.fn((req: any, _res: any, next: any) => {
      req.user = (req as any).__mockUser ?? {
        id: 1,
        email: 'admin@test.com',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
        permissions: [],
        roles: [],
        allowedOrgUnitIds: null,
      };
      next();
    }),
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
    userHasPermission: () => true,
  };
});

import { ScheduleService } from '../services/ScheduleService';
import { EmployeeService } from '../services/EmployeeService';
import { ShiftService } from '../services/ShiftService';
import { authenticate } from '../middleware/auth';
import { createSchedulesRouter } from '../routes/schedules';
import { createEmployeesRouter } from '../routes/employees';
import { createShiftsRouter } from '../routes/shifts';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const makeToken = (userId = 1) =>
  jwt.sign({ userId, email: 'test@test.com' }, config.jwt.secret, { expiresIn: '1h' });

/** Injects a mock user (with the given allowedOrgUnitIds) via the mocked authenticate. */
const withScope = (allowedOrgUnitIds: number[] | null) => {
  (authenticate as jest.Mock).mockImplementation((req: any, _res: any, next: any) => {
    req.user = {
      id: 2,
      email: 'manager@test.com',
      firstName: 'M',
      lastName: 'N',
      isActive: true,
      permissions: ['schedule.read', 'employee.read', 'shift.read'],
      roles: [],
      allowedOrgUnitIds,
    };
    next();
  });
};

const buildApps = () => {
  const pool = {} as never;
  const app = express();
  app.use(express.json());
  app.use('/api/schedules', createSchedulesRouter(pool));
  app.use('/api/employees', createEmployeesRouter(pool));
  app.use('/api/shifts', createShiftsRouter(pool));
  return app;
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests: GET /api/schedules — list
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/schedules — scope filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unscoped admin calls getAllSchedules with no org-unit filter', async () => {
    withScope(null);
    (ScheduleService.prototype.getAllSchedules as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const callArg = (ScheduleService.prototype.getAllSchedules as jest.Mock).mock.calls[0][0];
    expect(callArg).toBeUndefined();
  });

  it('scoped manager calls getAllSchedules with orgUnitIds filter', async () => {
    withScope([2, 5]);
    (ScheduleService.prototype.getAllSchedules as jest.Mock).mockResolvedValue([
      { id: 10, name: 'Schedule A', departmentId: 1, status: 'draft' },
    ]);

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    const callArg = (ScheduleService.prototype.getAllSchedules as jest.Mock).mock.calls[0][0];
    expect(callArg).toEqual({ orgUnitIds: [2, 5] });
  });

  it('scoped manager with empty scope sees nothing (service returns [])', async () => {
    withScope([]);
    (ScheduleService.prototype.getAllSchedules as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    const callArg = (ScheduleService.prototype.getAllSchedules as jest.Mock).mock.calls[0][0];
    expect(callArg).toEqual({ orgUnitIds: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: GET /api/schedules/:id — single item scope check
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/schedules/:id — single-item scope check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unscoped admin can read any schedule', async () => {
    withScope(null);
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 7,
      name: 'Q3 Ops',
      departmentOrgUnitId: 99,
    });

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules/7')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
  });

  it('scoped manager can read a schedule whose dept is in scope', async () => {
    withScope([2, 5]);
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 7,
      name: 'Q3 Ops',
      departmentOrgUnitId: 5,
    });

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules/7')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
  });

  it('scoped manager is blocked when schedule dept is in a sibling branch', async () => {
    withScope([2, 5]);
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 8,
      name: 'Finance Q3',
      departmentOrgUnitId: 9,
    });

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules/8')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('scoped manager is blocked when schedule dept has no org_unit assignment', async () => {
    withScope([2, 5]);
    (ScheduleService.prototype.getScheduleById as jest.Mock).mockResolvedValue({
      id: 9,
      name: 'Unassigned dept schedule',
      departmentOrgUnitId: null,
    });

    const app = buildApps();
    const res = await request(app)
      .get('/api/schedules/9')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: GET /api/employees — list
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/employees — scope filtering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unscoped admin calls getAllEmployees with no filter', async () => {
    withScope(null);
    (EmployeeService.prototype.getAllEmployees as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${makeToken()}`);

    const callArg = (EmployeeService.prototype.getAllEmployees as jest.Mock).mock.calls[0][0];
    expect(callArg).toBeUndefined();
  });

  it('scoped manager calls getAllEmployees with orgUnitIds filter', async () => {
    withScope([3]);
    (EmployeeService.prototype.getAllEmployees as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${makeToken()}`);

    const callArg = (EmployeeService.prototype.getAllEmployees as jest.Mock).mock.calls[0][0];
    expect(callArg).toEqual({ orgUnitIds: [3] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: GET /api/shifts — list
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/shifts — scope filtering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unscoped admin calls getAllShifts with no filter', async () => {
    withScope(null);
    (ShiftService.prototype.getAllShifts as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    await request(app)
      .get('/api/shifts')
      .set('Authorization', `Bearer ${makeToken()}`);

    const callArg = (ShiftService.prototype.getAllShifts as jest.Mock).mock.calls[0][0];
    expect(callArg).toBeUndefined();
  });

  it('scoped manager calls getAllShifts with orgUnitIds filter', async () => {
    withScope([10, 11]);
    (ShiftService.prototype.getAllShifts as jest.Mock).mockResolvedValue([]);

    const app = buildApps();
    await request(app)
      .get('/api/shifts')
      .set('Authorization', `Bearer ${makeToken()}`);

    const callArg = (ShiftService.prototype.getAllShifts as jest.Mock).mock.calls[0][0];
    expect(callArg).toEqual({ orgUnitIds: [10, 11] });
  });
});
