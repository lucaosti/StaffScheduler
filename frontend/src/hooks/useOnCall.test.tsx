import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMyOnCallQuery,
  useOnCallPeriodsQuery,
  usePeriodAssignmentsQuery,
  useOnCallMutations,
} from './useOnCall';
import {
  assignToPeriod,
  createOnCallPeriod,
  deleteOnCallPeriod,
  getMyOnCall,
  getOnCallPeriods,
  getPeriodAssignments,
  removeFromPeriod,
  updateOnCallPeriod,
} from '../services/onCallService';

jest.mock('../services/onCallService', () => ({
  __esModule: true,
  assignToPeriod: jest.fn(),
  createOnCallPeriod: jest.fn(),
  deleteOnCallPeriod: jest.fn(),
  getMyOnCall: jest.fn(),
  getOnCallPeriods: jest.fn(),
  getPeriodAssignments: jest.fn(),
  removeFromPeriod: jest.fn(),
  updateOnCallPeriod: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useMyOnCallQuery', () => {
  it('returns the caller periods, defaulting to empty', async () => {
    (getMyOnCall as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useMyOnCallQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useOnCallPeriodsQuery', () => {
  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useOnCallPeriodsQuery({}, false), { wrapper: makeWrapper(makeClient()) });
    expect(getOnCallPeriods).not.toHaveBeenCalled();
  });

  it('fetches by default', async () => {
    (getOnCallPeriods as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useOnCallPeriodsQuery({ departmentId: 3 } as never), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getOnCallPeriods).toHaveBeenCalledWith({ departmentId: 3 });
  });
});

describe('usePeriodAssignmentsQuery', () => {
  it('does not fetch when no period is selected', () => {
    renderHook(() => usePeriodAssignmentsQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getPeriodAssignments).not.toHaveBeenCalled();
  });

  it('fetches the selected period assignments', async () => {
    (getPeriodAssignments as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    renderHook(() => usePeriodAssignmentsQuery(4), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(getPeriodAssignments).toHaveBeenCalledWith(4));
  });
});

describe('useOnCallMutations', () => {
  beforeEach(() => {
    (createOnCallPeriod as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateOnCallPeriod as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deleteOnCallPeriod as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    (assignToPeriod as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (removeFromPeriod as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('every mutation invalidates the whole on-call cache, so a changed assignedCount is never stale', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useOnCallMutations(), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ departmentId: 3, date: '2026-01-01', startTime: '08:00', endTime: '16:00' });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    result.current.update.mutate({ id: 1, notes: 'updated' });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateOnCallPeriod).toHaveBeenCalledWith(1, { notes: 'updated' });

    result.current.remove.mutate(1);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    result.current.assign.mutate({ id: 1, userId: 9 });
    await waitFor(() => expect(result.current.assign.isSuccess).toBe(true));

    result.current.unassign.mutate({ id: 1, userId: 9 });
    await waitFor(() => expect(result.current.unassign.isSuccess).toBe(true));

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['on-call']))).toBe(true);
    expect(spy.mock.calls.length).toBe(5);
  });
});
