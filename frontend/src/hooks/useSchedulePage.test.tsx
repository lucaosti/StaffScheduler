import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { schedulePageKey, useSchedulePageData } from './useSchedulePage';
import * as scheduleService from '../services/scheduleService';
import * as employeeService from '../services/employeeService';
import * as shiftService from '../services/shiftService';
import * as departmentService from '../services/departmentService';

jest.mock('../services/scheduleService', () => ({
  __esModule: true,
  getSchedules: jest.fn(),
  getScheduleWithShifts: jest.fn(),
}));
jest.mock('../services/employeeService', () => ({ __esModule: true, getEmployees: jest.fn() }));
jest.mock('../services/shiftService', () => ({ __esModule: true, getShifts: jest.fn() }));
jest.mock('../services/departmentService', () => ({ __esModule: true, getDepartments: jest.fn() }));

const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => {
  jest.clearAllMocks();
  (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (departmentService.getDepartments as jest.Mock).mockResolvedValue({ success: true, data: [] });
});

describe('useSchedulePageData', () => {
  it('throws when the critical schedules call fails', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
  });

  it('degrades employees/shifts/departments to empty on their own failure, without throwing', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data?.employees).toEqual([]);
  });

  it('flattens assignments from the first schedule only', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
    });
    (scheduleService.getScheduleWithShifts as jest.Mock).mockResolvedValue({
      success: true,
      data: { shifts: [{ id: 1, assignments: [{ id: 100 }] }, { id: 2, assignments: [{ id: 101 }] }] },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(scheduleService.getScheduleWithShifts).toHaveBeenCalledWith(1);
    expect(result.current.query.data?.assignments).toEqual([{ id: 100 }, { id: 101 }]);
  });

  it('skips the assignments fetch when there are no schedules', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(scheduleService.getScheduleWithShifts).not.toHaveBeenCalled();
    expect(result.current.query.data?.assignments).toEqual([]);
  });

  it('reload() invalidates the schedule-page cache', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    await result.current.reload();

    expect(spy).toHaveBeenCalledWith({ queryKey: schedulePageKey });
  });
});
