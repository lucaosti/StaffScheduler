/**
 * Smoke tests for page-level components.
 *
 * Each test renders the page once with all its service dependencies
 * mocked to return empty / harmless data. The goal is to catch
 * top-level rendering / wiring regressions and to provide baseline
 * coverage for the larger page modules without recreating the full
 * MSW story for each.
 *
 * The richer "loading / success / error / interaction" tests live in
 * each page's dedicated `*.test.tsx` file (Dashboard, Reports,
 * Settings, Login).
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const okResponse = <T,>(data: T) =>
  Promise.resolve({ success: true as const, data });

jest.mock('../services/scheduleService', () => ({
  __esModule: true,
  getSchedules: jest.fn(() => okResponse([])),
  getSchedule: jest.fn(() => okResponse(null)),
  createSchedule: jest.fn(() => okResponse({ id: 1 })),
  updateSchedule: jest.fn(() => okResponse({ id: 1 })),
  deleteSchedule: jest.fn(() => okResponse(undefined)),
  generateSchedule: jest.fn(() => okResponse({ id: 1 })),
  publishSchedule: jest.fn(() => okResponse({ id: 1 })),
}));

jest.mock('../services/employeeService', () => ({
  __esModule: true,
  getEmployees: jest.fn(() => okResponse({ data: [], pagination: { total: 0, page: 1, totalPages: 1, limit: 20 } })),
  getEmployee: jest.fn(() => okResponse(null)),
  createEmployee: jest.fn(() => okResponse({ id: 1 })),
  updateEmployee: jest.fn(() => okResponse({ id: 1 })),
  deleteEmployee: jest.fn(() => okResponse(undefined)),
}));

jest.mock('../services/shiftService', () => ({
  __esModule: true,
  getShifts: jest.fn(() => okResponse([])),
  createShift: jest.fn(() => okResponse({ id: 1 })),
  updateShift: jest.fn(() => okResponse({ id: 1 })),
  deleteShift: jest.fn(() => okResponse(undefined)),
}));

jest.mock('../services/departmentService', () => ({
  __esModule: true,
  getDepartments: jest.fn(() => okResponse([])),
}));

jest.mock('../services/orgService', () => ({
  __esModule: true,
  listOrgUnits: jest.fn(() => okResponse([])),
  getOrgUnitTree: jest.fn(() => okResponse([])),
  createOrgUnit: jest.fn(() => okResponse({ id: 1 })),
  updateOrgUnit: jest.fn(() => okResponse({ id: 1 })),
  deleteOrgUnit: jest.fn(() => okResponse(undefined)),
  setPrimaryUnit: jest.fn(() => okResponse(undefined)),
  listLoans: jest.fn(() => okResponse([])),
  createLoan: jest.fn(() => okResponse({ id: 1 })),
  approveLoan: jest.fn(() => okResponse({ id: 1 })),
  rejectLoan: jest.fn(() => okResponse({ id: 1 })),
  cancelLoan: jest.fn(() => okResponse({ id: 1 })),
  listMembers: jest.fn(() => okResponse([])),
  addMember: jest.fn(() => okResponse(undefined)),
  removeMember: jest.fn(() => okResponse(undefined)),
}));

jest.mock('../services/policyService', () => ({
  __esModule: true,
  listPolicies: jest.fn(() => okResponse([])),
  createPolicy: jest.fn(() => okResponse({ id: 1 })),
  updatePolicy: jest.fn(() => okResponse({ id: 1 })),
  deletePolicy: jest.fn(() => okResponse(undefined)),
  listExceptions: jest.fn(() => okResponse([])),
  approveException: jest.fn(() => okResponse({ id: 1 })),
  rejectException: jest.fn(() => okResponse({ id: 1 })),
  cancelException: jest.fn(() => okResponse({ id: 1 })),
  createException: jest.fn(() => okResponse({ id: 1 })),
  listApprovalMatrix: jest.fn(() => okResponse([])),
  upsertApprovalRule: jest.fn(() => okResponse({ id: 1 })),
  deleteApprovalRule: jest.fn(() => okResponse(undefined)),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, email: 'admin@x', role: 'admin' },
  }),
}));

describe('Page smoke tests', () => {
  it('Schedule renders without throwing', async () => {
    const { default: Schedule } = await import('./Schedule/Schedule');
    render(<Schedule />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/schedule/i).length
      ).toBeGreaterThan(0)
    );
  });

  it('Shifts renders without throwing', async () => {
    const { default: Shifts } = await import('./Shifts/Shifts');
    render(<Shifts />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/shift/i).length
      ).toBeGreaterThan(0)
    );
  });

  it('Employees renders without throwing', async () => {
    const { default: Employees } = await import('./Employees/Employees');
    render(<Employees />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/employees?/i).length
      ).toBeGreaterThan(0)
    );
  });

  it('OrgManagement renders without throwing', async () => {
    const { default: Org } = await import('./Org/OrgManagement');
    render(<Org />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/organization|org/i).length
      ).toBeGreaterThan(0)
    );
  });

  it('Policies renders without throwing', async () => {
    const { default: Policies } = await import('./Policies/Policies');
    render(<Policies />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/polic(y|ies)/i).length
      ).toBeGreaterThan(0)
    );
  });

  it('Policies tabs are clickable', async () => {
    const { default: Policies } = await import('./Policies/Policies');
    render(<Policies />);
    const tabs = await screen.findAllByRole('button');
    if (tabs.length > 1) {
      await userEvent.click(tabs[1]);
    }
  });
});
