import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useEmployeesQuery,
  useDepartmentsQuery,
  useDeleteEmployee,
  useSaveEmployee,
} from './useEmployees';
import * as employeeService from '../services/employeeService';
import { getDepartments } from '../services/departmentService';

jest.mock('../services/employeeService', () => ({
  __esModule: true,
  getEmployees: jest.fn(),
  deleteEmployee: jest.fn(),
  updateEmployee: jest.fn(),
  createEmployee: jest.fn(),
}));
jest.mock('../services/departmentService', () => ({ __esModule: true, getDepartments: jest.fn() }));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useEmployeesQuery', () => {
  it('passes search/department filters and a fixed pageSize', async () => {
    (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(() => useEmployeesQuery('jane', 'ICU'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(employeeService.getEmployees).toHaveBeenCalledWith({
      search: 'jane',
      department: 'ICU',
      pageSize: 50,
    });
  });

  it('omits empty search/department rather than sending blank strings', async () => {
    (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: true, data: [] });
    renderHook(() => useEmployeesQuery('', ''), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() =>
      expect(employeeService.getEmployees).toHaveBeenCalledWith({
        search: undefined,
        department: undefined,
        pageSize: 50,
      })
    );
  });

  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useEmployeesQuery('', '', false), { wrapper: makeWrapper(makeClient()) });
    expect(employeeService.getEmployees).not.toHaveBeenCalled();
  });

  it('throws with the server error message on failure', async () => {
    (employeeService.getEmployees as jest.Mock).mockResolvedValue({
      success: false,
      error: { message: 'no access' },
    });
    const { result } = renderHook(() => useEmployeesQuery('', ''), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('no access');
  });
});

describe('useDepartmentsQuery (from useEmployees)', () => {
  it('returns departments and throws on failure', async () => {
    (getDepartments as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(() => useDepartmentsQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('throws on an unsuccessful response', async () => {
    (getDepartments as jest.Mock).mockResolvedValue({ success: false, error: { message: 'boom' } });
    const { result } = renderHook(() => useDepartmentsQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDeleteEmployee', () => {
  it('invalidates the employees cache on success', async () => {
    (employeeService.deleteEmployee as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteEmployee(), { wrapper: makeWrapper(client) });

    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['employees'] });
  });
});

describe('useSaveEmployee', () => {
  it('creates when no id is given', async () => {
    (employeeService.createEmployee as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const { result } = renderHook(() => useSaveEmployee(), { wrapper: makeWrapper(makeClient()) });

    result.current.mutate({ data: { email: 'a@x.com' } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(employeeService.createEmployee).toHaveBeenCalled();
    expect(employeeService.updateEmployee).not.toHaveBeenCalled();
  });

  it('updates when an id is given', async () => {
    (employeeService.updateEmployee as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const { result } = renderHook(() => useSaveEmployee(), { wrapper: makeWrapper(makeClient()) });

    result.current.mutate({ id: 1, data: { email: 'a@x.com' } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(employeeService.updateEmployee).toHaveBeenCalledWith(1, { email: 'a@x.com' });
  });
});
