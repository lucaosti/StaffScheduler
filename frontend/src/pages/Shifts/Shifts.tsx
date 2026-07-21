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

import React, { useState, useEffect, useMemo } from 'react';
import { Shift } from '../../types';
import { ApiError } from '../../services/apiUtils';
import ShiftTable from '../Shifts/ShiftTable';
import TemplateModal from '../Shifts/TemplateModal';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useShiftsPageData, useDeleteShift, useSaveShift } from '../../hooks/useShifts';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const Shifts: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const [confirm, setConfirm] = useState<ConfirmState>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => undefined,
  });

  // Server state via TanStack Query; mutations invalidate the page data so the
  // table refreshes itself after create/update/delete.
  const shiftsQuery = useShiftsPageData();
  const deleteShift = useDeleteShift();
  const saveShift = useSaveShift();

  const shifts = useMemo(() => shiftsQuery.data?.shifts ?? [], [shiftsQuery.data]);
  const schedules = shiftsQuery.data?.schedules ?? [];
  const departments = useMemo(() => shiftsQuery.data?.departments ?? [], [shiftsQuery.data]);
  const loading = shiftsQuery.isLoading;
  const submitting = saveShift.isPending;
  // A load error comes from the query; action errors are set locally below.
  const loadError = shiftsQuery.isError
    ? shiftsQuery.error instanceof ApiError
      ? shiftsQuery.error.message
      : 'Failed to load shifts.'
    : null;
  const displayError = error ?? loadError;

  const departmentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const handleDeleteShift = (shiftId: string | number) => {
    setConfirm({
      show: true,
      title: 'Delete shift',
      message: 'Are you sure you want to delete this shift? This action cannot be undone.',
      onConfirm: async () => {
        setConfirm((prev) => ({ ...prev, show: false }));
        try {
          await deleteShift.mutateAsync(shiftId);
          setInfo('Shift deleted.');
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Failed to delete shift.';
          setError(message);
        }
      },
    });
  };

  const filteredShifts = useMemo(() => shifts.filter((shift) => {
    const matchesSearch =
      !debouncedSearch ||
      (shift.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (shift.departmentName || shift.department || '')
        .toLowerCase()
        .includes(debouncedSearch.toLowerCase()) ||
      (shift.notes && shift.notes.toLowerCase().includes(debouncedSearch.toLowerCase()));

    const matchesDepartment =
      !selectedDepartment ||
      String(shift.departmentId) === selectedDepartment ||
      shift.departmentName === selectedDepartment ||
      shift.department === selectedDepartment;

    return matchesSearch && matchesDepartment;
  }), [shifts, debouncedSearch, selectedDepartment]);

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
      setFormError(
        'Please fill in schedule, department, date, start/end times and minimum staff.'
      );
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

    if (editingShift && !editingShift.id) {
      setFormError('Cannot update shift: missing ID');
      return;
    }
    try {
      await saveShift.mutateAsync({ id: editingShift ? editingShift.id : undefined, data: payload });
      setInfo(editingShift ? 'Shift updated.' : 'Shift created.');
      setShowAddModal(false);
      setEditingShift(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save shift.';
      setFormError(message);
    }
  };

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <LoadingSpinner message="Loading shifts..." />
      </div>
    );
  }

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
              <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>
              Add New Shift
            </button>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-md-6">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-search" aria-hidden="true"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search shifts..."
              aria-label="Search shifts"
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

      {displayError && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
          {displayError}
        </div>
      )}
      {info && (
        <div className="alert alert-success" role="alert">
          <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
          {info}
        </div>
      )}

      <ShiftTable
        shifts={filteredShifts}
        departmentNameById={departmentNameById}
        searchTerm={searchTerm}
        onEdit={(shift) => {
          setFormError(null);
          setEditingShift(shift);
          setShowAddModal(true);
        }}
        onDelete={handleDeleteShift}
        onAddNew={() => {
          setFormError(null);
          setEditingShift(null);
          setShowAddModal(true);
        }}
        hasSchedules={schedules.length > 0}
      />

      <TemplateModal
        show={showAddModal || !!editingShift}
        editingShift={editingShift}
        schedules={schedules}
        departments={departments}
        submitting={submitting}
        formError={formError}
        onClose={() => {
          setShowAddModal(false);
          setEditingShift(null);
        }}
        onSubmit={handleSubmitShift}
      />

      <ConfirmModal
        show={confirm.show}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default Shifts;
