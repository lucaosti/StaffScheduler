/**
 * Tests for `routes/dashboard.ts`. The router uses the singleton
 * `database` from `config/database`, so we mock that module.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, role: 'admin', email: 'a@x', isActive: true };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireManager: (_req: any, _res: any, next: any) => next(),
}));

const queryOne = jest.fn();
const query = jest.fn();
jest.mock('../config/database', () => ({
  database: { queryOne: (...args: any[]) => queryOne(...args), query: (...args: any[]) => query(...args) },
}));

import dashboardRoutes from '../routes/dashboard';

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRoutes);
  return app;
};

beforeEach(() => {
  queryOne.mockReset();
  query.mockReset();
});

describe('GET /api/dashboard/stats', () => {
  it('aggregates the summary numbers', async () => {
    queryOne
      .mockResolvedValueOnce({ count: 50 }) // employees
      .mockResolvedValueOnce({ count: 3 }) // schedules
      .mockResolvedValueOnce({ count: 8 }) // todayShifts
      .mockResolvedValueOnce({ count: 2 }) // pending
      .mockResolvedValueOnce({ total_hours: 320 })
      .mockResolvedValueOnce({ total_cost: 7200.55 })
      .mockResolvedValueOnce({ total_shifts: 10, covered_shifts: 9 });

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(50);
    expect(res.body.data.activeSchedules).toBe(3);
    expect(res.body.data.coverageRate).toBe(90);
  });

  it('falls back to zeros when queries return null', async () => {
    queryOne.mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(0);
    expect(res.body.data.coverageRate).toBe(0);
  });

  it('returns 500 on database error', async () => {
    queryOne.mockRejectedValueOnce(new Error('oops'));
    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('GET /api/dashboard/activities', () => {
  it('returns formatted activities', async () => {
    query.mockResolvedValueOnce([
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
    ]);
    const res = await request(mountApp()).get('/api/dashboard/activities');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[1].user).toBe('System');
  });

  it('returns 500 on db error', async () => {
    query.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/activities');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/dashboard/upcoming-shifts', () => {
  it('annotates status against required vs assigned', async () => {
    query.mockResolvedValueOnce([
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
    ]);
    const res = await request(mountApp()).get('/api/dashboard/upcoming-shifts');
    expect(res.status).toBe(200);
    const statuses = res.body.data.map((d: any) => d.status);
    expect(statuses).toEqual(['understaffed', 'adequate', 'overstaffed']);
  });

  it('returns 500 on error', async () => {
    query.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/upcoming-shifts');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/dashboard/departments', () => {
  it('returns departments aggregation', async () => {
    query.mockResolvedValueOnce([{ department: 'ER', total_employees: 10 }]);
    const res = await request(mountApp()).get('/api/dashboard/departments');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 500 on error', async () => {
    query.mockRejectedValueOnce(new Error('x'));
    const res = await request(mountApp()).get('/api/dashboard/departments');
    expect(res.status).toBe(500);
  });
});
