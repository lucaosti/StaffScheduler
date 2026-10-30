import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  resetOptimizationWatch,
  schedulePageKey,
  useFinishedOptimizationRefresh,
  useScheduleAssignments,
  useScheduleMutations,
  useSchedulePageData,
} from './useSchedulePage';
import * as scheduleService from '../services/scheduleService';
import * as employeeService from '../services/employeeService';
import * as shiftService from '../services/shiftService';
import * as departmentService from '../services/departmentService';

jest.mock('../services/scheduleService', () => ({
  __esModule: true,
  getSchedules: jest.fn(),
  getScheduleWithShifts: jest.fn(),
  createSchedule: jest.fn(),
  generateSchedule: jest.fn(),
  getOptimizationStatus: jest.fn(),
  publishSchedule: jest.fn(),
  archiveSchedule: jest.fn(),
}));
jest.mock('../services/employeeService', () => ({ __esModule: true, getEmployees: jest.fn() }));
jest.mock('../services/shiftService', () => ({ __esModule: true, getShifts: jest.fn() }));
jest.mock('../services/departmentService', () => ({ __esModule: true, getDepartments: jest.fn() }));

const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => {
  jest.clearAllMocks();
  (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (shiftService.getShifts as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (departmentService.getDepartments as jest.Mock).mockResolvedValue({ success: true, data: [] });
});

describe('useSchedulePageData', () => {
  it('throws when the critical schedules call fails', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
  });

  it('degrades employees/shifts/departments to empty on their own failure, without throwing', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (employeeService.getEmployees as jest.Mock).mockResolvedValue({ success: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data?.employees).toEqual([]);
  });

  it('loads the lists without fetching any schedule\'s assignments', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [{ id: 1 }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(scheduleService.getScheduleWithShifts).not.toHaveBeenCalled();
  });

  it('reload() invalidates the schedule-page cache', async () => {
    (scheduleService.getSchedules as jest.Mock).mockResolvedValue({ success: true, data: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSchedulePageData(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    await result.current.reload();

    expect(spy).toHaveBeenCalledWith({ queryKey: schedulePageKey });
  });
});

/**
 * #844: the page loaded assignments for `schedules[0]` only, so a week whose
 * shifts belonged to any other schedule rendered as unstaffed.
 */
describe('useScheduleAssignments', () => {
  const week = { startDate: '2026-08-02', endDate: '2026-08-08' };
  const schedules = [
    { id: 1, startDate: '2026-07-01', endDate: '2026-07-31' }, // ends before the week
    { id: 2, startDate: '2026-08-01', endDate: '2026-08-31' }, // covers it
    { id: 3, startDate: '2026-08-06', endDate: '2026-09-05' }, // overlaps its end
  ] as never[];

  beforeEach(() => {
    (scheduleService.getScheduleWithShifts as jest.Mock).mockImplementation((id: number) =>
      Promise.resolve({
        success: true,
        data: { shifts: [{ id: id * 10, assignments: [{ id: id * 100 }] }] },
      })
    );
  });

  it('collects the assignments of every schedule overlapping the visible range', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useScheduleAssignments(schedules, week), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.assignments).toHaveLength(2));
    expect(result.current.assignments).toEqual([{ id: 200 }, { id: 300 }]);
    expect(scheduleService.getScheduleWithShifts).not.toHaveBeenCalledWith(1);
  });

  it('caches per schedule under the schedule-page key, so the page reload refreshes them', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useScheduleAssignments(schedules, week), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.assignments).toHaveLength(2));

    expect(client.getQueryData([...schedulePageKey, 'assignments', 2])).toEqual([{ id: 200 }]);
  });
});

