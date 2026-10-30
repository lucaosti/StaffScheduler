/**
 * ShiftTable — Grid/card list of shifts with edit, staffing and delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../types';
import EmptyState from '../../components/EmptyState';
import Dropdown from '../../components/Dropdown';
import { formatShiftDuration, formatTime, toLocalDateString } from '../../utils/format';

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

// The API sends `HH:MM:SS`; both helpers normalise it (#891).
const formatShiftTime = (shift: Shift) => `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`;

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
                <Dropdown
                  toggleClassName="btn btn-sm btn-outline-secondary"
                  toggleLabel={t('shifts.table.shiftActionsAriaLabel')}
                  toggleContent={<i className="bi bi-three-dots" aria-hidden="true"></i>}
                  alignEnd
                >
                  <li role="none">
                    <button
                      className="dropdown-item"
                      role="menuitem"
                      type="button"
                      onClick={() => onEdit(shift)}
                    >
                      <i className="bi bi-pencil me-2" aria-hidden="true"></i>{t('common.edit')}
                    </button>
                  </li>
                  {onManageStaff && (
                    <li role="none">
                      <button
                        className="dropdown-item"
                        role="menuitem"
                        type="button"
                        onClick={() => onManageStaff(shift)}
                      >
                        <i className="bi bi-people me-2" aria-hidden="true"></i>{t('shifts.table.staff')}
                      </button>
                    </li>
                  )}
                  <li role="separator">
                    <hr className="dropdown-divider" />
                  </li>
                  <li role="none">
                    <button
                      className="dropdown-item text-danger"
                      role="menuitem"
                      type="button"
                      onClick={() => onDelete(shift.id!)}
                    >
                      <i className="bi bi-trash me-2" aria-hidden="true"></i>{t('common.delete')}
                    </button>
                  </li>
                </Dropdown>
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
                    <span className="text-muted">{formatShiftDuration(shift.startTime, shift.endTime)}</span>
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
