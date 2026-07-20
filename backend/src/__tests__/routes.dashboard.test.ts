/**
 * Tests for `routes/dashboard.ts`. The router is a factory that receives the
 * mysql2 pool, so we hand it a fake pool whose `execute` is scripted per test.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// Permissions attached to the fake authenticated user; tests mutate this to
// exercise permission-dependent behavior (e.g. monthlyCost gating).
let currentPermissions: string[] = [];
const requirePermissionCodes: string[] = [];
const requireModuleForUserCodes: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: 'a@x', isActive: true, permissions: currentPermissions };
    next();
  },
  requirePermission: (code: string) => {
    requirePermissionCodes.push(code);
    return (req: any, res: any, next: any) => {
      if (req.user?.permissions?.includes(code)) return next();
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient privileges' } });
    };
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: (code: string) => {
    requireModuleForUserCodes.push(code);
    return (_req: any, _res: any, next: any) => next();
  },
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

import { createDashboardRouter } from '../routes/dashboard';
import { errorHandler } from '../middleware/errorHandler';

const execute = jest.fn();
const fakePool = { execute } as any;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', createDashboardRouter(fakePool));
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], null]); // default: empty result set
  currentPermissions = require('./helpers/permissions').ALL_PERMISSIONS;
});

describe('GET /api/dashboard/stats', () => {
  it('aggregates the summary numbers', async () => {
    execute
      .mockResolvedValueOnce([[{ count: 50 }], null]) // employees
      .mockResolvedValueOnce([[{ count: 3 }], null]) // schedules
      .mockResolvedValueOnce([[{ count: 8 }], null]) // todayShifts
      .mockResolvedValueOnce([[{ count: 2 }], null]) // pending
      .mockResolvedValueOnce([[{ total_hours: 320 }], null])
      .mockResolvedValueOnce([[{ total_cost: 7200.55 }], null])
      .mockResolvedValueOnce([[{ total_shifts: 10, covered_shifts: 9 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(50);
    expect(res.body.data.activeSchedules).toBe(3);
    expect(res.body.data.coverageRate).toBe(90);
    expect(res.body.data.monthlyCost).toBe(7200.55);
  });

  it('omits the labor cost for users without report.read', async () => {
    currentPermissions = ['schedule.read']; // no report.read
    execute
      .mockResolvedValueOnce([[{ count: 50 }], null])
      .mockResolvedValueOnce([[{ count: 3 }], null])
      .mockResolvedValueOnce([[{ count: 8 }], null])
      .mockResolvedValueOnce([[{ count: 2 }], null])
      .mockResolvedValueOnce([[{ total_hours: 320 }], null])
      // no cost query issued for this user; next mocks feed coverage/satisfaction
      .mockResolvedValueOnce([[{ total_shifts: 10, covered_shifts: 9 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.monthlyCost).toBeNull();
    const issuedSql = execute.mock.calls.map((c) => String(c[0]));
    expect(issuedSql.some((sql) => sql.includes('hourly_rate'))).toBe(false);
  });

  it('uses sargable date-range predicates (no MONTH()/DATE() on columns)', async () => {
    await request(mountApp()).get('/api/dashboard/stats');
    const issuedSql = execute.mock.calls.map((c) => String(c[0]));
    for (const sql of issuedSql) {
      expect(sql).not.toMatch(/MONTH\(s?\.?date\)|DATE\(date\)/);
    }
  });

  it('falls back to zeros when queries return null', async () => {
    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(0);
    expect(res.body.data.coverageRate).toBe(0);
  });

  it('returns 500 on database error', async () => {
    execute.mockRejectedValueOnce(new Error('oops'));
    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('GET /api/dashboard/activities', () => {
  it('is guarded by the audit module and audit.read permission', () => {
    mountApp();
    expect(requirePermissionCodes).toContain('audit.read');
    expect(requireModuleForUserCodes).toContain('audit');
  });

  it('returns 403 to users without audit.read', async () => {
    currentPermissions = ['schedule.read'];
    const res = await request(mountApp()).get('/api/dashboard/activities');
    expect(res.status).toBe(403);
  });

  it('returns formatted activities', async () => {
    execute.mockResolvedValueOnce([
      [
        {
          id: 1,
          type: 'create',
          message: 'something',
          timestamp: new Date('2026-01-01T00:00:00Z'),
          user: 'Mario Rossi',
        },
        {
          id: 2,
          type: 'update',
          message: 'else',
          timestamp: new Date('2026-01-02T00:00:00Z'),
          user: null,
        },
      ],
      null,
    ]);
    const res = await request(mountApp()).get('/api/dashboard/activities');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[1].user).toBe('System');
  });

  it('returns 500 on db error', async () => {
    execute.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/activities');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/dashboard/upcoming-shifts', () => {
  it('annotates status against required vs assigned', async () => {
    execute.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'ER - 2026-05-01',
          department: 'ER',
          start_time: '08:00',
          end_time: '16:00',
          required_employees: 2,
          assigned_employees: 1,
        },
        {
          id: 2,
          name: 'Surgery - 2026-05-01',
          department: 'Surgery',
          start_time: '20:00',
          end_time: '08:00',
          required_employees: 1,
          assigned_employees: 1,
        },
        {
          id: 3,
          name: 'Pediatrics - 2026-05-01',
          department: 'Pediatrics',
          start_time: '08:00',
          end_time: '12:00',
          required_employees: 1,
          assigned_employees: 3,
        },
      ],
      null,
    ]);
    const res = await request(mountApp()).get('/api/dashboard/upcoming-shifts');
    expect(res.status).toBe(200);
    const statuses = res.body.data.map((d: any) => d.status);
    expect(statuses).toEqual(['understaffed', 'adequate', 'overstaffed']);
  });

  it('returns 500 on error', async () => {
    execute.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/upcoming-shifts');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/dashboard/departments', () => {
  it('returns departments aggregation', async () => {
    execute.mockResolvedValueOnce([[{ department: 'ER', total_employees: 10 }], null]);
    const res = await request(mountApp()).get('/api/dashboard/departments');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    execute.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/departments');
    expect(res.status).toBe(500);
  });
});
