import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  rbacKeys,
  useRolesAndPermissionsQuery,
  useRbacOrgUnitsQuery,
  useEmployeeSearchQuery,
  useUserRolesQuery,
  useRoleTimelineQuery,
} from './useRbac';
import { listUnits } from '../services/orgService';
import { listPermissions, listRoles, getUserRoles, getUserRoleTimeline, getRoleTimeline } from '../services/rbacService';
import { getEmployees } from '../services/employeeService';

jest.mock('../services/orgService', () => ({ __esModule: true, listUnits: jest.fn() }));
jest.mock('../services/rbacService', () => ({
  __esModule: true,
  listPermissions: jest.fn(),
  listRoles: jest.fn(),
  getUserRoles: jest.fn(),
  getUserRoleTimeline: jest.fn(),
  getRoleTimeline: jest.fn(),
}));
jest.mock('../services/employeeService', () => ({ __esModule: true, getEmployees: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useRolesAndPermissionsQuery', () => {
  it('loads roles and permissions together', async () => {
    (listRoles as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1, name: 'Admin' }] });
    (listPermissions as jest.Mock).mockResolvedValue({ success: true, data: [{ code: 'x' }] });
    const { result } = renderHook(() => useRolesAndPermissionsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      roles: [{ id: 1, name: 'Admin' }],
      permissions: [{ code: 'x' }],
    });
  });

  it('defaults each list to empty on an unsuccessful response', async () => {
    (listRoles as jest.Mock).mockResolvedValue({ success: false });
    (listPermissions as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useRolesAndPermissionsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ roles: [], permissions: [] });
  });
});

describe('useRbacOrgUnitsQuery', () => {
  it('returns org units', async () => {
    (listUnits as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(() => useRbacOrgUnitsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });
});

describe('useEmployeeSearchQuery', () => {
  it('does not fetch for an empty (or whitespace-only) query', () => {
    renderHook(() => useEmployeeSearchQuery('   '), { wrapper: makeWrapper() });
    expect(getEmployees).not.toHaveBeenCalled();
  });

  it('fetches with the trimmed query once non-empty', async () => {
    (getEmployees as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(() => useEmployeeSearchQuery('  jane  '), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getEmployees).toHaveBeenCalledWith({ search: 'jane' });
  });
});

describe('useUserRolesQuery', () => {
  it('does not fetch when no user is selected', () => {
    renderHook(() => useUserRolesQuery(null), { wrapper: makeWrapper() });
    expect(getUserRoles).not.toHaveBeenCalled();
  });

  it('fetches roles for the selected user', async () => {
    (getUserRoles as jest.Mock).mockResolvedValue({ success: true, data: [{ roleId: 2 }] });
    const { result } = renderHook(() => useUserRolesQuery(9), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getUserRoles).toHaveBeenCalledWith(9);
    expect(result.current.data).toEqual([{ roleId: 2 }]);
  });
});

describe('useRoleTimelineQuery', () => {
  it('does not fetch when no subject is given', () => {
    renderHook(() => useRoleTimelineQuery(null), { wrapper: makeWrapper() });
    expect(getUserRoleTimeline).not.toHaveBeenCalled();
    expect(getRoleTimeline).not.toHaveBeenCalled();
  });

  it('fetches the user timeline for a user subject', async () => {
    (getUserRoleTimeline as jest.Mock).mockResolvedValue({ data: { entries: [] } });
    const { result } = renderHook(() => useRoleTimelineQuery({ kind: 'user', id: 5 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getUserRoleTimeline).toHaveBeenCalledWith(5);
  });

  it('fetches the role timeline for a role subject', async () => {
    (getRoleTimeline as jest.Mock).mockResolvedValue({ data: { entries: [] } });
    renderHook(() => useRoleTimelineQuery({ kind: 'role', id: 3 }), { wrapper: makeWrapper() });
    await waitFor(() => expect(getRoleTimeline).toHaveBeenCalledWith(3));
  });
});

describe('rbacKeys', () => {
  it('keys the employee search and user-roles queries by their argument', () => {
    expect(rbacKeys.employeeSearch('jane')).toEqual(['rbac', 'employee-search', 'jane']);
    expect(rbacKeys.userRoles(9)).toEqual(['rbac', 'user-roles', 9]);
  });
});
