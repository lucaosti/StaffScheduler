import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRangeReportsQuery, useReportSchedulesQuery, useFairnessQuery } from './useReports';
import { costByDepartment, fairnessReport, hoursWorked } from '../services/reportsService';
import { getSchedules } from '../services/scheduleService';

jest.mock('../services/reportsService', () => ({
  __esModule: true,
  hoursWorked: jest.fn(),
  costByDepartment: jest.fn(),
  fairnessReport: jest.fn(),
}));
jest.mock('../services/scheduleService', () => ({ __esModule: true, getSchedules: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useRangeReportsQuery', () => {
  it('loads hours and cost together for the given range', async () => {
    (hoursWorked as jest.Mock).mockResolvedValue({ success: true, data: [{ userId: 1, hours: 40 }] });
    (costByDepartment as jest.Mock).mockResolvedValue({ success: true, data: [{ departmentId: 1, cost: 500 }] });
    const { result } = renderHook(() => useRangeReportsQuery('2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoursWorked).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
    expect(costByDepartment).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
    expect(result.current.data).toEqual({
      hours: [{ userId: 1, hours: 40 }],
      cost: [{ departmentId: 1, cost: 500 }],
    });
  });

  it('defaults each side to empty on an unsuccessful response', async () => {
    (hoursWorked as jest.Mock).mockResolvedValue({ success: false });
    (costByDepartment as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useRangeReportsQuery('2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ hours: [], cost: [] });
  });
});

describe('useReportSchedulesQuery', () => {
  it('returns schedules, defaulting to empty', async () => {
    (getSchedules as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useReportSchedulesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useFairnessQuery', () => {
  it('does not fetch when no schedule is selected', () => {
    renderHook(() => useFairnessQuery(null), { wrapper: makeWrapper() });
    expect(fairnessReport).not.toHaveBeenCalled();
  });

  it('fetches the fairness report for the selected schedule', async () => {
    (fairnessReport as jest.Mock).mockResolvedValue({ success: true, data: { spread: 3 } });
    const { result } = renderHook(() => useFairnessQuery(7), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fairnessReport).toHaveBeenCalledWith(7);
    expect(result.current.data).toEqual({ spread: 3 });
  });

  it('yields null on an unsuccessful response', async () => {
    (fairnessReport as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useFairnessQuery(7), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
