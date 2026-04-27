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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Schedule as ScheduleType, Assignment, Employee, Shift } from '../../types';
import * as scheduleService from '../../services/scheduleService';
import * as employeeService from '../../services/employeeService';
import * as shiftService from '../../services/shiftService';
import * as departmentService from '../../services/departmentService';
import type { Department } from '../../services/departmentService';
import { ApiError } from '../../services/apiUtils';

const Schedule: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [schedulesResponse, employeesResponse, shiftsResponse, departmentsResponse] = await Promise.all([
        scheduleService.getSchedules(),
        employeeService.getEmployees({}),
        shiftService.getShifts({}),
        departmentService.getDepartments(),
      ]);

      if (schedulesResponse.success && schedulesResponse.data) {
        setSchedules(schedulesResponse.data);
      } else {
        setError('Failed to load schedules');
      }

      if (employeesResponse.success && employeesResponse.data) {
        setEmployees(employeesResponse.data);
      }

      if (shiftsResponse.success && shiftsResponse.data) {
        setShifts(shiftsResponse.data);
      }

      if (departmentsResponse.success && departmentsResponse.data) {
        setDepartments(departmentsResponse.data);
      }

      if (schedulesResponse.success && schedulesResponse.data && schedulesResponse.data.length > 0) {
        const firstSchedule = schedulesResponse.data[0];
        const scheduleDetails = await scheduleService.getScheduleWithShifts(firstSchedule.id);
        if (scheduleDetails.success && scheduleDetails.data) {
          const allAssignments: Assignment[] = [];
          const detailShifts = scheduleDetails.data.shifts;
          if (Array.isArray(detailShifts)) {
            for (const shift of detailShifts) {
              if (Array.isArray(shift.assignments)) {
                allAssignments.push(...shift.assignments);
              }
            }
          }
          setAssignments(allAssignments);
        }
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load schedule data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const departmentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const filteredShifts = useMemo(
    () => shifts.filter((shift) => !selectedDepartment || String(shift.departmentId ?? shift.department) === selectedDepartment),
    [shifts, selectedDepartment]
  );

  const weekDates = generateWeekDates(selectedWeek);

  const getAssignmentsForDateAndShift = (date: Date, shiftId: string | number) => {
    const dateStr = date.toISOString().split('T')[0];
    return assignments.filter((a) => {
      const assignmentDateSource = a.shiftDate || a.assignedAt;
      if (!assignmentDateSource) return false;
      const assignedDate = new Date(assignmentDateSource).toISOString().split('T')[0];
      return assignedDate === dateStr && String(a.shiftId) === String(shiftId);
    });
  };

  const getEmployeeById = (employeeId: string | number) =>
    employees.find((e) => String(e.id) === String(employeeId)) ||
    employees.find((e) => e.employeeId && String(e.employeeId) === String(employeeId));

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedWeek);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    setSelectedWeek(newDate);
  };

  const handleCreateSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    const formData = new FormData(event.currentTarget);

    const name = (formData.get('name') as string)?.trim();
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;
    const departmentIdRaw = formData.get('departmentId') as string;
    const description = (formData.get('description') as string)?.trim() || undefined;

    if (!name || !startDate || !endDate || !departmentIdRaw) {
      setCreateError('Please fill in name, start date, end date and department.');
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setCreateError('End date must be after start date.');
      return;
    }

    const payload = {
      name,
      description,
      startDate,
      endDate,
      departmentId: Number(departmentIdRaw),
    };

    setIsCreating(true);
    try {
      const response = await scheduleService.createSchedule(payload);
      if (response.success) {
        setShowCreateModal(false);
        setInfo(`Schedule "${name}" created.`);
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
      if (response.success) {
        setShowGenerateModal(false);
        setInfo(response.data?.message || 'Schedule generation completed.');
        await loadData();
      } else {
        setGenerateError(response.error?.message || 'Failed to generate schedule.');
      }
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
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading schedule data...</p>
        </div>
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
                <i className="bi bi-plus-lg me-2"></i>
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
                <i className="bi bi-magic me-2"></i>
                Generate
              </button>
              <div className="btn-group" role="group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'week' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setViewMode('week')}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'month' ? 'btn-primary' : 'btn-outline-primary'}`}
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
            <button className="btn btn-outline-secondary" type="button" onClick={() => navigateWeek('prev')}>
              <i className="bi bi-chevron-left"></i>
            </button>
            <h5 className="mb-0">
              {viewMode === 'week'
                ? `Week of ${weekDates[0].toLocaleDateString(undefined)}`
                : selectedWeek.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h5>
            <button className="btn btn-outline-secondary" type="button" onClick={() => navigateWeek('next')}>
              <i className="bi bi-chevron-right"></i>
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
          <div className="text-muted">
            {filteredShifts.length} shift{filteredShifts.length !== 1 ? 's' : ''} · {employees.length} employees
          </div>
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
                    <th style={{ width: '200px' }}>Shift</th>
                    {weekDates.map((date) => (
                      <th key={date.toISOString()} className="text-center">
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
                      const deptName = shift.departmentName
                        || shift.department
                        || (shift.departmentId ? departmentNameById.get(Number(shift.departmentId)) : '')
                        || '';
                      return (
                        <tr key={shift.id}>
                          <td className="align-middle">
                            <div>
                              <strong>{shift.name}</strong>
                              <br />
                              <small className="text-muted">{`${shift.startTime} - ${shift.endTime}`}</small>
                              <br />
                              {deptName && <span className="badge bg-primary">{deptName}</span>}
                            </div>
                          </td>
                          {weekDates.map((date) => {
                            const dayAssignments = getAssignmentsForDateAndShift(date, shift.id!);
                            return (
                              <td key={date.toISOString()} className="align-middle text-center">
                                {dayAssignments.length > 0 ? (
                                  <div className="d-flex flex-column gap-1">
                                    {dayAssignments.map((assignment) => {
                                      const employee = getEmployeeById(assignment.userId ?? assignment.employeeId ?? '');
                                      return (
                                        <div
                                          key={assignment.id}
                                          className="badge bg-success text-wrap"
                                          style={{ fontSize: '0.75em' }}
                                        >
                                          {employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown'}
                                        </div>
                                      );
                                    })}
                                    {dayAssignments.length < (shift.minStaff ?? shift.minimumStaff ?? 0) && (
                                      <small className="text-danger">
                                        Need {(shift.minStaff ?? shift.minimumStaff ?? 0) - dayAssignments.length} more
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
          <div className="card-body text-center py-5">
            <i className="bi bi-calendar3 text-muted" style={{ fontSize: '3rem' }}></i>
            <h5 className="mt-3">Monthly View</h5>
            <p className="text-muted">Monthly calendar view coming soon</p>
          </div>
        </div>
      )}

      <div className="row mt-4">
        <div className="col-12">
          <h5 className="mb-3">Recent Schedules</h5>
          {schedules.length === 0 ? (
            <div className="alert alert-info">
              No schedules yet. Click <strong>New Schedule</strong> to create one.
            </div>
          ) : (
            <div className="row">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="col-md-6 col-lg-4 mb-3">
                  <div className="card h-100">
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h6 className="card-title mb-0">{schedule.name}</h6>
                        <span
                          className={`badge ${
                            schedule.status === 'published'
                              ? 'bg-success'
                              : schedule.status === 'draft'
                              ? 'bg-warning text-dark'
                              : 'bg-secondary'
                          }`}
                        >
                          {schedule.status}
                        </span>
                      </div>
                      <p className="card-text mb-2">
                        <small className="text-muted">
                          {`${String(schedule.startDate).slice(0, 10)} → ${String(schedule.endDate).slice(0, 10)}`}
                        </small>
                        {schedule.departmentName && (
                          <>
                            <br />
                            <span className="badge bg-primary">{schedule.departmentName}</span>
                          </>
                        )}
                      </p>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          className="btn btn-sm btn-outline-success"
                          type="button"
                          onClick={() => {
                            setSelectedScheduleId(schedule.id);
                            setGenerateError(null);
                            setShowGenerateModal(true);
                          }}
                        >
                          <i className="bi bi-magic me-1"></i>Generate
                        </button>
                        {schedule.status === 'draft' && (
                          <button
                            className="btn btn-sm btn-outline-primary"
                            type="button"
                            onClick={() => handlePublish(schedule.id)}
                          >
                            <i className="bi bi-cloud-upload me-1"></i>Publish
                          </button>
                        )}
                        {schedule.status !== 'archived' && (
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            type="button"
                            onClick={() => handleArchive(schedule.id)}
                          >
                            <i className="bi bi-archive me-1"></i>Archive
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div
          className="modal show d-block"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-schedule-title"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="create-schedule-title">Create Schedule</h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  disabled={isCreating}
                  onClick={() => setShowCreateModal(false)}
                ></button>
              </div>
              <form onSubmit={handleCreateSchedule}>
                <div className="modal-body">
                  {createError && (
                    <div className="alert alert-danger" role="alert">
                      {createError}
                    </div>
                  )}
                  <div className="mb-3">
                    <label htmlFor="schedule-name" className="form-label">Name *</label>
                    <input
                      id="schedule-name"
                      name="name"
                      type="text"
                      className="form-control"
                      placeholder="e.g. April 2026 — ER"
                      required
                      disabled={isCreating}
                    />
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="schedule-start" className="form-label">Start Date *</label>
                      <input
                        id="schedule-start"
                        name="startDate"
                        type="date"
                        className="form-control"
                        required
                        disabled={isCreating}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="schedule-end" className="form-label">End Date *</label>
                      <input
                        id="schedule-end"
                        name="endDate"
                        type="date"
                        className="form-control"
                        required
                        disabled={isCreating}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label htmlFor="schedule-department" className="form-label">Department *</label>
                    <select
                      id="schedule-department"
                      name="departmentId"
                      className="form-select"
                      required
                      disabled={isCreating || departments.length === 0}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {departments.length === 0 ? 'No departments available' : 'Select a department'}
                      </option>
                      {departments.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label htmlFor="schedule-description" className="form-label">Description</label>
                    <textarea
                      id="schedule-description"
                      name="description"
                      className="form-control"
                      rows={2}
                      placeholder="Optional notes about this schedule"
                      disabled={isCreating}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowCreateModal(false)}
                    disabled={isCreating}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isCreating}>
                    {isCreating ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Creating...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-plus-lg me-2"></i>Create Schedule
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
                <h5 className="modal-title" id="generate-schedule-title">Generate Schedule</h5>
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
                    <label htmlFor="generate-schedule-id" className="form-label">Schedule *</label>
                    <select
                      id="generate-schedule-id"
                      className="form-select"
                      value={selectedScheduleId !== null ? String(selectedScheduleId) : ''}
                      onChange={(e) => setSelectedScheduleId(e.target.value || null)}
                      required
                      disabled={isGenerating || schedules.length === 0}
                    >
                      <option value="" disabled>
                        {schedules.length === 0 ? 'No schedules available' : 'Select a schedule'}
                      </option>
                      {schedules.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name} ({String(s.startDate).slice(0, 10)} → {String(s.endDate).slice(0, 10)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-muted small mb-0">
                    Optimization runs against the existing shifts inside the schedule's date range
                    and respects active policies.
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
                  <button type="submit" className="btn btn-success" disabled={isGenerating}>
                    {isGenerating ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
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
