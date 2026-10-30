/**
 * The org-unit scope filters list and aggregate services apply (#813): each
 * turns `orgUnitIds` into a condition on its own rows, and an empty scope
 * matches nothing rather than everything. The end-to-end behaviour against
 * real SQL is in `integration/authorization.integration.test.ts`.
 *
 * @author Luca Ostinelli
 */

import { AssignmentService } from '../services/AssignmentService';
import { AttendanceService } from '../services/AttendanceService';
import { CostPlanService } from '../services/CostPlanService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { ReportsService } from '../services/ReportsService';

const makePool = (rows: unknown[] = []) => {
  const execute = jest.fn().mockResolvedValue([rows, null]);
  const query = jest.fn().mockResolvedValue([rows, null]);
  return { pool: { execute, query } as never, execute, query };
};

describe('scope filters in list services', () => {
  it('bounds assignments by the shift department\'s org unit', async () => {
    const { pool, execute } = makePool([{ total: 0 }]);
    await new AssignmentService(pool).countAssignments({ orgUnitIds: [3, 4] });
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('s.department_id IN (SELECT id FROM departments WHERE org_unit_id IN (?, ?))');
    expect(params).toEqual([3, 4]);
  });

  it('bounds attendance by the punching person\'s units', async () => {
    const { pool, execute } = makePool();
    await new AttendanceService(pool).list({ orgUnitIds: [] });
    expect(execute.mock.calls[0][0]).toContain('user_id IN (SELECT user_id FROM user_org_units WHERE 1 = 0)');
  });

  it('bounds cost plans by their department\'s org unit', async () => {
    const { pool, query } = makePool();
    await new CostPlanService(pool).list(2, [5]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('department_id = ? AND department_id IN (SELECT id FROM departments WHERE org_unit_id IN (?))');
    expect(params).toEqual([2, 5]);
  });

  it('shows a loan to either end of it', async () => {
    const { pool, execute } = makePool();
    await new EmployeeLoanService(pool).list({ orgUnitIds: [7] });
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('(to_org_unit_id IN (?) OR from_org_unit_id IN (?))');
    expect(params).toEqual([7, 7]);
  });

  it('bounds the hours report by shift department', async () => {
    const { pool, execute } = makePool();
    await new ReportsService(pool).hoursWorkedByUser('2031-01-01', '2031-01-31', undefined, [9]);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('s.department_id IN (SELECT id FROM departments WHERE org_unit_id IN (?))');
    expect(params).toEqual(['2031-01-01', '2031-01-31', 9]);
  });

  it('bounds the department cost report and the violation trend', async () => {
    const { pool, execute } = makePool();
    const reports = new ReportsService(pool);
    await reports.costByDepartment('2031-01-01', '2031-01-31', [9]);
    expect(execute.mock.calls[0][0]).toContain('WHERE d.org_unit_id IN (?)');
    await reports.complianceViolationsTrend('2031-01-01', '2031-01-31', [9]);
    expect(execute.mock.calls[1][0]).toContain('AND user_id IN (SELECT user_id FROM user_org_units WHERE org_unit_id IN (?))');
  });

  it('bounds the cost estimate on both the planned and the actual side', async () => {
    const { pool, execute } = makePool([{ hours: 0, cost: 0 }]);
    await new AttendanceService(pool).getCostEstimate({ startDate: '2031-01-01', endDate: '2031-01-31', orgUnitIds: [9] });
    expect(execute.mock.calls[0][0]).toContain('s.department_id IN (SELECT id FROM departments WHERE org_unit_id IN (?))');
    expect(execute.mock.calls[0][1]).toEqual(['2031-01-01', '2031-01-31', 9]);
    expect(execute.mock.calls[1][0]).toContain('ar.user_id IN (SELECT user_id FROM user_org_units WHERE org_unit_id IN (?))');
  });
});
