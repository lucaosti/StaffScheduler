import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDashboardData, useAttentionItems } from './useDashboard';
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
  it('loads stats and recent activity together', async () => {
    (getDashboardStats as jest.Mock).mockResolvedValue({ success: true, data: { totalEmployees: 5 } });
    (getRecentActivity as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useDashboardData(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getRecentActivity).toHaveBeenCalledWith(5);
    expect(result.current.data).toEqual({ stats: { totalEmployees: 5 }, recentActivity: [{ id: 1 }] });
  });

  it('throws when the stats fetch is unsuccessful', async () => {
    (getDashboardStats as jest.Mock).mockResolvedValue({ success: false });
    (getRecentActivity as jest.Mock).mockResolvedValue([]);
    const { result } = renderHook(() => useDashboardData(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
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
