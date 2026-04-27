/**
 * Shifts Page Component for Staff Scheduler
 *
 * Lists shifts and allows creating / editing / deleting individual shifts
 * tied to an existing schedule and department.
 *
 * The form posts a payload aligned with the backend `CreateShiftRequest`
 * (scheduleId + departmentId + date + start/end times + min/max staff).
 *
 * @author Luca Ostinelli
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Shift, Schedule } from '../../types';
import * as shiftService from '../../services/shiftService';
import * as scheduleService from '../../services/scheduleService';
import * as departmentService from '../../services/departmentService';
import type { Department } from '../../services/departmentService';
import { ApiError } from '../../services/apiUtils';

const Shifts: React.FC = () => {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadShifts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [shiftsResponse, schedulesResponse, departmentsResponse] = await Promise.all([
        shiftService.getShifts({}),
        scheduleService.getSchedules(),
        departmentService.getDepartments(),
      ]);

      if (shiftsResponse.success && shiftsResponse.data) {
        setShifts(shiftsResponse.data);
      } else {
        setError('Failed to load shifts. Please ensure the backend is running and database is populated.');
        setShifts([]);
      }

      if (schedulesResponse.success && schedulesResponse.data) {
        setSchedules(schedulesResponse.data);
      }

      if (departmentsResponse.success && departmentsResponse.data) {
        setDepartments(departmentsResponse.data);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load shifts.';
      setError(message);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const departmentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const handleDeleteShift = async (shiftId: string | number) => {
    if (!window.confirm('Are you sure you want to delete this shift? This action cannot be undone.')) {
      return;
    }
    try {
      await shiftService.deleteShift(shiftId);
      setInfo('Shift deleted.');
      await loadShifts();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete shift.';
      setError(message);
    }
  };

  const formatShiftTime = (shift: Shift) => `${shift.startTime} - ${shift.endTime}`;

  const getShiftDuration = (shift: Shift) => {
    const start = new Date(`2000-01-01T${shift.startTime}:00`);
    let end = new Date(`2000-01-01T${shift.endTime}:00`);
    if (end <= start) {
      end = new Date(`2000-01-02T${shift.endTime}:00`);
    }
    const diffMs = end.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  };

  const filteredShifts = shifts.filter((shift) => {
    const matchesSearch =
      !searchTerm ||
      (shift.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (shift.departmentName || shift.department || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (shift.notes && shift.notes.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesDepartment =
      !selectedDepartment ||
      String(shift.departmentId) === selectedDepartment ||
      shift.departmentName === selectedDepartment ||
      shift.department === selectedDepartment;

    return matchesSearch && matchesDepartment;
  });

  const handleSubmitShift = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const formData = new FormData(event.currentTarget);

    const scheduleIdRaw = formData.get('scheduleId') as string;
    const departmentIdRaw = formData.get('departmentId') as string;
    const date = formData.get('date') as string;
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;
    const minStaffRaw = formData.get('minStaff') as string;
    const maxStaffRaw = formData.get('maxStaff') as string;
    const notes = (formData.get('notes') as string)?.trim() || undefined;

    if (!scheduleIdRaw || !departmentIdRaw || !date || !startTime || !endTime || !minStaffRaw) {
      setFormError('Please fill in schedule, department, date, start/end times and minimum staff.');
      return;
    }

    const payload = {
      scheduleId: Number(scheduleIdRaw),
      departmentId: Number(departmentIdRaw),
      date,
      startTime,
      endTime,
      minStaff: Number(minStaffRaw),
      maxStaff: maxStaffRaw ? Number(maxStaffRaw) : Number(minStaffRaw),
      notes,
    };

    setSubmitting(true);
    try {
      if (editingShift) {
        await shiftService.updateShift(editingShift.id!, payload);
        setInfo('Shift updated.');
      } else {
        await shiftService.createShift(payload);
        setInfo('Shift created.');
      }
      setShowAddModal(false);
      setEditingShift(null);
      await loadShifts();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save shift.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading shifts...</p>
        </div>
      </div>
    );
  }

  const editingDateDefault = editingShift?.date
    ? typeof editingShift.date === 'string'
      ? editingShift.date.slice(0, 10)
      : editingShift.date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">Shift Management</h1>
              <p className="text-muted mb-0">
                Create and manage shifts inside published or draft schedules.
              </p>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              disabled={schedules.length === 0 || departments.length === 0}
              onClick={() => {
                setFormError(null);
                setEditingShift(null);
                setShowAddModal(true);
              }}
            >
              <i className="bi bi-plus-lg me-2"></i>
              Add New Shift
            </button>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-md-6">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search shifts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
            Total: {filteredShifts.length} shift{filteredShifts.length !== 1 ? 's' : ''}
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

      <div className="row">
        {filteredShifts.length === 0 ? (
          <div className="col-12">
            <div className="card">
              <div className="card-body text-center py-5">
                <i className="bi bi-clock text-muted" style={{ fontSize: '3rem' }}></i>
                <h5 className="mt-3">No Shifts Found</h5>
                <p className="text-muted">
                  {searchTerm || selectedDepartment
                    ? 'No shifts match your search criteria'
                    : schedules.length === 0
                    ? 'Create a schedule first, then add shifts to it.'
                    : 'Start by creating your first shift.'}
                </p>
                {!searchTerm && !selectedDepartment && schedules.length > 0 && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      setFormError(null);
                      setEditingShift(null);
                      setShowAddModal(true);
                    }}
                  >
                    <i className="bi bi-plus-lg me-2"></i>
                    Create First Shift
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          filteredShifts.map((shift) => {
            const deptName = shift.departmentName
              || shift.department
              || (shift.departmentId ? departmentNameById.get(Number(shift.departmentId)) : '')
              || 'Unknown';
            const dateStr = shift.date
              ? typeof shift.date === 'string'
                ? shift.date.slice(0, 10)
                : shift.date.toISOString().slice(0, 10)
              : '';
            return (
              <div key={shift.id} className="col-md-6 col-lg-4 mb-4">
                <div className="card h-100">
                  <div className="card-header d-flex justify-content-between align-items-center">
                    <h6 className="mb-0">{shift.name || `${deptName} ${dateStr}`}</h6>
                    <div className="dropdown">
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        type="button"
                        data-bs-toggle="dropdown"
                      >
                        <i className="bi bi-three-dots"></i>
                      </button>
                      <ul className="dropdown-menu">
                        <li>
                          <button
                            className="dropdown-item"
                            type="button"
                            onClick={() => {
                              setFormError(null);
                              setEditingShift(shift);
                              setShowAddModal(true);
                            }}
                          >
                            <i className="bi bi-pencil me-2"></i>Edit
                          </button>
                        </li>
                        <li>
                          <hr className="dropdown-divider" />
                        </li>
                        <li>
                          <button
                            className="dropdown-item text-danger"
                            type="button"
                            onClick={() => handleDeleteShift(shift.id!)}
                          >
                            <i className="bi bi-trash me-2"></i>Delete
                          </button>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="badge bg-primary">{deptName}</span>
                      <span
                        className={`badge ${shift.status === 'confirmed' ? 'bg-success' : 'bg-secondary'}`}
                      >
                        {shift.status || 'open'}
                      </span>
                    </div>
                    <div className="row g-2">
                      <div className="col-6">
                        <strong>Date:</strong>
                        <br />
                        <span className="text-muted">{dateStr}</span>
                      </div>
                      <div className="col-6">
                        <strong>Time:</strong>
                        <br />
                        <span className="text-muted">{formatShiftTime(shift)}</span>
                      </div>
                      <div className="col-6">
                        <strong>Duration:</strong>
                        <br />
                        <span className="text-muted">{getShiftDuration(shift)}</span>
                      </div>
                      <div className="col-6">
                        <strong>Required Staff:</strong>
                        <br />
                        <span className="text-muted">
                          {shift.minStaff ?? shift.minimumStaff ?? 0}
                          {shift.maxStaff ? ` – ${shift.maxStaff}` : ''}
                        </span>
                      </div>
                    </div>
                    {shift.notes && (
                      <div className="mt-3">
                        <strong>Notes:</strong>
                        <br />
                        <span className="text-muted">{shift.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {(showAddModal || editingShift) && (
        <div
          className="modal show d-block"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-modal-title"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="shift-modal-title">
                  {editingShift ? 'Edit Shift' : 'Add New Shift'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  disabled={submitting}
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingShift(null);
                  }}
                ></button>
              </div>
              <form onSubmit={handleSubmitShift}>
                <div className="modal-body">
                  {formError && (
                    <div className="alert alert-danger" role="alert">
                      {formError}
                    </div>
                  )}
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-schedule" className="form-label">Schedule *</label>
                      <select
                        id="shift-schedule"
                        name="scheduleId"
                        className="form-select"
                        defaultValue={editingShift?.scheduleId ? String(editingShift.scheduleId) : ''}
                        required
                        disabled={submitting || schedules.length === 0}
                      >
                        <option value="" disabled>
                          {schedules.length === 0 ? 'No schedules available' : 'Select a schedule'}
                        </option>
                        {schedules.map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-department" className="form-label">Department *</label>
                      <select
                        id="shift-department"
                        name="departmentId"
                        className="form-select"
                        defaultValue={editingShift?.departmentId ? String(editingShift.departmentId) : ''}
                        required
                        disabled={submitting || departments.length === 0}
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
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-date" className="form-label">Date *</label>
                      <input
                        type="date"
                        id="shift-date"
                        name="date"
                        className="form-control"
                        defaultValue={editingDateDefault}
                        required
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-start" className="form-label">Start Time *</label>
                      <input
                        type="time"
                        id="shift-start"
                        name="startTime"
                        className="form-control"
                        defaultValue={editingShift?.startTime || ''}
                        required
                        disabled={submitting}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-end" className="form-label">End Time *</label>
                      <input
                        type="time"
                        id="shift-end"
                        name="endTime"
                        className="form-control"
                        defaultValue={editingShift?.endTime || ''}
                        required
                        disabled={submitting}
                      />
                      <div className="form-text">End time can be on the next day for overnight shifts.</div>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-min" className="form-label">Min Staff *</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        id="shift-min"
                        name="minStaff"
                        className="form-control"
                        defaultValue={editingShift?.minStaff ?? editingShift?.minimumStaff ?? 1}
                        required
                        disabled={submitting}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="shift-max" className="form-label">Max Staff</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        id="shift-max"
                        name="maxStaff"
                        className="form-control"
                        defaultValue={editingShift?.maxStaff ?? editingShift?.maximumStaff ?? ''}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label htmlFor="shift-notes" className="form-label">Notes</label>
                    <textarea
                      id="shift-notes"
                      name="notes"
                      className="form-control"
                      rows={3}
                      defaultValue={editingShift?.notes || ''}
                      placeholder="Optional notes for this shift"
                      disabled={submitting}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowAddModal(false);
                      setEditingShift(null);
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Saving...
                      </>
                    ) : (
                      <>{editingShift ? 'Update' : 'Create'} Shift</>
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

export default Shifts;
