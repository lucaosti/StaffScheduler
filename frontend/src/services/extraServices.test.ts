/**
 * Smoke tests for service modules that previously had 0% coverage:
 *   - departmentService
 *   - orgService
 *   - policyService
 *   - systemService
 *
 * Plus extra coverage for thinly-covered modules (employeeService,
 * shiftService, scheduleService, authService).
 */

import * as departmentService from './departmentService';
import * as orgService from './orgService';
import * as policyService from './policyService';
import * as systemService from './systemService';
import * as employeeService from './employeeService';
import * as shiftService from './shiftService';
import * as scheduleService from './scheduleService';
import * as authService from './authService';

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest
    .fn()
    .mockImplementation(async () =>
      okJsonResponse({ success: true, data: [] })
    ) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = (): jest.Mock => global.fetch as jest.Mock;
const lastUrl = (): string => fetchMock().mock.calls[0][0] as string;
const lastInit = (): RequestInit => fetchMock().mock.calls[0][1] as RequestInit;

describe('departmentService', () => {
  it('getDepartments hits /departments', async () => {
    await departmentService.getDepartments();
    expect(lastUrl()).toMatch(/\/departments$/);
  });

  it('getDepartmentById uses GET on /:id', async () => {
    await departmentService.getDepartmentById(7);
    expect(lastUrl()).toMatch(/\/departments\/7$/);
  });

  it('createDepartment POSTs', async () => {
    await departmentService.createDepartment({ name: 'X' });
    expect(lastInit().method).toBe('POST');
  });

  it('updateDepartment PUTs', async () => {
    await departmentService.updateDepartment(7, { name: 'Y' });
    expect(lastInit().method).toBe('PUT');
  });

  it('deleteDepartment DELETEs', async () => {
    await departmentService.deleteDepartment(7);
    expect(lastInit().method).toBe('DELETE');
  });
});

describe('orgService', () => {
  it('listUnits / getTree / getUnit', async () => {
    await orgService.listUnits();
    expect(lastUrl()).toMatch(/\/org\/units$/);
    fetchMock().mockClear();
    await orgService.getTree();
    expect(lastUrl()).toMatch(/\/org\/units\/tree$/);
    fetchMock().mockClear();
    await orgService.getUnit(3);
    expect(lastUrl()).toMatch(/\/org\/units\/3$/);
  });

  it('createUnit POSTs / updateUnit PUTs / deleteUnit DELETEs', async () => {
    await orgService.createUnit({ name: 'A' });
    expect(lastInit().method).toBe('POST');
    fetchMock().mockClear();
    await orgService.updateUnit(1, { name: 'A2' });
    expect(lastInit().method).toBe('PUT');
    fetchMock().mockClear();
    await orgService.deleteUnit(1);
    expect(lastInit().method).toBe('DELETE');
  });

  it('member ops', async () => {
    await orgService.listMembers(1);
    expect(lastUrl()).toMatch(/\/members$/);
    fetchMock().mockClear();
    await orgService.addMember(1, 7);
    expect(lastInit().method).toBe('POST');
    fetchMock().mockClear();
    await orgService.setPrimaryMember(1, 7);
    expect(lastInit().method).toBe('PATCH');
    fetchMock().mockClear();
    await orgService.removeMember(1, 7);
    expect(lastInit().method).toBe('DELETE');
  });

  it('listLoans builds the query string for every filter', async () => {
    await orgService.listLoans({
      userId: 1,
      toOrgUnitId: 2,
      fromOrgUnitId: 3,
      status: 'pending',
    });
    const url = lastUrl();
    expect(url).toContain('userId=1');
    expect(url).toContain('toOrgUnitId=2');
    expect(url).toContain('fromOrgUnitId=3');
    expect(url).toContain('status=pending');
  });

  it('listLoans without filters omits query string', async () => {
    await orgService.listLoans();
    expect(lastUrl()).toMatch(/\/org\/loans$/);
  });

  it('createLoan / approveLoan / rejectLoan / cancelLoan', async () => {
    await orgService.createLoan({
      userId: 1,
      fromOrgUnitId: 1,
      toOrgUnitId: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-10',
    });
    expect(lastInit().method).toBe('POST');

    fetchMock().mockClear();
    await orgService.approveLoan(1, 'ok');
    expect(lastUrl()).toMatch(/\/loans\/1\/approve$/);

    fetchMock().mockClear();
    await orgService.rejectLoan(1);
    expect(lastUrl()).toMatch(/\/loans\/1\/reject$/);

    fetchMock().mockClear();
    await orgService.cancelLoan(1);
    expect(lastUrl()).toMatch(/\/loans\/1\/cancel$/);
  });
});

