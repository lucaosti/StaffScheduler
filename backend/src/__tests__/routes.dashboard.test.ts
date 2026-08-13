/**
 * Tests for `routes/dashboard.ts` and the `DashboardService` behind it.
 *
 * The router is a factory that receives the mysql2 pool, so we hand it a fake
 * pool whose `execute` is scripted per test. The aggregation logic now lives in
 * the service, but it is still exercised end-to-end through the route: these
 * tests are about the observable contract — response shape, permission gating,
 * org-unit scoping — which is a property of the pair, not of either alone.
 *
 * The three endpoints that once lived here (`/activities`, `/upcoming-shifts`,
 * `/departments`) were removed in #719: nothing in the repository called them,
 * and `/activities` duplicated `/api/audit-logs`, which is what the frontend
 * actually uses for that feed.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// Permissions attached to the fake authenticated user; tests mutate this to
// exercise permission-dependent behavior (e.g. monthlyCost gating).
let currentPermissions: string[] = [];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: 'a@x', isActive: true, permissions: currentPermissions };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
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
      .mockResolvedValueOnce([[{ total_shifts: 10, covered_shifts: 9 }], null])
      .mockResolvedValueOnce([[{ total_assignments: 4, preferred_assignments: 1 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBe(50);
    expect(res.body.data.activeSchedules).toBe(3);
    expect(res.body.data.todayShifts).toBe(8);
    expect(res.body.data.pendingApprovals).toBe(2);
    expect(res.body.data.monthlyHours).toBe(320);
    expect(res.body.data.coverageRate).toBe(90);
    expect(res.body.data.employeeSatisfaction).toBe(25);
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
    // Null, not zero: a zero would be a claim about the data rather than about
    // what this caller may see.
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
    expect(res.body.data.employeeSatisfaction).toBe(0);
  });

  it('reports a zero rate rather than dividing by zero on an empty month', async () => {
    execute
      .mockResolvedValueOnce([[{ count: 0 }], null])
      .mockResolvedValueOnce([[{ count: 0 }], null])
      .mockResolvedValueOnce([[{ count: 0 }], null])
      .mockResolvedValueOnce([[{ count: 0 }], null])
      .mockResolvedValueOnce([[{ total_hours: 0 }], null])
      .mockResolvedValueOnce([[{ total_cost: 0 }], null])
      .mockResolvedValueOnce([[{ total_target: 0 }], null])
      .mockResolvedValueOnce([[{ total_shifts: 0, covered_shifts: 0 }], null])
      .mockResolvedValueOnce([[{ total_assignments: 0, preferred_assignments: 0 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.body.data.coverageRate).toBe(0);
    expect(res.body.data.employeeSatisfaction).toBe(0);
  });

  it('rounds money to cents and rates to one decimal', async () => {
    execute
      .mockResolvedValueOnce([[{ count: 1 }], null])
      .mockResolvedValueOnce([[{ count: 1 }], null])
      .mockResolvedValueOnce([[{ count: 1 }], null])
      .mockResolvedValueOnce([[{ count: 1 }], null])
      .mockResolvedValueOnce([[{ total_hours: 10.6 }], null])
      .mockResolvedValueOnce([[{ total_cost: 1234.5678 }], null])
      .mockResolvedValueOnce([[{ total_target: 999.999 }], null])
      .mockResolvedValueOnce([[{ total_shifts: 3, covered_shifts: 1 }], null])
      .mockResolvedValueOnce([[{ total_assignments: 3, preferred_assignments: 1 }], null]);

    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.body.data.monthlyHours).toBe(11);
    expect(res.body.data.monthlyCost).toBe(1234.57);
    expect(res.body.data.monthlyCostPlan).toBe(1000);
    // 1/3 -> 33.333…% reported as 33.3, not a full float on the wire.
    expect(res.body.data.coverageRate).toBe(33.3);
    expect(res.body.data.employeeSatisfaction).toBe(33.3);
  });

  it('returns 500 on database error', async () => {
    execute.mockRejectedValueOnce(new Error('oops'));
    const res = await request(mountApp()).get('/api/dashboard/stats');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
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
    expect(res.body.data.understaffedShifts.truncated).toBe(false);
    expect(res.body.data.understaffedShifts.items[0]).toMatchObject({
      id: 10,
      date: '2026-05-01',
      departmentName: 'ER',
      assignedStaff: 1,
      minStaff: 3,
    });
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

  it('scopes the shift query to the org units a caller without report.read belongs to', async () => {
    currentPermissions = ['schedule.read'];
    // `getUserOrgUnitSubtreeIds` issues a membership read and then a recursive
    // walk per unit, so the shift query is located by its own text rather than
    // by call index — the index would encode how RBAC resolves the subtree,
    // which is not what this test is about.
    execute.mockResolvedValue([[{ id: 4 }, { id: 7 }], null]);

    await request(mountApp()).get('/api/dashboard/attention-items');

    const shiftSql = execute.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => sql.includes('HAVING assigned_staff < s.min_staff'));
    expect(shiftSql).toMatch(/d\.org_unit_id IN \(4, ?7\)/);
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

  /**
   * The list is a shortlist, so it caps — and says so. Reading one over the cap
   * is what makes `truncated` answerable at all: without it, exactly-at-cap and
   * over-cap are indistinguishable.
   */
  it('caps the shift list at twenty and flags that more matched', async () => {
    const shifts = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      date: '2026-05-01',
      start_time: '08:00',
      end_time: '16:00',
      min_staff: 2,
      assigned_staff: 1,
      department_name: 'ER',
    }));
    execute.mockResolvedValueOnce([shifts, null]).mockResolvedValueOnce([[], null]);

    const res = await request(mountApp()).get('/api/dashboard/attention-items');
    expect(res.body.data.understaffedShifts.truncated).toBe(true);
    expect(res.body.data.understaffedShifts.items).toHaveLength(20);
  });

  it('returns 500 on database error', async () => {
    execute.mockRejectedValueOnce(new Error('oops'));
    const res = await request(mountApp()).get('/api/dashboard/attention-items');
    expect(res.status).toBe(500);
  });
});

describe('removed endpoints', () => {
  /**
   * #719 removed three endpoints nothing called. Asserting they are gone keeps
   * the router from quietly regrowing a surface with no consumer — the state
   * that let them survive unnoticed in the first place.
   */
  it.each(['/api/dashboard/activities', '/api/dashboard/upcoming-shifts', '/api/dashboard/departments'])(
    '%s is no longer mounted',
    async (url) => {
      const res = await request(mountApp()).get(url);
      expect(res.status).toBe(404);
    }
  );
});
