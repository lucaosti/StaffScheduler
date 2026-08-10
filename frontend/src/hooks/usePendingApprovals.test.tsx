import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { pendingApprovalsKey, usePendingApprovalsQuery } from './usePendingApprovals';
import { listPendingApprovals } from '../services/pendingApprovalService';

jest.mock('../services/pendingApprovalService', () => ({ __esModule: true, listPendingApprovals: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('usePendingApprovalsQuery', () => {
  it('passes status=pending for the pending filter', async () => {
    (listPendingApprovals as jest.Mock).mockResolvedValue({ data: { items: [{ id: 1 }], total: 1 } });
    const { result } = renderHook(() => usePendingApprovalsQuery('pending'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listPendingApprovals).toHaveBeenCalledWith('pending');
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('passes no status for the "all" filter', async () => {
    (listPendingApprovals as jest.Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderHook(() => usePendingApprovalsQuery('all'), { wrapper: makeWrapper() });
    await waitFor(() => expect(listPendingApprovals).toHaveBeenCalledWith(undefined));
  });

  it('defaults to an empty list when the response carries no items', async () => {
    (listPendingApprovals as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => usePendingApprovalsQuery('pending'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is keyed under ["pending-approvals", filter], so switching filters refetches', () => {
    expect(pendingApprovalsKey).toEqual(['pending-approvals']);
  });
});
