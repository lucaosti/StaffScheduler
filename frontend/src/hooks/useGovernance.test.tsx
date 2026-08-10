import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  governanceKeys,
  useResponsibilityMatrixQuery,
  useResponsibilityRulesQuery,
  useChangeRequestsQuery,
} from './useGovernance';
import { getResponsibilityMatrix, listResponsibilityRules } from '../services/responsibilityService';
import { listChangeRequests } from '../services/changeRequestService';

jest.mock('../services/responsibilityService', () => ({
  __esModule: true,
  getResponsibilityMatrix: jest.fn(),
  listResponsibilityRules: jest.fn(),
}));
jest.mock('../services/changeRequestService', () => ({
  __esModule: true,
  listChangeRequests: jest.fn(),
}));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useResponsibilityMatrixQuery', () => {
  it('uses the matrix key and returns the matrix array', async () => {
    (getResponsibilityMatrix as jest.Mock).mockResolvedValue({
      data: { matrix: [{ role: 'admin' }] },
    });
    const { result } = renderHook(() => useResponsibilityMatrixQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ role: 'admin' }]);
  });

  it('defaults to an empty array when the response carries no matrix', async () => {
    (getResponsibilityMatrix as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useResponsibilityMatrixQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useResponsibilityRulesQuery', () => {
  it('does not fetch when disabled', () => {
    renderHook(() => useResponsibilityRulesQuery(false), { wrapper: makeWrapper() });
    expect(listResponsibilityRules).not.toHaveBeenCalled();
  });

  it('fetches active rules only when enabled', async () => {
    (listResponsibilityRules as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const { result } = renderHook(() => useResponsibilityRulesQuery(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listResponsibilityRules).toHaveBeenCalledWith({ isActive: true });
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('returns an empty array on an unsuccessful response', async () => {
    (listResponsibilityRules as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useResponsibilityRulesQuery(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useChangeRequestsQuery', () => {
  it('does not fetch when disabled', () => {
    renderHook(() => useChangeRequestsQuery(false, ''), { wrapper: makeWrapper() });
    expect(listChangeRequests).not.toHaveBeenCalled();
  });

  it('passes status and proposerUserId filters only when set', async () => {
    (listChangeRequests as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    });
    renderHook(() => useChangeRequestsQuery(true, 'pending', 7), { wrapper: makeWrapper() });
    await waitFor(() => expect(listChangeRequests).toHaveBeenCalledWith({ status: 'pending', proposerUserId: 7 }));
  });

  it('omits an empty status filter', async () => {
    (listChangeRequests as jest.Mock).mockResolvedValue({ success: true, data: { items: [], total: 0 } });
    renderHook(() => useChangeRequestsQuery(true, ''), { wrapper: makeWrapper() });
    await waitFor(() => expect(listChangeRequests).toHaveBeenCalledWith({}));
  });

  it('returns the empty-page fallback on an unsuccessful response', async () => {
    (listChangeRequests as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useChangeRequestsQuery(true, ''), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [], total: 0 });
  });

  it('keys change requests by status and proposer so filters do not collide in cache', () => {
    expect(governanceKeys.changeRequests('pending', 7)).toEqual([
      'change-requests',
      { status: 'pending', proposerUserId: 7 },
    ]);
    expect(governanceKeys.changeRequests('')).toEqual([
      'change-requests',
      { status: '', proposerUserId: null },
    ]);
  });
});
