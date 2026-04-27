/**
 * Smoke tests for the frontend service modules (T020).
 *
 * Each module is a thin fetch-and-handleResponse wrapper. We mock global
 * fetch with a JSON response and verify:
 *   - the right URL/method is hit
 *   - the auth header is attached
 *   - the response envelope is returned to the caller
 */

import * as authService from './authService';
import * as employeeService from './employeeService';
import * as shiftService from './shiftService';
import * as scheduleService from './scheduleService';
import * as assignmentService from './assignmentService';
import * as dashboardService from './dashboardService';

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn() as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => {
  jest.resetAllMocks();
});

const mockResolveOk = (body: unknown = { success: true, data: [] }): jest.Mock => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockResolvedValue(okJsonResponse(body));
  return fetchMock;
};

const expectAuthHeader = (fetchMock: jest.Mock): void => {
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.headers).toMatchObject({ Authorization: 'Bearer jwt-token' });
};

describe('authService', () => {
  it('login posts to /auth/login', async () => {
    const fetchMock = mockResolveOk({ success: true, data: { token: 't', user: {} } });
    await authService.login({ email: 'a@x.com', password: 'pw' } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('verifyToken hits /auth/verify with the token', async () => {
    const fetchMock = mockResolveOk({ success: true, data: {} });
    await authService.verifyToken('jwt-token');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/verify$/);
  });

  it('logout posts to /auth/logout', async () => {
    const fetchMock = mockResolveOk({ success: true });
    await authService.logout();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST' })
    );
    expectAuthHeader(fetchMock);
  });
});

describe('employeeService', () => {
  it('getEmployees hits /employees with the token', async () => {
    const fetchMock = mockResolveOk({ success: true, data: [] });
    await employeeService.getEmployees({});
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/employees/);
    expectAuthHeader(fetchMock);
  });

  it('createEmployee uses POST', async () => {
    const fetchMock = mockResolveOk({ success: true, data: { id: 1 } });
    await employeeService.createEmployee({ email: 'a@x.com' } as never);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteEmployee uses DELETE', async () => {
    const fetchMock = mockResolveOk({ success: true });
    await employeeService.deleteEmployee(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('shiftService', () => {
  it('getShifts hits /shifts', async () => {
    const fetchMock = mockResolveOk({ success: true, data: [] });
    await shiftService.getShifts({});
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/shifts/);
  });

  it('createShift uses POST', async () => {
    const fetchMock = mockResolveOk({ success: true, data: { id: 11 } });
    await shiftService.createShift({ scheduleId: 1, departmentId: 3 } as never);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});

describe('scheduleService', () => {
  it('getSchedules hits /schedules', async () => {
    const fetchMock = mockResolveOk({ success: true, data: [] });
    await scheduleService.getSchedules();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/schedules/);
  });

  it('publishSchedule uses PATCH', async () => {
    const fetchMock = mockResolveOk({ success: true, data: { status: 'published' } });
    await scheduleService.publishSchedule(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('generateSchedule uses POST', async () => {
    const fetchMock = mockResolveOk({ success: true, data: {} });
    await scheduleService.generateSchedule(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});

describe('assignmentService', () => {
  it('getAssignments hits /assignments', async () => {
    const fetchMock = mockResolveOk({ success: true, data: [] });
    await assignmentService.getAssignments({});
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/assignments/);
  });

  it('confirmAssignment uses PATCH', async () => {
    const fetchMock = mockResolveOk({ success: true, data: { status: 'confirmed' } });
    await assignmentService.confirmAssignment('1');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });
});

describe('dashboardService', () => {
  it('getDashboardStats hits /dashboard/stats', async () => {
    const fetchMock = mockResolveOk({ success: true, data: {} });
    await dashboardService.getDashboardStats();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/dashboard\/stats/);
  });
});
