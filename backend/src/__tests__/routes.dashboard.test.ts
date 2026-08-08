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
      .mockResolvedValueOnce([[{ total_target: 8000 }], null])
      .mockResolvedValueOnce([[{ total_shifts: 10, covered_shifts: 9 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(50);
    expect(res.body.data.activeSchedules).toBe(3);
    expect(res.body.data.coverageRate).toBe(90);
    expect(res.body.data.monthlyCost).toBe(7200.55);
    expect(res.body.data.monthlyCostPlan).toBe(8000);
  });

  it('omits the labor cost and cost plan for users without report.read', async () => {
    currentPermissions = ['schedule.read']; // no report.read
    execute
      .mockResolvedValueOnce([[{ count: 50 }], null])
      .mockResolvedValueOnce([[{ count: 3 }], null])
      .mockResolvedValueOnce([[{ count: 8 }], null])
      .mockResolvedValueOnce([[{ count: 2 }], null])
      .mockResolvedValueOnce([[{ total_hours: 320 }], null])
      // no cost or cost-plan query issued for this user; next mock feeds coverage/satisfaction
      .mockResolvedValueOnce([[{ total_shifts: 10, covered_shifts: 9 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.monthlyCost).toBeNull();
    expect(res.body.data.monthlyCostPlan).toBeNull();
    const issuedSql = execute.mock.calls.map((c) => String(c[0]));
    expect(issuedSql.some((sql) => sql.includes('hourly_rate'))).toBe(false);
    expect(issuedSql.some((sql) => sql.includes('cost_plans'))).toBe(false);
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

  /**
   * `limit` was published in the spec through a reusable `$ref` while the
   * handler took `_req` and hardcoded `LIMIT 10`, so the documented knob did
   * nothing. These assert it is now honoured, bounded, and — critically —
   * inlined rather than bound.
   */
  it('defaults to ten rows when no limit is given', async () => {
    execute.mockResolvedValueOnce([[], null]);
    await request(mountApp()).get('/api/dashboard/activities');
    expect(execute.mock.calls[0][0]).toContain('LIMIT 10');
  });

  it('honours a caller-supplied limit', async () => {
    execute.mockResolvedValueOnce([[], null]);
    await request(mountApp()).get('/api/dashboard/activities?limit=3');
    expect(execute.mock.calls[0][0]).toContain('LIMIT 3');
  });

  it('inlines the limit instead of binding it', async () => {
    // MySQL's binary prepared-statement protocol rejects a placeholder in
    // LIMIT with ER_WRONG_ARGUMENTS — the defect that made the audit-log,
    // change-request and notification lists return 500 in every deployment.
    // The clamping lives in the Zod schema, so inlining stays safe.
    execute.mockResolvedValueOnce([[], null]);
    await request(mountApp()).get('/api/dashboard/activities?limit=7');
    expect(execute.mock.calls[0][0]).not.toContain('LIMIT ?');
    expect(execute.mock.calls[0][1] ?? []).toEqual([]);
  });

  it('rejects a limit outside the documented bounds', async () => {
    for (const bad of ['0', '-1', '51', 'abc']) {
      const res = await request(mountApp()).get(`/api/dashboard/activities?limit=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
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

describe('GET /api/dashboard/attention-items', () => {
  const pendingApprovalRow = (over: Record<string, unknown> = {}) => ({
    id: 1,
    change_request_id: 9,
    time_off_request_id: null,
    employee_loan_id: null,
    shift_swap_request_id: null,
    policy_exception_id: null,
    workflow_id: 1,
    step_id: 1,
    step_order: 1,
    assigned_to_user_id: 1,
    assigned_to_org_unit_id: null,
    open_to_structure: 0,
    decided_by_user_id: null,
    status: 'pending',
    decided_at: null,
    decision_note: null,
    escalated_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cr_change_type: 'Policy.Update',
    cr_target_entity_type: null,
    cr_target_entity_id: null,
    cr_proposed_payload: '{}',
    cr_justification: null,
    cr_proposer_user_id: 5,
    ...over,
  });

  it('reports understaffed shifts and pending-approval aging for a report.read holder', async () => {
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 10,
            date: '2026-05-01',
            start_time: '08:00',
            end_time: '16:00',
            min_staff: 3,
            assigned_staff: 1,
            department_name: 'ER',
          },
        ],
        null,
      ]) // understaffed shifts (report.read -> unscoped, no RBAC query first)
      .mockResolvedValueOnce([[pendingApprovalRow()], null]); // PendingApprovalService.listForUser

    const res = await request(mountApp()).get('/api/dashboard/attention-items');
    expect(res.status).toBe(200);
    expect(res.body.data.understaffedShifts.count).toBe(1);
    expect(res.body.data.understaffedShifts.items[0].departmentName).toBe('ER');
    expect(res.body.data.pendingApprovalsAging.count).toBe(1);
    expect(res.body.data.pendingApprovalsAging.items[0].changeType).toBe('Policy.Update');
  });

  it('does not scope the shift query for a report.read holder', async () => {
    await request(mountApp()).get('/api/dashboard/attention-items');
    const [shiftSql] = execute.mock.calls[0];
    expect(String(shiftSql)).not.toMatch(/org_unit_id IN/);
  });

  it('scopes understaffed shifts to the caller org units without report.read, and skips the query entirely when they belong to none', async () => {
    currentPermissions = ['schedule.read']; // no report.read
    execute
      .mockResolvedValueOnce([[], null]) // RbacService.getUserOrgUnitSubtreeIds -> no memberships
      .mockResolvedValueOnce([[], null]); // PendingApprovalService.listForUser

    const res = await request(mountApp()).get('/api/dashboard/attention-items');
    expect(res.status).toBe(200);
    expect(res.body.data.understaffedShifts).toEqual({ count: 0, truncated: false, items: [] });
    // Exactly two queries: the subtree lookup, then pending approvals — the
    // shift query is skipped rather than sent as an invalid `IN ()`.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('buckets pending approvals by how long they have been waiting', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour
    execute
      .mockResolvedValueOnce([[], null]) // no understaffed shifts
      .mockResolvedValueOnce([
        [pendingApprovalRow({ id: 1, created_at: old }), pendingApprovalRow({ id: 2, created_at: recent })],
        null,
      ]);

    const res = await request(mountApp()).get('/api/dashboard/attention-items');
    expect(res.status).toBe(200);
    const aging = res.body.data.pendingApprovalsAging;
    expect(aging.count).toBe(2);
    expect(aging.overDay).toBe(1);
    expect(aging.overTwoDays).toBe(1);
    expect(aging.overWeek).toBe(1);
    // Oldest first.
    expect(aging.items[0].id).toBe(1);
  });

  it('returns 500 on database error', async () => {
    execute.mockRejectedValueOnce(new Error('oops'));
    const res = await request(mountApp()).get('/api/dashboard/attention-items');
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
