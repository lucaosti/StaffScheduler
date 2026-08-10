import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { approvalWorkflowsKey, useApprovalWorkflowsQuery } from './useApprovalWorkflows';
import { listWorkflows } from '../services/approvalWorkflowService';

jest.mock('../services/approvalWorkflowService', () => ({ __esModule: true, listWorkflows: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useApprovalWorkflowsQuery', () => {
  it('returns the workflow list', async () => {
    (listWorkflows as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useApprovalWorkflowsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('defaults to an empty list', async () => {
    (listWorkflows as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useApprovalWorkflowsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is keyed under ["approval-workflows"]', () => {
    expect(approvalWorkflowsKey).toEqual(['approval-workflows']);
  });
});