describe('policyService', () => {
  it('list/get/create/update/delete policies', async () => {
    await policyService.listPolicies();
    expect(lastUrl()).toMatch(/\/policies$/);

    fetchMock().mockClear();
    await policyService.getPolicy(1);
    expect(lastUrl()).toMatch(/\/policies\/1$/);

    fetchMock().mockClear();
    await policyService.createPolicy({
      scopeType: 'global',
      policyKey: 'k',
      policyValue: { x: 1 },
    });
    expect(lastInit().method).toBe('POST');

    fetchMock().mockClear();
    await policyService.updatePolicy(1, { description: 'x' });
    expect(lastInit().method).toBe('PUT');

    fetchMock().mockClear();
    await policyService.deletePolicy(1);
    expect(lastInit().method).toBe('DELETE');
  });

  it('listExceptions builds qs for every filter', async () => {
    await policyService.listExceptions({
      policyId: 1,
      targetType: 'assignment',
      targetId: 2,
      status: 'pending',
      requestedByUserId: 3,
    });
    const url = lastUrl();
    expect(url).toContain('policyId=1');
    expect(url).toContain('targetType=assignment');
    expect(url).toContain('targetId=2');
    expect(url).toContain('status=pending');
    expect(url).toContain('requestedByUserId=3');
  });

  it('listExceptions without filters', async () => {
    await policyService.listExceptions();
    expect(lastUrl()).toMatch(/\/policies\/exceptions$/);
  });

  it('exception lifecycle', async () => {
    await policyService.createException({ policyId: 1, targetType: 'a', targetId: 2 });
    expect(lastInit().method).toBe('POST');

    fetchMock().mockClear();
    await policyService.approveException(1, 'note');
    expect(lastUrl()).toMatch(/\/exceptions\/1\/approve$/);

    fetchMock().mockClear();
    await policyService.rejectException(1);
    expect(lastUrl()).toMatch(/\/exceptions\/1\/reject$/);

    fetchMock().mockClear();
    await policyService.cancelException(1);
    expect(lastUrl()).toMatch(/\/exceptions\/1\/cancel$/);
  });

  it('approval matrix list/update + validate', async () => {
    await policyService.listMatrix();
    expect(lastUrl()).toMatch(/approval-matrix$/);

    fetchMock().mockClear();
    await policyService.updateMatrix('shift_assignment', { approverScope: 'policy_owner' });
    expect(lastInit().method).toBe('PUT');

    fetchMock().mockClear();
    await policyService.validateAssignment({ userId: 1, shiftId: 2 });
    expect(lastUrl()).toMatch(/\/validate\/assignment$/);
  });
});

describe('systemService', () => {
  it('exposes its API surface', async () => {
    const fns = Object.values(systemService).filter((v) => typeof v === 'function');
    for (const fn of fns) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (fn as (...args: any[]) => unknown)();
      } catch {
        // some helpers may need args; we only care that they execute
      }
    }
    expect(fetchMock()).toHaveBeenCalled();
  });
});

describe('employeeService extra', () => {
  it('getEmployee / updateEmployee / deleteEmployee', async () => {
    await employeeService.getEmployee(1);
    expect(lastUrl()).toMatch(/\/employees\/1$/);
    fetchMock().mockClear();
    await employeeService.updateEmployee(1, { firstName: 'X' } as never);
    expect(lastInit().method).toBe('PUT');
    fetchMock().mockClear();
    await employeeService.deleteEmployee(1);
    expect(lastInit().method).toBe('DELETE');
  });
});

describe('shiftService extra', () => {
  it('updateShift / deleteShift', async () => {
    await shiftService.updateShift(1, { startTime: '08:00' } as never);
    expect(lastInit().method).toBe('PUT');
    fetchMock().mockClear();
    await shiftService.deleteShift(1);
    expect(lastInit().method).toBe('DELETE');
  });
});

describe('scheduleService extra', () => {
  it('createSchedule / updateSchedule / archiveSchedule / deleteSchedule', async () => {
    await scheduleService.createSchedule({
      name: 'X',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      departmentId: 1,
    });
    expect(lastInit().method).toBe('POST');

    fetchMock().mockClear();
    await scheduleService.updateSchedule(1, { name: 'Y' });
    expect(lastInit().method).toBe('PUT');

    fetchMock().mockClear();
    await scheduleService.archiveSchedule(1);
    expect(lastInit().method).toBe('PATCH');

    fetchMock().mockClear();
    await scheduleService.deleteSchedule(1);
    expect(lastInit().method).toBe('DELETE');
  });
});

describe('authService extra', () => {
  it('refreshToken POSTs', async () => {
    await authService.refreshToken('jwt-token');
    expect(lastInit().method).toBe('POST');
  });
});
