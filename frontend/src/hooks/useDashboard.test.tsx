import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDashboardData, useAttentionItems, useRecentActivity } from './useDashboard';
import { getDashboardStats, getAttentionItems, getRecentActivity } from '../services/dashboardService';

jest.mock('../services/dashboardService', () => ({
  __esModule: true,
  getDashboardStats: jest.fn(),
  getAttentionItems: jest.fn(),
  getRecentActivity: jest.fn(),
}));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useDashboardData', () => {
  it('loads the stats, and not the activity feed', async () => {
    (getDashboardStats as jest.Mock).mockResolvedValue({ success: true, data: { totalEmployees: 5 } });
    const { result } = renderHook(() => useDashboardData(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ totalEmployees: 5 });
    expect(getRecentActivity).not.toHaveBeenCalled();
  });

  it('throws when the stats fetch is unsuccessful', async () => {
    (getDashboardStats as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useDashboardData(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRecentActivity', () => {
  it('loads the latest five entries when enabled', async () => {
    (getRecentActivity as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useRecentActivity(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getRecentActivity).toHaveBeenCalledWith(5);
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('makes no request when disabled (the caller lacks audit.read)', () => {
    renderHook(() => useRecentActivity(false), { wrapper: makeWrapper() });
    expect(getRecentActivity).not.toHaveBeenCalled();
  });
});

describe('useAttentionItems', () => {
  it('is a separate query from dashboard stats', async () => {
    (getAttentionItems as jest.Mock).mockResolvedValue({
      success: true,
      data: { understaffedShifts: 2, pendingApprovals: 1 },
    });
    const { result } = renderHook(() => useAttentionItems(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ understaffedShifts: 2, pendingApprovals: 1 });
  });

  it('throws when unsuccessful', async () => {
    (getAttentionItems as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useAttentionItems(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
