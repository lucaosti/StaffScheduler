/**
 * Server-state hooks for the Schedule page (TanStack Query).
 *
 * WHY ONE COMPOSITE QUERY FOR THE LISTS
 * -------------------------------------
 * The page needs four independent lists (schedules, employees, shifts,
 * departments). They render as one screen and always load as a unit, so they
 * are fetched together: the page has a single loading/error state, and one
 * invalidation key refreshes the bundle. A failure of the critical `schedules`
 * call throws so the page shows an error; the other lists degrade to empty.
 *
 * WHY ASSIGNMENTS ARE A SEPARATE QUERY PER VISIBLE SCHEDULE (#844)
 * -----------------------------------------------------------------
 * The lists query used to fetch the assignments of `schedules[0]` only, so a
 * week whose shifts belonged to any other schedule rendered as unstaffed.
 * Assignments now follow what is on screen: every schedule whose date range
 * overlaps the visible range is loaded, each under its own key, so moving to
 * another week fetches only the schedules not already cached. The per-schedule
 * endpoint (`GET /schedules/:id/shifts`, `schedule.read`) is used rather than the
 * date-filtered `GET /assignments`, which requires `assignment.manage` — a
 * permission many readers of this page do not hold. The keys sit under
 * `schedulePageKey`, so the page's `reload` refreshes them too.
 *
 * WHY THE MUTATIONS LIVE HERE (#844)
 * ----------------------------------
 * The page's create/generate/publish/archive actions used to call the services
 * directly with hand-kept loading flags, re-invoke a manual reload, and
 * invalidate only this page's key — leaving the Shifts page, the assignment
 * screens and the dashboard stale after, say, a generate that created
 * assignments. They are now mutations that invalidate every view a schedule
 * change affects (`SCHEDULE_DEPENDENT_KEYS`). The generate mutation polls the
 * optimization job with an `AbortSignal`, so leaving the page stops the
 * polling instead of letting it run for up to five minutes.
 *
 * @author Luca Ostinelli
 */

import { useEffect } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Schedule as ScheduleType, ShiftAssignment, Employee, Shift } from '../types';
import * as scheduleService from '../services/scheduleService';
import * as employeeService from '../services/employeeService';
import * as shiftService from '../services/shiftService';
import * as departmentService from '../services/departmentService';
import type { Department } from '../services/departmentService';
import { ApiError } from '../services/apiUtils';
import { toLocalDateString } from '../utils/format';

interface SchedulePageData {
  schedules: ScheduleType[];
  employees: Employee[];
  shifts: Shift[];
  departments: Department[];
}

// Exported so other features that mutate the same underlying rows (e.g.
// useAssignments' staffing mutations) can invalidate this cache too.
export const schedulePageKey = ['schedule-page'] as const;

/**
 * The roots of every query a schedule change can make stale: this page, the
 * Shifts page and month grid (generate creates assignments; archive changes
 * what is listed), the assignment screens, the dashboard counters and the
 * reports (coverage, cost and fairness are computed from assignments). Matched
 * on the first key element because the owning hooks keep their full keys
 * private — and importing them from useAssignments would be a cycle, since it
 * imports `schedulePageKey` from here.
 */
const SCHEDULE_DEPENDENT_KEYS = new Set(['schedule-page', 'shifts-page', 'shifts-range', 'assignments', 'dashboard', 'reports']);

const invalidateScheduleDependents = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: (query) => SCHEDULE_DEPENDENT_KEYS.has(String(query.queryKey[0])),
  });

