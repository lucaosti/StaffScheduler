/**
 * Route handler tests for `routes/attendance.ts`.
 *
 * The service layer is fully mocked: these tests pin the route-level
 * contracts that unit tests of AttendanceService cannot see — the
 * approver-vs-self branching on GET / (an employee must never be able to
 * list someone else's punches by passing ?userId=), the ownership/approver
 * gate on GET /:id, the module/permission gating, and the query-string
 * validation of /cost-estimate (which is validated by hand because the
 * values live in the query, not the body).
 *
 * Auth middleware is stubbed with the shared role→permission mapping so the
 * permission checks are enforced for real, not bypassed.
 */

import request from 'supertest';

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'manager',
  email: 'manager@example.com',
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
  requirePermission: (code: string) => (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }
    if (!user.permissions || !user.permissions.includes(code)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Permission '${code}' required` } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/AttendanceService');

import { AttendanceService } from '../services/AttendanceService';
import { createAttendanceRouter } from '../routes/attendance';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { mountRouter } from './helpers/mountRouter';

const fakePool = {} as never;
const app = () => mountRouter('/api/attendance', createAttendanceRouter(fakePool));

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'manager', email: 'manager@example.com' };
});

describe('POST /api/attendance/clock-in', () => {
  it('creates a punch for the caller and returns 201', async () => {
    (AttendanceService.prototype.clockIn as jest.Mock).mockResolvedValue({ id: 5, userId: 1 });

    const res = await request(app()).post('/api/attendance/clock-in').send({ notes: 'shift start' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: 5, userId: 1 });
    expect(AttendanceService.prototype.clockIn).toHaveBeenCalledWith(1, 'shift start');
  });

  it('defaults notes to null when omitted', async () => {
    (AttendanceService.prototype.clockIn as jest.Mock).mockResolvedValue({ id: 5 });

    await request(app()).post('/api/attendance/clock-in').send({});

    expect(AttendanceService.prototype.clockIn).toHaveBeenCalledWith(1, null);
  });

  it('renders a typed conflict (already clocked in) as 409', async () => {
    (AttendanceService.prototype.clockIn as jest.Mock).mockRejectedValue(
      new ConflictError('User already has an open attendance record')
    );

    const res = await request(app()).post('/api/attendance/clock-in').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/attendance/:id/clock-out', () => {
  it('closes the record and returns 200', async () => {
    (AttendanceService.prototype.clockOut as jest.Mock).mockResolvedValue({ id: 5, status: 'pending' });

    const res = await request(app()).post('/api/attendance/5/clock-out').send({ notes: null });

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.clockOut).toHaveBeenCalledWith(1, 5, null);
  });

  it("renders a typed 403 when closing someone else's record", async () => {
    (AttendanceService.prototype.clockOut as jest.Mock).mockRejectedValue(new ForbiddenError('Forbidden'));

    const res = await request(app()).post('/api/attendance/5/clock-out').send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app()).post('/api/attendance/abc/clock-out').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/attendance/cost-estimate', () => {
  it('requires both dates', async () => {
    const res = await request(app()).get('/api/attendance/cost-estimate?startDate=2026-07-01');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-ISO dates', async () => {
    const res = await request(app()).get(
      '/api/attendance/cost-estimate?startDate=01/07/2026&endDate=2026-07-31'
    );
    expect(res.status).toBe(400);
  });

  it('passes the optional departmentId through as a number', async () => {
    (AttendanceService.prototype.getCostEstimate as jest.Mock).mockResolvedValue({ planned: 1, actual: 2 });

    const res = await request(app()).get(
      '/api/attendance/cost-estimate?startDate=2026-07-01&endDate=2026-07-31&departmentId=4'
    );

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.getCostEstimate).toHaveBeenCalledWith({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      departmentId: 4,
    });
  });

  it('omits departmentId when not given', async () => {
    (AttendanceService.prototype.getCostEstimate as jest.Mock).mockResolvedValue({});

    await request(app()).get('/api/attendance/cost-estimate?startDate=2026-07-01&endDate=2026-07-31');

    expect(AttendanceService.prototype.getCostEstimate).toHaveBeenCalledWith({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      departmentId: undefined,
    });
  });

  it('is forbidden without attendance.read', async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };
    const res = await request(app()).get(
      '/api/attendance/cost-estimate?startDate=2026-07-01&endDate=2026-07-31'
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/attendance', () => {
  it('lets an approver filter by any user', async () => {
    (AttendanceService.prototype.list as jest.Mock).mockResolvedValue([]);

    const res = await request(app()).get('/api/attendance?userId=9&status=pending&startDate=2026-07-01&endDate=2026-07-31');

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.list).toHaveBeenCalledWith({
      userId: 9,
      status: 'pending',
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
    });
  });

  it('leaves userId undefined for an approver listing everyone', async () => {
    (AttendanceService.prototype.list as jest.Mock).mockResolvedValue([]);

    const res = await request(app()).get('/api/attendance');

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined })
    );
  });

  it('forces the filter to self for a plain employee, ignoring ?userId=', async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };
    (AttendanceService.prototype.list as jest.Mock).mockResolvedValue([]);

    const res = await request(app()).get('/api/attendance?userId=9');

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 2 })
    );
  });
});

describe('GET /api/attendance/:id', () => {
  it('returns 404 when the record does not exist', async () => {
    (AttendanceService.prototype.getById as jest.Mock).mockResolvedValue(null);

    const res = await request(app()).get('/api/attendance/5');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lets the owner read their own record', async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };
    (AttendanceService.prototype.getById as jest.Mock).mockResolvedValue({ id: 5, userId: 2 });

    const res = await request(app()).get('/api/attendance/5');
    expect(res.status).toBe(200);
  });

  it("blocks an employee from reading someone else's record", async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };
    (AttendanceService.prototype.getById as jest.Mock).mockResolvedValue({ id: 5, userId: 9 });

    const res = await request(app()).get('/api/attendance/5');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("lets an approver read someone else's record", async () => {
    (AttendanceService.prototype.getById as jest.Mock).mockResolvedValue({ id: 5, userId: 9 });

    const res = await request(app()).get('/api/attendance/5');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/attendance/:id/approve and /reject', () => {
  it('approves with reviewer id and notes', async () => {
    (AttendanceService.prototype.approve as jest.Mock).mockResolvedValue({ id: 5, status: 'approved' });

    const res = await request(app()).post('/api/attendance/5/approve').send({ notes: 'ok' });

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.approve).toHaveBeenCalledWith(5, 1, 'ok');
  });

  it('rejects with reviewer id and null notes by default', async () => {
    (AttendanceService.prototype.reject as jest.Mock).mockResolvedValue({ id: 5, status: 'rejected' });

    const res = await request(app()).post('/api/attendance/5/reject').send({});

    expect(res.status).toBe(200);
    expect(AttendanceService.prototype.reject).toHaveBeenCalledWith(5, 1, null);
  });

  it('is forbidden without attendance.approve', async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };

    const res = await request(app()).post('/api/attendance/5/approve').send({});
    expect(res.status).toBe(403);
  });

  it('renders the self-approval guard from the service as 403', async () => {
    (AttendanceService.prototype.approve as jest.Mock).mockRejectedValue(
      new ForbiddenError('Forbidden: cannot approve your own attendance record')
    );

    const res = await request(app()).post('/api/attendance/5/approve').send({});
    expect(res.status).toBe(403);
  });

  it('renders a typed 404 from the service', async () => {
    (AttendanceService.prototype.reject as jest.Mock).mockRejectedValue(
      new NotFoundError('Attendance record not found')
    );

    const res = await request(app()).post('/api/attendance/5/reject').send({});
    expect(res.status).toBe(404);
  });
});