describe('useScheduleMutations', () => {
  const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('refreshes every view a schedule change affects, not only the schedule page', async () => {
    (scheduleService.publishSchedule as jest.Mock).mockResolvedValue({ success: true, data: {} });
    const client = makeClient();
    for (const key of [['schedule-page'], ['shifts-page'], ['shifts-range', 'a'], ['assignments', {}], ['dashboard'], ['reports', 'range'], ['employees']]) {
      client.setQueryData(key, 'cached');
    }
    const { result } = renderHook(() => useScheduleMutations(), { wrapper: makeWrapper(client) });

    await act(() => result.current.publish.mutateAsync(1));

    const invalidated = client
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => q.queryKey[0]);
    expect(invalidated.sort()).toEqual(['assignments', 'dashboard', 'reports', 'schedule-page', 'shifts-page', 'shifts-range']);
  });

  /**
   * Review of #844: leaving the page during Generate aborted the poll, and
   * nothing then refreshed the views the job goes on to change server-side.
   */
  it('when the poll is abandoned, refreshes now and again once the job is seen finished', async () => {
    jest.useFakeTimers();
    (scheduleService.generateSchedule as jest.Mock).mockResolvedValue({ success: true, data: { jobId: 'j2' } });
    (scheduleService.getOptimizationStatus as jest.Mock).mockResolvedValue({ success: true, data: { state: 'active' } });
    const client = makeClient();
    client.setQueryData(['assignments', {}], 'cached');
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useScheduleMutations(), { wrapper: makeWrapper(client) });
    const controller = new AbortController();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.generate.mutateAsync({ scheduleId: 7, signal: controller.signal }).catch((e: unknown) => e);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100);
    });
    controller.abort();
    await act(async () => {
      await outcome;
    });
    unmount();
    jest.useRealTimers();
    expect(spy).toHaveBeenCalledTimes(1);

    // Back on the page later: the job has finished, so the views refresh again.
    (scheduleService.getOptimizationStatus as jest.Mock).mockResolvedValue({ success: true, data: { state: 'completed' } });
    renderHook(() => useFinishedOptimizationRefresh(), { wrapper: makeWrapper(client) });

    // Greater-than rather than exactly 2: the earlier abort test in this file
    // left its own job (schedule 1) listed, and it is checked here too.
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
    expect(scheduleService.getOptimizationStatus).toHaveBeenCalledWith(7);
  });

  // #844 re-review: the remembered jobs are the last user's; a new session
  // must not poll or refresh for them.
  it('forgets abandoned jobs when the session changes', async () => {
    jest.useFakeTimers();
    (scheduleService.generateSchedule as jest.Mock).mockResolvedValue({ success: true, data: { jobId: 'j3' } });
    (scheduleService.getOptimizationStatus as jest.Mock).mockResolvedValue({ success: true, data: { state: 'active' } });
    const client = makeClient();
    const { result, unmount } = renderHook(() => useScheduleMutations(), { wrapper: makeWrapper(client) });
    const controller = new AbortController();
    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.generate.mutateAsync({ scheduleId: 9, signal: controller.signal }).catch((e: unknown) => e);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100);
    });
    controller.abort();
    await act(async () => {
      await outcome;
    });
    unmount();
    jest.useRealTimers();

    resetOptimizationWatch();
    (scheduleService.getOptimizationStatus as jest.Mock).mockClear();
    renderHook(() => useFinishedOptimizationRefresh(), { wrapper: makeWrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduleService.getOptimizationStatus).not.toHaveBeenCalled();
  });

  it('stops polling an optimization job once aborted', async () => {
    jest.useFakeTimers();
    (scheduleService.generateSchedule as jest.Mock).mockResolvedValue({ success: true, data: { jobId: 'j1' } });
    (scheduleService.getOptimizationStatus as jest.Mock).mockResolvedValue({ success: true, data: { state: 'active' } });
    const client = makeClient();
    const { result } = renderHook(() => useScheduleMutations(), { wrapper: makeWrapper(client) });
    const controller = new AbortController();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.generate.mutateAsync({ scheduleId: 1, signal: controller.signal }).catch((e: unknown) => e);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4100);
    });
    const pollsBeforeAbort = (scheduleService.getOptimizationStatus as jest.Mock).mock.calls.length;
    expect(pollsBeforeAbort).toBeGreaterThan(0);

    controller.abort();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect((scheduleService.getOptimizationStatus as jest.Mock).mock.calls.length).toBe(pollsBeforeAbort);
    jest.useRealTimers();
  });
});
