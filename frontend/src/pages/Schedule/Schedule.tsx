/**
 * Schedule Page Component for Staff Scheduler
 *
 * Provides a real end-to-end flow for managing schedules:
 * - List existing schedules (with status badges).
 * - Create a new schedule (name + date range + department).
 * - Generate optimized assignments for a selected schedule.
 * - Publish / archive an existing schedule.
 *
 * The week/month grid rendering lives in WeekView/MonthView, the generate form
 * in GenerateScheduleModal (mirroring CreateScheduleModal), and the
 * create/generate/publish/archive flows in useScheduleActions — this file is
 * left with the calendar data wiring and the page layout.
 *
 * Errors are surfaced in an inline alert and modal-level alert (no silent failures).
 *
 * @author Luca Ostinelli
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShiftAssignment } from '../../types';
import { useSchedulePageData } from '../../hooks/useSchedulePage';
import { useShiftsInRange } from '../../hooks/useShifts';
import { ApiError } from '../../services/apiUtils';
import ScheduleList from '../Schedule/ScheduleList';
import CreateScheduleModal from '../Schedule/CreateScheduleModal';
import GenerateScheduleModal from '../Schedule/GenerateScheduleModal';
import WeekView from '../Schedule/WeekView';
import MonthView from '../Schedule/MonthView';
import StatsBadge from '../Schedule/StatsBadge';
import { useScheduleActions } from '../Schedule/useScheduleActions';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import { toLocalDateString } from '../../utils/format';
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport';

const Schedule: React.FC = () => {
  const { t } = useTranslation();
  // Server state (the four page lists + first-schedule assignments) is owned by
  // one TanStack Query hook; `reload` invalidates it after a mutation. Only
  // genuinely local UI state lives in this component.
  // A week/month grid with a column per day genuinely cannot be reflowed into
  // something usable at phone width by CSS alone — the columns themselves
  // have to go. Below the breakpoint, both views render the same underlying
  // data as a day-by-day agenda list instead (see WeekView/MonthView).
  const isNarrow = useIsNarrowViewport();
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

  const actions = useScheduleActions(loadData);

  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [selectedDepartment, setSelectedDepartment] = useState('');

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

  // Defined outside the JSX tree (like `formatDate` above) rather than
  // called inline with its options object literal in the JSX expression:
  // the i18next-literal-string lint rule walks every descendant of a JSX
  // element, including nested call arguments, so an options object placed
  // directly in the markup gets flagged as untranslated prose even though
  // 'long'/'numeric' are `Intl` format tokens, not user-facing copy.
  const formatMonthHeading = (date: Date) =>
    date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
    const index = new Map<string, ShiftAssignment[]>();
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

  const getAssignmentsForDateAndShift = (date: Date, shiftId: string | number): ShiftAssignment[] => {
    // toLocalDateString (local calendar day), not toISOString: `date` carries
    // the real time-of-day it was constructed at (see weekDates/
    // generateWeekDates above), so a UTC-based key can land one day off from
    // the column header — which renders the same `date` with
    // toLocaleDateString (local) — near local midnight, dropping an
    // assignment out of its visible cell.
    const dateStr = toLocalDateString(date);
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
      startDate: toLocalDateString(monthGridDates[0]),
      endDate: toLocalDateString(monthGridDates[monthGridDates.length - 1]),
      departmentId: selectedDepartment ? Number(selectedDepartment) : undefined,
    },
    { enabled: viewMode === 'month' }
  );
  const monthShifts = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);
  const monthLoading = monthQuery.isFetching;

  const shiftsByDate = useMemo(() => {
    const index = new Map<string, typeof monthShifts>();
    for (const shift of monthShifts) {
      const dateStr = toLocalDateString(shift.date);
      const bucket = index.get(dateStr);
      if (bucket) bucket.push(shift);
      else index.set(dateStr, [shift]);
    }
    return index;
  }, [monthShifts]);

  const todayKey = toLocalDateString(new Date());

  return (
    <div className="container-fluid py-4 schedule-page">
      <QueryState
        isLoading={pageQuery.isLoading}
        isError={pageQuery.isError}
        error={pageQuery.error instanceof ApiError ? pageQuery.error.message : pageQuery.error}
        onRetry={() => loadData()}
        loadingMessage={t('schedule.loadingData')}
      >
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-2">
            <div>
              <h1 className="h3 mb-0">{t('schedule.title')}</h1>
              <p className="text-muted mb-0">{t('schedule.subtitle')}</p>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                type="button"
                onClick={actions.openCreateModal}
                data-testid="open-create-schedule"
              >
                <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>
                {t('schedule.newSchedule')}
              </button>
              <button
                className="btn btn-success"
                type="button"
                disabled={schedules.length === 0}
                onClick={() => actions.openGenerateModal(schedules[0]?.id ?? null)}
              >
                <i className="bi bi-magic me-2" aria-hidden="true"></i>
                {t('schedule.generate')}
              </button>
              <div className="btn-group" role="group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'week' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-label={t('schedule.weekViewAriaLabel')}
                  onClick={() => setViewMode('week')}
                >
                  {t('schedule.week')}
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'month' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-label={t('schedule.monthViewAriaLabel')}
                  onClick={() => setViewMode('month')}
                >
                  {t('schedule.month')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-md-6">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => navigateWeek('prev')}
            >
              <i className="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
            <h5 className="mb-0">
              {viewMode === 'week'
                ? t('schedule.weekOf', { date: weekDates[0].toLocaleDateString(undefined) })
                : formatMonthHeading(selectedWeek)}
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
            <option value="">{t('schedule.allDepartments')}</option>
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

      {actions.error && <ErrorAlert message={actions.error} />}
      {actions.info && (
        <div className="alert alert-success" role="alert">
          <i className="bi bi-check-circle me-2"></i>
          {actions.info}
        </div>
      )}

      {viewMode === 'week' && (
        <WeekView
          isNarrow={isNarrow}
          weekDates={weekDates}
          filteredShifts={filteredShifts}
          departmentNameById={departmentNameById}
          getAssignmentsForDateAndShift={getAssignmentsForDateAndShift}
          getEmployeeById={getEmployeeById}
          formatDate={formatDate}
        />
      )}

      {viewMode === 'month' && (
        <MonthView
          isNarrow={isNarrow}
          monthLoading={monthLoading}
          monthGridDates={monthGridDates}
          shiftsByDate={shiftsByDate}
          selectedMonth={selectedWeek}
          todayKey={todayKey}
          formatDate={formatDate}
        />
      )}

      <div className="row mt-4">
        <div className="col-12">
          <h5 className="mb-3">{t('schedule.recentSchedules')}</h5>
          <ScheduleList
            schedules={schedules}
            onGenerate={(schedule) => actions.openGenerateModal(schedule.id)}
            onPublish={actions.handlePublish}
            onArchive={actions.handleArchive}
            onCreateNew={actions.openCreateModal}
          />
        </div>
      </div>

      <CreateScheduleModal
        show={actions.showCreateModal}
        departments={departments}
        isCreating={actions.isCreating}
        createError={actions.createError}
        onClose={actions.closeCreateModal}
        onSubmit={actions.handleCreateSchedule}
      />

      <GenerateScheduleModal
        show={actions.showGenerateModal}
        schedules={schedules}
        selectedScheduleId={actions.selectedScheduleId}
        isGenerating={actions.isGenerating}
        generateError={actions.generateError}
        onSelectSchedule={actions.setSelectedScheduleId}
        onClose={actions.closeGenerateModal}
        onSubmit={actions.handleGenerateSchedule}
      />
      </QueryState>
    </div>
  );
};

export default Schedule;