const fetchSchedulePageData = async (): Promise<SchedulePageData> => {
  const [schedulesResponse, employeesResponse, shiftsResponse, departmentsResponse] =
    await Promise.all([
      scheduleService.getSchedules(),
      employeeService.getEmployees({}),
      shiftService.getShifts({}),
      departmentService.getDepartments(),
    ]);

  if (!schedulesResponse.success || !schedulesResponse.data) {
    throw new Error('Failed to load schedules');
  }
  return {
    schedules: schedulesResponse.data,
    employees: employeesResponse.success && employeesResponse.data ? employeesResponse.data : [],
    shifts: shiftsResponse.success && shiftsResponse.data ? shiftsResponse.data : [],
    departments:
      departmentsResponse.success && departmentsResponse.data ? departmentsResponse.data : [],
  };
};

/** Loads the Schedule page's lists; `reload` refreshes them and the visible assignments. */
export function useSchedulePageData() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: schedulePageKey, queryFn: fetchSchedulePageData });

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: schedulePageKey });
  };

  return { query, reload };
}

const fetchScheduleAssignments = async (scheduleId: ScheduleType['id']): Promise<ShiftAssignment[]> => {
  const details = await scheduleService.getScheduleWithShifts(scheduleId);
  const shifts = details.success && details.data && Array.isArray(details.data.shifts) ? details.data.shifts : [];
  return shifts.flatMap((shift) => (Array.isArray(shift.assignments) ? shift.assignments : []));
};

// Module scope so the reference is stable: TanStack Query then recomputes the
// combined result only when one of the per-schedule results changes.
const combineAssignments = (results: { data?: ShiftAssignment[]; isLoading: boolean }[]) => ({
  assignments: results.flatMap((r) => r.data ?? []),
  isLoading: results.some((r) => r.isLoading),
});

/** Assignments of every schedule overlapping `[range.startDate, range.endDate]`. */
export function useScheduleAssignments(
  schedules: ScheduleType[],
  range: { startDate: string; endDate: string }
) {
  // Calendar days as `YYYY-MM-DD`, which compare correctly as strings.
  const visible = schedules.filter(
    (s) => toLocalDateString(s.startDate) <= range.endDate && toLocalDateString(s.endDate) >= range.startDate
  );
  return useQueries({
    queries: visible.map((s) => ({
      queryKey: [...schedulePageKey, 'assignments', s.id] as const,
      queryFn: () => fetchScheduleAssignments(s.id),
    })),
    combine: combineAssignments,
  });
}

/**
 * The engine-provenance subset of an optimization result the UI cares about.
 * Enough to tell the user whether they got the optimum or a signalled draft.
 */
export interface OptimizationOutcome {
  engine?: 'or-tools' | 'greedy';
  degraded?: boolean;
  degradedReason?: string;
}

const POLL_MS = 2000;
const MAX_POLLS = 150; // ~5 minutes, matching the solver time limit

const abortError = () => new DOMException('Optimization polling aborted', 'AbortError');

/** Resolves after `ms`, or rejects with an AbortError as soon as `signal` aborts. */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Polls the optimization job until it finishes. Bounded so a stuck job never
 * hangs the UI; stops at once when `signal` aborts. Throws ApiError on a
 * failed or timed-out job (its reason is safe to show); on 'completed'
 * returns the job result so the caller can say which engine ran.
 */
const waitForOptimization = async (
  scheduleId: number,
  messages: { failed: string; timedOut: string },
  signal?: AbortSignal
): Promise<OptimizationOutcome | undefined> => {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await wait(POLL_MS, signal);
    const status = await scheduleService.getOptimizationStatus(scheduleId);
    if (signal?.aborted) throw abortError();
    const state = status.data?.state;
    if (state === 'completed') return status.data?.result;
    if (state === 'failed') throw new ApiError(status.data?.failedReason || messages.failed);
    // 'waiting' / 'active' / 'unknown' → keep polling.
  }
  throw new ApiError(messages.timedOut);
};

export interface GenerateVariables {
  scheduleId: string | number;
  signal?: AbortSignal;
  /** Translated fallbacks for a failed / timed-out job (the hook has no `t`). */
  messages?: { failed: string; timedOut: string };
}

