/**
 * ShiftTable — Grid/card list of shifts with edit, staffing and delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../types';
import EmptyState from '../../components/EmptyState';
import { toLocalDateString } from '../../utils/format';

interface Props {
  shifts: Shift[];
  departmentNameById: Map<number, string>;
  searchTerm: string;
  onEdit: (shift: Shift) => void;
  /**
   * Optional so the table stays usable by a caller who cannot staff a shift.
   * The menu entry is omitted rather than disabled: a control that only ever
   * refuses teaches the reader the app is broken, not that they lack the
   * permission.
   */
  onManageStaff?: (shift: Shift) => void;
  onDelete: (shiftId: string | number) => void;
  onAddNew: () => void;
  hasSchedules: boolean;
}

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

const ShiftTable: React.FC<Props> = ({
  shifts,
  departmentNameById,
  searchTerm,
  onEdit,
  onManageStaff,
  onDelete,
  onAddNew,
  hasSchedules,
}) => {
  const { t } = useTranslation();

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon="bi-clock"
        title={t('shifts.table.emptyTitle')}
        message={
          searchTerm
            ? t('shifts.table.emptySearchMessage')
            : !hasSchedules
              ? t('shifts.table.emptyNoSchedulesMessage')
              : t('shifts.table.emptyStartMessage')
        }
        action={
          !searchTerm && hasSchedules
            ? { label: t('shifts.table.createFirstShift'), onClick: onAddNew }
            : undefined
        }
      />
    );
  }

  return (
    <div className="row">
      {shifts.map((shift) => {
        const deptName =
          shift.departmentName ||
          (shift.departmentId ? departmentNameById.get(Number(shift.departmentId)) : '') ||
          t('shifts.table.unknownDepartment');
        const dateStr = toLocalDateString(shift.date);

        return (
          <div key={shift.id} className="col-md-6 col-lg-4 mb-4">
            <div className="card h-100">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h6 className="mb-0">{`${deptName} ${dateStr}`}</h6>
                <div className="dropdown">
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    type="button"
                    aria-label={t('shifts.table.shiftActionsAriaLabel')}
                    data-bs-toggle="dropdown"
                  >
                    <i className="bi bi-three-dots" aria-hidden="true"></i>
                  </button>
                  <ul className="dropdown-menu">
                    <li>
                      <button
                        className="dropdown-item"
                        type="button"
                        onClick={() => onEdit(shift)}
                      >
                        <i className="bi bi-pencil me-2" aria-hidden="true"></i>{t('common.edit')}
                      </button>
                    </li>
                    {onManageStaff && (
                      <li>
                        <button
                          className="dropdown-item"
                          type="button"
                          onClick={() => onManageStaff(shift)}
                        >
                          <i className="bi bi-people me-2" aria-hidden="true"></i>{t('shifts.table.staff')}
                        </button>
                      </li>
                    )}
                    <li>
                      <hr className="dropdown-divider" />
                    </li>
                    <li>
                      <button
                        className="dropdown-item text-danger"
                        type="button"
                        onClick={() => onDelete(shift.id!)}
                      >
                        <i className="bi bi-trash me-2" aria-hidden="true"></i>{t('common.delete')}
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="badge bg-primary">{deptName}</span>
                  <span
                    className={`badge ${
                      shift.status === 'confirmed' ? 'bg-success' : 'bg-secondary'
                    }`}
                  >
                    {shift.status || t('shifts.table.statusOpen')}
                  </span>
                </div>
                <div className="row g-2">
                  <div className="col-6">
                    <strong>{t('shifts.table.date')}</strong>
                    <br />
                    <span className="text-muted">{dateStr}</span>
                  </div>
                  <div className="col-6">
                    <strong>{t('shifts.table.time')}</strong>
                    <br />
                    <span className="text-muted">{formatShiftTime(shift)}</span>
                  </div>
                  <div className="col-6">
                    <strong>{t('shifts.table.duration')}</strong>
                    <br />
                    <span className="text-muted">{getShiftDuration(shift)}</span>
                  </div>
                  <div className="col-6">
                    <strong>{t('shifts.table.requiredStaff')}</strong>
                    <br />
                    <span className="text-muted">
                      {shift.minStaff ?? 0}
                      {shift.maxStaff ? ` – ${shift.maxStaff}` : ''}
                    </span>
                  </div>
                </div>
                {shift.notes && (
                  <div className="mt-3">
                    <strong>{t('shifts.table.notes')}</strong>
                    <br />
                    <span className="text-muted">{shift.notes}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ShiftTable;
