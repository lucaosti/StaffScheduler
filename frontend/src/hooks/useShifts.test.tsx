import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShiftsInRange, useShiftsPageData, useDeleteShift, useSaveShift } from './useShifts';
import * as shiftService from '../services/shiftService';
import { getSchedules } from '../services/scheduleService';
import { getDepartments } from '../services/departmentService';

jest.mock('../services/shiftService', () => ({
  __esModule: true,
  getShifts: jest.fn(),
  deleteShift: jest.fn(),
  updateShift: jest.fn(),
  createShift: jest.fn(),
}));
jest.mock('../services/scheduleService', () => ({ __esModule: true, getSchedules: jest.fn() }));
jest.mock('../services/departmentService', () => ({ __esModule: true, getDepartments: jest.fn() }));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useShiftsInRange', () => {
  it('does not fetch when disabled (e.g. the month view is not shown)', () => {
    renderHook(() => useShiftsInRange({ startDate: '2026-01-01', endDate: '2026-01-31' }, { enabled: false }), {
      wrapper: makeWrapper(makeClient()),
    });
    expect(shiftService.getShifts).not.toHaveBeenCalled();
  });

  it('fetches with the range (and department, when given) by default', async () => {
    (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(
      () => useShiftsInRange({ startDate: '2026-01-01', endDate: '2026-01-31', departmentId: 3 }),
      { wrapper: makeWrapper(makeClient()) }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(shiftService.getShifts).toHaveBeenCalledWith({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      departmentId: 3,
    });
  });

  it('throws on an unsuccessful response', async () => {
    (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: false, error: { message: 'boom' } });
    const { result } = renderHook(() => useShiftsInRange({ startDate: '2026-01-01', endDate: '2026-01-31' }), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});

describe('useShiftsPageData', () => {
  it('loads all three lists together', async () => {
    (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    (getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 2 }] });
    (getDepartments as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 3 }] });
    const { result } = renderHook(() => useShiftsPageData(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      shifts: [{ id: 1 }],
      schedules: [{ id: 2 }],
      departments: [{ id: 3 }],
    });
  });

  it('throws when the critical shifts call fails', async () => {
    (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: false });
    (getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (getDepartments as jest.Mock).mockResolvedValue({ success: true, data: [] });
    const { result } = renderHook(() => useShiftsPageData(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('degrades schedules/departments to empty on their own failure', async () => {
    (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (getSchedules as jest.Mock).mockResolvedValue({ success: false });
    (getDepartments as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useShiftsPageData(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ shifts: [], schedules: [], departments: [] });
  });
});

describe('useDeleteShift', () => {
  it('invalidates the shifts-page cache', async () => {
    (shiftService.deleteShift as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteShift(), { wrapper: makeWrapper(client) });

    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['shifts-page'] });
  });
});

describe('useSaveShift', () => {
  it('creates when no id is given', async () => {
    (shiftService.createShift as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const { result } = renderHook(() => useSaveShift(), { wrapper: makeWrapper(makeClient()) });

    result.current.mutate({ data: { departmentId: 1 } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(shiftService.createShift).toHaveBeenCalled();
    expect(shiftService.updateShift).not.toHaveBeenCalled();
  });

  it('updates when an id is given', async () => {
    (shiftService.updateShift as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const { result } = renderHook(() => useSaveShift(), { wrapper: makeWrapper(makeClient()) });

    result.current.mutate({ id: 1, data: { departmentId: 1 } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(shiftService.updateShift).toHaveBeenCalledWith(1, { departmentId: 1 });
  });
});
