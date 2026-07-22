/**
 * Schedule Page Component for Staff Scheduler
 *
 * Provides a real end-to-end flow for managing schedules:
 * - List existing schedules (with status badges).
 * - Create a new schedule (name + date range + department).
 * - Generate optimized assignments for a selected schedule.
 * - Publish / archive an existing schedule.
 *
 * Errors are surfaced in an inline alert and modal-level alert (no silent failures).
 *
 * @author Luca Ostinelli
 */

import React, { useState, useMemo } from 'react';
import { Assignment, Shift } from '../../types';
import * as scheduleService from '../../services/scheduleService';
import { useSchedulePageData } from '../../hooks/useSchedulePage';
import { useShiftsInRange } from '../../hooks/useShifts';
import { ApiError } from '../../services/apiUtils';
import ScheduleList from '../Schedule/ScheduleList';
import CreateScheduleModal, { type CreateScheduleValues } from '../Schedule/CreateScheduleModal';
import StatsBadge from '../Schedule/StatsBadge';
import LoadingSpinner from '../../components/LoadingSpinner';

/**
 * The engine-provenance subset of an optimization result the UI cares about.
 * Enough to tell the user whether they got the optimum or a signalled draft.
 */
interface OptimizationOutcome {
  engine?: 'or-tools' | 'greedy';
  degraded?: boolean;
  degradedReason?: string;
}

