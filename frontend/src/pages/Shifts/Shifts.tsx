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
import { useTranslation } from 'react-i18next';
import { Shift } from '../../types';
import { ApiError } from '../../services/apiUtils';
import ShiftTable from '../Shifts/ShiftTable';
import TemplateModal from '../Shifts/TemplateModal';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useShiftsPageData, useDeleteShift, useSaveShift } from '../../hooks/useShifts';
import { useAuth } from '../../contexts/AuthContext';
import ShiftAssignmentPanel from '../Assignments/ShiftAssignmentPanel';
import ExportCsvLink from '../../components/ExportCsvLink';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const Shifts: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Assigning people is `assignment.manage`; editing the shift itself is not.
  // The menu entry is omitted without it rather than shown and refused.
  const canAssign = (user?.permissions ?? []).includes('assignment.manage');
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

  const [staffingShift, setStaffingShift] = useState<Shift | null>(null);
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
      : t('shifts.loadFailed')
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
      title: t('shifts.deleteShift.title'),
      message: t('shifts.deleteShift.message'),
      onConfirm: async () => {
        setConfirm((prev) => ({ ...prev, show: false }));
        try {
          await deleteShift.mutateAsync(shiftId);
          setInfo(t('shifts.deleted'));
        } catch (err) {
          const message = err instanceof ApiError ? err.message : t('shifts.deleteFailed');
          setError(message);
        }
      },
    });
  };

  const filteredShifts = useMemo(() => shifts.filter((shift) => {
    const matchesSearch =
      !debouncedSearch ||
      (shift.departmentName || '')
        .toLowerCase()
        .includes(debouncedSearch.toLowerCase()) ||
      (shift.notes && shift.notes.toLowerCase().includes(debouncedSearch.toLowerCase()));

    const matchesDepartment =
      !selectedDepartment ||
      String(shift.departmentId) === selectedDepartment ||
      shift.departmentName === selectedDepartment;

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
      setFormError(t('shifts.form.validationMessage'));
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
      setFormError(t('shifts.missingIdError'));
      return;
    }
    try {
      await saveShift.mutateAsync({ id: editingShift ? editingShift.id : undefined, data: payload });
      setInfo(editingShift ? t('shifts.updated') : t('shifts.created'));
      setShowAddModal(false);
      setEditingShift(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('shifts.saveFailed');
      setFormError(message);
    }
  };

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <LoadingSpinner message={t('shifts.loading')} />
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">{t('shifts.title')}</h1>
              <p className="text-muted mb-0">
                {t('shifts.subtitle')}
              </p>
            </div>
            <div className="d-flex gap-2">
            <ExportCsvLink
              path="/shifts/export"
              params={{ departmentId: selectedDepartment }}
              disabled={filteredShifts.length === 0}
              className="btn btn-outline-secondary"
            />
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
              {t('shifts.addNewShift')}
            </button>
            </div>
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
              placeholder={t('shifts.searchPlaceholder')}
              aria-label={t('shifts.searchAriaLabel')}
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
            <option value="">{t('shifts.allDepartments')}</option>
            {departments.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <div className="text-muted">
            {filteredShifts.length === 1
              ? t('shifts.totalSingular', { count: filteredShifts.length })
              : t('shifts.totalPlural', { count: filteredShifts.length })}
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
        onManageStaff={canAssign ? (shift) => setStaffingShift(shift) : undefined}
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

      {staffingShift && (
        <div
          className="modal d-block"
          role="dialog"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,.5)' }}
        >
          <div className="modal-dialog modal-lg" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h2 className="modal-title h5">
                  {t('shifts.staffModalTitle', {
                    date: String(staffingShift.date).slice(0, 10),
                    startTime: staffingShift.startTime,
                    endTime: staffingShift.endTime,
                  })}
                </h2>
                <button
                  type="button"
                  className="btn-close"
                  aria-label={t('common.close')}
                  onClick={() => setStaffingShift(null)}
                />
              </div>
              <div className="modal-body">
                <ShiftAssignmentPanel shiftId={Number(staffingShift.id)} canManage={canAssign} />
              </div>
            </div>
          </div>
        </div>
      )}

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
