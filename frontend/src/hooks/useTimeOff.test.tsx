import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTimeOffQuery, useTimeOffMutations } from './useTimeOff';
import {
  approveTimeOff,
  cancelTimeOff,
  createTimeOffRequest,
  getTimeOffRequests,
  rejectTimeOff,
} from '../services/timeOffService';

jest.mock('../services/timeOffService', () => ({
  __esModule: true,
  approveTimeOff: jest.fn(),
  cancelTimeOff: jest.fn(),
  createTimeOffRequest: jest.fn(),
  getTimeOffRequests: jest.fn(),
  rejectTimeOff: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useTimeOffQuery', () => {
  it('fetches with the given filters by default (enabled)', async () => {
    (getTimeOffRequests as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useTimeOffQuery({ status: 'pending' } as never), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTimeOffRequests).toHaveBeenCalledWith({ status: 'pending' });
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useTimeOffQuery({}, false), { wrapper: makeWrapper(makeClient()) });
    expect(getTimeOffRequests).not.toHaveBeenCalled();
  });
});

describe('useTimeOffMutations', () => {
  beforeEach(() => {
    (createTimeOffRequest as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (approveTimeOff as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (rejectTimeOff as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (cancelTimeOff as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('request/approve/reject/cancel each invalidate the shared time-off cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTimeOffMutations(), { wrapper: makeWrapper(client) });

    result.current.request.mutate({ startDate: '2026-02-01', endDate: '2026-02-05', type: 'vacation' });
    await waitFor(() => expect(result.current.request.isSuccess).toBe(true));

    result.current.approve.mutate({ id: 1, notes: 'ok' });
    await waitFor(() => expect(result.current.approve.isSuccess).toBe(true));

    result.current.reject.mutate({ id: 1 });
    await waitFor(() => expect(result.current.reject.isSuccess).toBe(true));

    result.current.cancel.mutate(1);
    await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true));

    const invalidatedKeys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys.every((k) => JSON.stringify(k) === JSON.stringify(['time-off']))).toBe(true);
    expect(invalidatedKeys.length).toBe(4);
  });
});