const Schedule: React.FC = () => {
  // Server state (the four page lists + first-schedule assignments) is owned by
  // one TanStack Query hook; `reload` invalidates it after a mutation. Only
  // genuinely local UI state lives in this component.
  const { query: pageQuery, reload: loadData } = useSchedulePageData();
  const pageData = pageQuery.data;
  // Memoized so the derived arrays keep a stable reference between renders while
  // the query data is unchanged — otherwise the `?? []` fallbacks would be new
  // arrays every render and churn the useMemo hooks that depend on them.
  const schedules = useMemo(() => pageData?.schedules ?? [], [pageData]);
  const employees = useMemo(() => pageData?.employees ?? [], [pageData]);
  const shifts = useMemo(() => pageData?.shifts ?? [], [pageData]);
  const departments = useMemo(() => pageData?.departments ?? [], [pageData]);
  const assignments = useMemo(() => pageData?.assignments ?? [], [pageData]);
  const loading = pageQuery.isLoading;

  const [localError, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The page error is the query's load error, or a one-off action error.
  const error = pageQuery.isError
    ? pageQuery.error instanceof ApiError
      ? pageQuery.error.message
      : (pageQuery.error as Error)?.message ?? 'Failed to load schedule data'
    : localError;


  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | number | null>(null);

  const generateWeekDates = (startDate: Date) => {
    const dates: Date[] = [];
    const start = new Date(startDate);
    start.setDate(start.getDate() - start.getDay());
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  /**
   * A shift's own calendar date, used as its label. The API contract has no
   * `Shift.name`, so the row previously rendered `undefined`; the date is the
   * shift's natural identifier (ShiftTable already falls back to it).
   */
  const formatShiftDate = (date: string | Date): string =>
    typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);

  const departmentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const filteredShifts = useMemo(
    () =>
      shifts.filter(
        (shift) =>
          !selectedDepartment ||
          String(shift.departmentId) === selectedDepartment
      ),
    [shifts, selectedDepartment]
  );

  const weekDates = generateWeekDates(selectedWeek);

  // Pre-index assignments by "dateStr|shiftId" so each cell lookup is O(1)
  // instead of scanning the full assignments array for every shift × date cell.
  const assignmentIndex = useMemo(() => {
    const index = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const src = a.shiftDate || a.assignedAt;
      if (!src) continue;
      const dateStr = new Date(src).toISOString().split('T')[0];
      const key = `${dateStr}|${String(a.shiftId)}`;
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(a);
      } else {
        index.set(key, [a]);
      }
    }
    return index;
  }, [assignments]);

  const getAssignmentsForDateAndShift = (date: Date, shiftId: string | number): Assignment[] => {
    const dateStr = date.toISOString().split('T')[0];
    return assignmentIndex.get(`${dateStr}|${String(shiftId)}`) ?? [];
  };

  const getEmployeeById = (employeeId: string | number) =>
    employees.find((e) => String(e.id) === String(employeeId)) ||
    employees.find((e) => e.employeeId && String(e.employeeId) === String(employeeId));

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedWeek);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    } else {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    }
    setSelectedWeek(newDate);
  };

  // Local calendar-date key (not toISOString, which shifts to UTC and can
  // land a shift on the wrong day for any timezone ahead/behind UTC).
  const toDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 6-week (42-cell) grid covering the selected month, padded with the tail
  // of the previous month and the head of the next so every row is full.
  const monthGridDates = useMemo(() => {
    const first = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - first.getDay());
    const dates: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [selectedWeek]);

  // The month grid exercises the endpoint's real date-range and department
  // filters rather than fetching every shift and discarding most of them, so
  // it scales independently of how many shifts exist overall.
  const monthQuery = useShiftsInRange(
    {
      startDate: toDateKey(monthGridDates[0]),
      endDate: toDateKey(monthGridDates[monthGridDates.length - 1]),
      departmentId: selectedDepartment ? Number(selectedDepartment) : undefined,
    },
    { enabled: viewMode === 'month' }
  );
  const monthShifts = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);
  const monthLoading = monthQuery.isFetching;

  const shiftsByDate = useMemo(() => {
    const index = new Map<string, Shift[]>();
    for (const shift of monthShifts) {
      const dateStr = typeof shift.date === 'string' ? shift.date.slice(0, 10) : new Date(shift.date as unknown as string).toISOString().slice(0, 10);
      const bucket = index.get(dateStr);
      if (bucket) bucket.push(shift);
      else index.set(dateStr, [shift]);
    }
    return index;
  }, [monthShifts]);

  const todayKey = toDateKey(new Date());


  // Values arrive already validated against the shared createScheduleBody schema
  // (the modal uses it via zodResolver), so this handler only performs the API
  // call and its async bookkeeping — no re-validation needed.
  const handleCreateSchedule = async (values: CreateScheduleValues) => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const response = await scheduleService.createSchedule({
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        departmentId: values.departmentId,
        notes: values.notes,
      });
      if (response.success) {
        setShowCreateModal(false);
        setInfo(`Schedule "${values.name}" created.`);
        await loadData();
      } else {
        setCreateError(response.error?.message || 'Failed to create schedule.');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create schedule.';
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  // Polls the optimization job until it finishes. Bounded so a stuck job never
  // hangs the UI forever; the 2s interval keeps status requests light while
  // still feeling responsive. Throws on failure/timeout so the caller surfaces
  // an error; on the terminal 'completed' state it returns the job result so
  // the caller can tell the user which engine ran (optimal vs degraded draft).
  const waitForOptimization = async (
    scheduleId: number
  ): Promise<OptimizationOutcome | undefined> => {
    const POLL_MS = 2000;
    const MAX_ATTEMPTS = 150; // ~5 minutes, matching the solver time limit
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const status = await scheduleService.getOptimizationStatus(scheduleId);
      const state = status.data?.state;
      if (state === 'completed') return status.data?.result;
      if (state === 'failed') {
        throw new Error(status.data?.failedReason || 'Optimization failed.');
      }
      // 'waiting' / 'active' / 'unknown' → keep polling.
    }
    throw new Error('Optimization timed out.');
  };

  // A completion message that makes the engine unmistakable: the optimal run is
  // reported plainly, a degraded run is flagged prominently as a draft so it is
  // never mistaken for the optimum (the whole point of the degraded signal).
  const describeOutcome = (outcome?: OptimizationOutcome): { message: string; degraded: boolean } => {
    if (outcome?.degraded) {
      const reason = outcome.degradedReason ? ` (${outcome.degradedReason})` : '';
      return {
        degraded: true,
        message: `Schedule generated as a DRAFT using the greedy fallback — the optimal OR-Tools engine was unavailable${reason}. Re-run once it is available for an optimal schedule.`,
      };
    }
    if (outcome?.engine === 'greedy') {
      return { degraded: false, message: 'Schedule generated with the greedy draft engine.' };
    }
    return { degraded: false, message: 'Schedule generation completed with the optimal engine.' };
  };

  const handleGenerateSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGenerateError(null);

    if (!selectedScheduleId) {
      setGenerateError('Select a schedule to generate.');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await scheduleService.generateSchedule(selectedScheduleId);
      if (!response.success) {
        setGenerateError(response.error?.message || 'Failed to generate schedule.');
        return;
      }

      // Async path: the backend queued the solve (202 { jobId }). Poll the job
      // status until it finishes, so the UI reflects the real result rather
      // than the "queued" acknowledgement. Sync path (no Redis): the result is
      // already present, so we skip polling.
      const data = response.data as ({ jobId?: string } & OptimizationOutcome) | undefined;
      const outcome = data?.jobId
        ? await waitForOptimization(Number(selectedScheduleId))
        : data;

      setShowGenerateModal(false);
      const { message, degraded } = describeOutcome(outcome);
      // Surface a degraded (draft) run in the prominent page-level alert so it
      // stays visible after the modal closes and is impossible to miss; an
      // optimal run uses the normal info banner.
      if (degraded) {
        setError(message);
      } else {
        setInfo(message);
      }
      await loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to generate schedule.';
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = async (id: string | number) => {
    setError(null);
    setInfo(null);
    try {
      const response = await scheduleService.publishSchedule(id);
      if (response.success) {
        setInfo('Schedule published.');
        await loadData();
      } else {
        setError(response.error?.message || 'Failed to publish schedule.');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to publish schedule.';
      setError(message);
    }
  };

  const handleArchive = async (id: string | number) => {
    setError(null);
    setInfo(null);
    try {
      const response = await scheduleService.archiveSchedule(id);
      if (response.success) {
        setInfo('Schedule archived.');
        await loadData();
      } else {
        setError(response.error?.message || 'Failed to archive schedule.');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to archive schedule.';
      setError(message);
    }
  };

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <LoadingSpinner message="Loading schedule data..." />
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">Schedule Management</h1>
              <p className="text-muted mb-0">
                Create and manage work schedules and run optimization on demand.
              </p>
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
                data-testid="open-create-schedule"
              >
                <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>
                New Schedule
              </button>
              <button
                className="btn btn-success"
                type="button"
                disabled={schedules.length === 0}
                onClick={() => {
                  setGenerateError(null);
                  setSelectedScheduleId(schedules[0]?.id ?? null);
                  setShowGenerateModal(true);
                }}
              >
                <i className="bi bi-magic me-2" aria-hidden="true"></i>
                Generate
              </button>
              <div className="btn-group" role="group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'week' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-label="Week view"
                  onClick={() => setViewMode('week')}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'month' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-label="Month view"
                  onClick={() => setViewMode('month')}
                >
                  Month
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-md-6">
          <div className="d-flex align-items-center gap-3">
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => navigateWeek('prev')}
            >
              <i className="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
            <h5 className="mb-0">
              {viewMode === 'week'
                ? `Week of ${weekDates[0].toLocaleDateString(undefined)}`
                : selectedWeek.toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })}
            </h5>
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => navigateWeek('next')}
            >
              <i className="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div className="col-md-3">
          <select
            className="form-select"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <StatsBadge shiftCount={filteredShifts.length} employeeCount={employees.length} />
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2"></i>
          {error}
        </div>
      )}
      {info && (
        <div className="alert alert-success" role="alert">
          <i className="bi bi-check-circle me-2"></i>
          {info}
        </div>
      )}

      {viewMode === 'week' && (
        <div className="card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-bordered mb-0">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '200px' }}>Shift</th>
                    {weekDates.map((date) => (
                      <th scope="col" key={date.toISOString()} className="text-center">
                        {formatDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.length === 0 ? (
                    <tr>
                      <td colSpan={weekDates.length + 1} className="text-center text-muted py-4">
                        No shifts to display. Create shifts and a schedule to get started.
                      </td>
                    </tr>
                  ) : (
                    filteredShifts.map((shift) => {
                      const deptName =
                        shift.departmentName ||
                        (shift.departmentId
                          ? departmentNameById.get(Number(shift.departmentId))
                          : '') ||
                        '';
                      return (
                        <tr key={shift.id}>
                          <td className="align-middle">
                            <div>
                              <strong>{formatShiftDate(shift.date)}</strong>
                              <br />
                              <small className="text-muted">{`${shift.startTime} - ${shift.endTime}`}</small>
                              <br />
                              {deptName && <span className="badge bg-primary">{deptName}</span>}
                            </div>
                          </td>
                          {weekDates.map((date) => {
                            const dayAssignments = getAssignmentsForDateAndShift(
                              date,
                              shift.id!
                            );
                            return (
                              <td
                                key={date.toISOString()}
                                className="align-middle text-center"
                              >
                                {dayAssignments.length > 0 ? (
                                  <div className="d-flex flex-column gap-1">
                                    {dayAssignments.map((assignment) => {
                                      const employee = getEmployeeById(
                                        assignment.userId ?? assignment.employeeId ?? ''
                                      );
                                      return (
                                        <div
                                          key={assignment.id}
                                          className="badge bg-success text-wrap"
                                          style={{ fontSize: '0.75em' }}
                                        >
                                          {employee
                                            ? `${employee.firstName} ${employee.lastName}`
                                            : 'Unknown'}
                                        </div>
                                      );
                                    })}
                                    {dayAssignments.length <
                                      (shift.minStaff ?? 0) && (
                                      <small className="text-danger">
                                        Need{' '}
                                        {(shift.minStaff ?? 0) -
                                          dayAssignments.length}{' '}
                                        more
                                      </small>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-muted">
                                    <i className="bi bi-plus-circle"></i>
                                    <br />
                                    <small>Assign Staff</small>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'month' && (
        <div className="card">
          <div className="card-body p-0">
            {monthLoading && (
              <div className="d-flex align-items-center justify-content-center py-2 border-bottom small text-muted">
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-label="Loading month"></span>
                Loading…
              </div>
            )}
            <div className="table-responsive">
              <table className="table table-bordered mb-0" role="table" aria-label="Monthly shift calendar">
                <thead>
                  <tr>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                      <th key={label} className="text-center small text-muted" scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }, (_, week) => (
                    <tr key={week} style={{ height: '110px' }}>
                      {monthGridDates.slice(week * 7, week * 7 + 7).map((date) => {
                        const dateKey = toDateKey(date);
                        const dayShifts = shiftsByDate.get(dateKey) ?? [];
                        const isCurrentMonth = date.getMonth() === selectedWeek.getMonth();
                        const isToday = dateKey === todayKey;
                        return (
                          <td
                            key={dateKey}
                            className={`align-top ${isCurrentMonth ? '' : 'bg-body-tertiary'}`}
                            style={{ width: '14.28%', verticalAlign: 'top' }}
                          >
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span
                                className={`small ${isCurrentMonth ? 'fw-semibold' : 'text-muted'}`}
                                style={isToday ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'var(--bs-primary)', color: '#fff' } : undefined}
                              >
                                {date.getDate()}
                              </span>
                              {dayShifts.length > 0 && (
                                <span className="badge bg-secondary" aria-label={`${dayShifts.length} shifts`}>
                                  {dayShifts.length}
                                </span>
                              )}
                            </div>
                            <div className="d-flex flex-column gap-1">
                              {dayShifts.slice(0, 3).map((shift) => (
                                <span
                                  key={shift.id}
                                  className="badge bg-primary-subtle text-primary-emphasis text-truncate d-block text-start"
                                  title={`${shift.startTime}–${shift.endTime}${shift.departmentName ? ` · ${shift.departmentName}` : ''}`}
                                >
                                  {shift.startTime} {shift.departmentName ?? ''}
                                </span>
                              ))}
                              {dayShifts.length > 3 && (
                                <span className="small text-muted">+{dayShifts.length - 3} more</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="row mt-4">
        <div className="col-12">
          <h5 className="mb-3">Recent Schedules</h5>
          <ScheduleList
            schedules={schedules}
            onGenerate={(schedule) => {
              setSelectedScheduleId(schedule.id);
              setGenerateError(null);
              setShowGenerateModal(true);
            }}
            onPublish={handlePublish}
            onArchive={handleArchive}
            onCreateNew={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
          />
        </div>
      </div>

      <CreateScheduleModal
        show={showCreateModal}
        departments={departments}
        isCreating={isCreating}
        createError={createError}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateSchedule}
      />

      {showGenerateModal && (
        <div
          className="modal show d-block"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generate-schedule-title"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="generate-schedule-title">
                  Generate Schedule
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  disabled={isGenerating}
                  onClick={() => setShowGenerateModal(false)}
                ></button>
              </div>
              <form onSubmit={handleGenerateSchedule}>
                <div className="modal-body">
                  {generateError && (
                    <div className="alert alert-danger" role="alert">
                      {generateError}
                    </div>
                  )}
                  <div className="mb-3">
                    <label htmlFor="generate-schedule-id" className="form-label">
                      Schedule *
                    </label>
                    <select
                      id="generate-schedule-id"
                      className="form-select"
                      value={selectedScheduleId !== null ? String(selectedScheduleId) : ''}
                      onChange={(e) => setSelectedScheduleId(e.target.value || null)}
                      required
                      disabled={isGenerating || schedules.length === 0}
                    >
                      <option value="" disabled>
                        {schedules.length === 0
                          ? 'No schedules available'
                          : 'Select a schedule'}
                      </option>
                      {schedules.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name} ({String(s.startDate).slice(0, 10)} →{' '}
                          {String(s.endDate).slice(0, 10)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-muted small mb-0">
                    Optimization runs against the existing shifts inside the schedule's date
                    range and respects active policies.
                  </p>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowGenerateModal(false)}
                    disabled={isGenerating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-success"
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                        ></span>
                        Generating...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-magic me-2"></i>Generate
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Schedule;
