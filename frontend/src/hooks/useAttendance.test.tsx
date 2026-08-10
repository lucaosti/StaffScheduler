import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMyAttendanceQuery,
  usePendingAttendanceQuery,
  useAttendanceCostQuery,
  useAttendanceMutations,
} from './useAttendance';
import {
  clockIn,
  clockOut,
  getAttendanceRecords,
  getPendingApprovals,
  approveAttendance,
  rejectAttendance,
  getCostEstimate,
} from '../services/attendanceService';

jest.mock('../services/attendanceService', () => ({
  __esModule: true,
  clockIn: jest.fn(),
  clockOut: jest.fn(),
  getAttendanceRecords: jest.fn(),
  getPendingApprovals: jest.fn(),
  approveAttendance: jest.fn(),
  rejectAttendance: jest.fn(),
  getCostEstimate: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useMyAttendanceQuery', () => {
  it('passes userId through and defaults to empty', async () => {
    (getAttendanceRecords as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useMyAttendanceQuery(9), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAttendanceRecords).toHaveBeenCalledWith({ userId: 9 });
    expect(result.current.data).toEqual([]);
  });
});

describe('usePendingAttendanceQuery', () => {
  it('does not fetch when disabled (non-approver)', () => {
    renderHook(() => usePendingAttendanceQuery(false), { wrapper: makeWrapper(makeClient()) });
    expect(getPendingApprovals).not.toHaveBeenCalled();
  });

  it('fetches the queue when enabled', async () => {
    (getPendingApprovals as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => usePendingAttendanceQuery(true), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });
});

describe('useAttendanceCostQuery', () => {
  it('does not fetch when disabled (non cost-reader)', () => {
    renderHook(() => useAttendanceCostQuery(false, '2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(makeClient()),
    });
    expect(getCostEstimate).not.toHaveBeenCalled();
  });

  it('fetches and defaults to null when enabled', async () => {
    (getCostEstimate as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useAttendanceCostQuery(true, '2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getCostEstimate).toHaveBeenCalledWith({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.current.data).toBeNull();
  });
});

describe('useAttendanceMutations', () => {
  beforeEach(() => {
    (clockIn as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (clockOut as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (approveAttendance as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (rejectAttendance as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('clockInMutation invalidates the attendance cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAttendanceMutations(), { wrapper: makeWrapper(client) });

    result.current.clockInMutation.mutate({ latitude: 1, longitude: 2 });
    await waitFor(() => expect(result.current.clockInMutation.isSuccess).toBe(true));

    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(['attendance']);
  });

  it('decisionMutation dispatches approve vs reject and invalidates', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAttendanceMutations(), { wrapper: makeWrapper(client) });

    result.current.decisionMutation.mutate({ id: 1, decision: 'approve' });
    await waitFor(() => expect(result.current.decisionMutation.isSuccess).toBe(true));
    expect(approveAttendance).toHaveBeenCalledWith(1);

    result.current.decisionMutation.mutate({ id: 2, decision: 'reject' });
    await waitFor(() => expect(rejectAttendance).toHaveBeenCalledWith(2));
  });

  it('clockOutMutation invalidates the attendance cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAttendanceMutations(), { wrapper: makeWrapper(client) });

    result.current.clockOutMutation.mutate(1);
    await waitFor(() => expect(result.current.clockOutMutation.isSuccess).toBe(true));

    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(['attendance']);
  });
});