/**
 * A 2xx envelope with `success: false` is a failure too. Rejecting on it
 * keeps a failed change from running `onSuccess` (and invalidating), and
 * gives callers one path — the catch — for every failure. An empty message
 * means "the server gave none": callers substitute their translated fallback.
 */
const ensureSuccess = async <R extends { success: boolean; error?: { message?: string } }>(
  call: Promise<R>
): Promise<R> => {
  const response = await call;
  if (!response.success) throw new ApiError(response.error?.message ?? '');
  return response;
};

/** Create / generate / publish / archive, each refreshing every dependent view. */
export function useScheduleMutations() {
  const queryClient = useQueryClient();
  const onSuccess = () => invalidateScheduleDependents(queryClient);

  return {
    create: useMutation({
      mutationFn: (params: Parameters<typeof scheduleService.createSchedule>[0]) =>
        ensureSuccess(scheduleService.createSchedule(params)),
      onSuccess,
    }),
    publish: useMutation({
      mutationFn: (id: string | number) => ensureSuccess(scheduleService.publishSchedule(id)),
      onSuccess,
    }),
    archive: useMutation({
      mutationFn: (id: string | number) => ensureSuccess(scheduleService.archiveSchedule(id)),
      onSuccess,
    }),
    generate: useMutation({
      mutationFn: async ({ scheduleId, signal, messages }: GenerateVariables) => {
        const response = await ensureSuccess(scheduleService.generateSchedule(scheduleId));
        // Async path: the backend queued the solve (202 { jobId }); poll until
        // it finishes so the UI reports the real result. Sync path (no Redis):
        // the result is already in the response.
        const data = response.data as ({ jobId?: string } & OptimizationOutcome) | undefined;
        return data?.jobId
          ? waitForOptimization(
              Number(scheduleId),
              messages ?? { failed: 'Optimization failed', timedOut: 'Optimization timed out' },
              signal
            )
          : data;
      },
      onSuccess,
      onError: (error, { scheduleId }) => {
        // Abandoned, not failed: the page went away and the job runs on
        // server-side, changing what the dependent views show — see
        // `useFinishedOptimizationRefresh`.
        if (error instanceof DOMException && error.name === 'AbortError') {
          unfinishedOptimizations.add(Number(scheduleId));
          void invalidateScheduleDependents(queryClient);
        }
      },
    }),
  };
}

/**
 * Optimizations whose poll was abandoned before the job finished (#844
 * review). Leaving the page during Generate aborts the poll — rather than
 * letting it run on for up to five minutes against nothing — but the job
 * keeps running, and nothing would then refresh the assignments, shifts,
 * reports and dashboard it changes. Module scope because it must outlive the
 * page that started the job.
 */
const unfinishedOptimizations = new Set<number>();

/**
 * Forgets the abandoned jobs. They belong to the session that started them,
 * so AuthContext calls this whenever the signed-in user changes (#844
 * re-review): the next user must not poll, or refresh views, for them.
 */
export const resetOptimizationWatch = (): void => {
  unfinishedOptimizations.clear();
};

/**
 * On (re)mount of the Schedule and Shifts pages, asks once about each abandoned job and,
 * for those that have finished, refreshes every dependent view. The abort
 * itself already invalidated them once, which covers a job that finished
 * before the user looked again only if they navigate away and back, so this
 * check is what makes the refresh reliable. A job still running stays listed
 * for the next mount; a status call that fails is left for the next one too.
 */
export function useFinishedOptimizationRefresh() {
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const scheduleId of Array.from(unfinishedOptimizations)) {
      scheduleService
        .getOptimizationStatus(scheduleId)
        .then((status) => {
          const state = status.data?.state;
          if (state !== 'completed' && state !== 'failed') return;
          unfinishedOptimizations.delete(scheduleId);
          void invalidateScheduleDependents(queryClient);
        })
        .catch(() => undefined);
    }
  }, [queryClient]);
}
