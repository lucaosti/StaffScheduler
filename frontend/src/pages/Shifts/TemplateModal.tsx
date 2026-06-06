/**
 * TemplateModal — Create/edit shift modal form.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Shift, Schedule } from '../../types';
import type { Department } from '../../services/departmentService';

interface Props {
  show: boolean;
  editingShift: Shift | null;
  schedules: Schedule[];
  departments: Department[];
  submitting: boolean;
  formError: string | null;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

const TemplateModal: React.FC<Props> = ({
  show,
  editingShift,
  schedules,
  departments,
  submitting,
  formError,
  onClose,
  onSubmit,
}) => {
  if (!show) return null;

  const editingDateDefault = editingShift?.date
    ? typeof editingShift.date === 'string'
      ? editingShift.date.slice(0, 10)
      : editingShift.date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return (
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
              onClick={onClose}
            ></button>
          </div>
          <form onSubmit={onSubmit}>
            <div className="modal-body">
              {formError && (
                <div className="alert alert-danger" role="alert">
                  {formError}
                </div>
              )}
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-schedule" className="form-label">
                    Schedule *
                  </label>
                  <select
                    id="shift-schedule"
                    name="scheduleId"
                    className="form-select"
                    defaultValue={
                      editingShift?.scheduleId ? String(editingShift.scheduleId) : ''
                    }
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
                  <label htmlFor="shift-department" className="form-label">
                    Department *
                  </label>
                  <select
                    id="shift-department"
                    name="departmentId"
                    className="form-select"
                    defaultValue={
                      editingShift?.departmentId ? String(editingShift.departmentId) : ''
                    }
                    required
                    disabled={submitting || departments.length === 0}
                  >
                    <option value="" disabled>
                      {departments.length === 0
                        ? 'No departments available'
                        : 'Select a department'}
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
                  <label htmlFor="shift-date" className="form-label">
                    Date *
                  </label>
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
                  <label htmlFor="shift-start" className="form-label">
                    Start Time *
                  </label>
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
                  <label htmlFor="shift-end" className="form-label">
                    End Time *
                  </label>
                  <input
                    type="time"
                    id="shift-end"
                    name="endTime"
                    className="form-control"
                    defaultValue={editingShift?.endTime || ''}
                    required
                    disabled={submitting}
                  />
                  <div className="form-text">
                    End time can be on the next day for overnight shifts.
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-min" className="form-label">
                    Min Staff *
                  </label>
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
                  <label htmlFor="shift-max" className="form-label">
                    Max Staff
                  </label>
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
                <label htmlFor="shift-notes" className="form-label">
                  Notes
                </label>
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
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <>
                    <span
                      className="spinner-border spinner-border-sm me-2"
                      role="status"
                    ></span>
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
  );
};

export default TemplateModal;
