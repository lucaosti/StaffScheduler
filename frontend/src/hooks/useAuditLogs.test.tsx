import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuditLogsQuery } from './useAuditLogs';
import { listAuditLogs } from '../services/auditLogService';

jest.mock('../services/auditLogService', () => ({ __esModule: true, listAuditLogs: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useAuditLogsQuery', () => {
  it('passes the filters through and returns entries + total', async () => {
    (listAuditLogs as jest.Mock).mockResolvedValue({
      data: [{ id: 1 }],
      meta: { total: 42, page: 1, pageSize: 25, pages: 2 },
    });
    const { result } = renderHook(() => useAuditLogsQuery({ entityType: 'shift' } as never), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listAuditLogs).toHaveBeenCalledWith({ entityType: 'shift' });
    expect(result.current.data).toEqual({ entries: [{ id: 1 }], total: 42 });
  });

  it('defaults entries and total when the response carries neither', async () => {
    (listAuditLogs as jest.Mock).mockResolvedValue({ data: undefined, meta: undefined });
    const { result } = renderHook(() => useAuditLogsQuery({} as never), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ entries: [], total: 0 });
  });
});
