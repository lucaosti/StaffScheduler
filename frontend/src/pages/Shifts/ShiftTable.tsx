/**
 * ShiftTable — Grid/card list of shifts with edit and delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Shift } from '../../types';
import EmptyState from '../../components/EmptyState';

interface Props {
  shifts: Shift[];
  departmentNameById: Map<number, string>;
  searchTerm: string;
  onEdit: (shift: Shift) => void;
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
  onDelete,
  onAddNew,
  hasSchedules,
}) => {
  if (shifts.length === 0) {
    return (
      <EmptyState
        icon="bi-clock"
        title="No Shifts Found"
        message={
          searchTerm
            ? 'No shifts match your search criteria'
            : !hasSchedules
              ? 'Create a schedule first, then add shifts to it.'
              : 'Start by creating your first shift.'
        }
        action={
          !searchTerm && hasSchedules
            ? { label: 'Create First Shift', onClick: onAddNew }
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
          shift.department ||
          (shift.departmentId ? departmentNameById.get(Number(shift.departmentId)) : '') ||
          'Unknown';
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
                    aria-label="Shift actions"
                    data-bs-toggle="dropdown"
                  >
                    <i className="bi bi-three-dots"></i>
                  </button>
                  <ul className="dropdown-menu">
                    <li>
                      <button
                        className="dropdown-item"
                        type="button"
                        onClick={() => onEdit(shift)}
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
                        onClick={() => onDelete(shift.id!)}
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
                    className={`badge ${
                      shift.status === 'confirmed' ? 'bg-success' : 'bg-secondary'
                    }`}
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
      })}
    </div>
  );
};

export default ShiftTable;
