/**
 * CreateScheduleModal — Modal form for creating a new schedule.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import type { Department } from '../../services/departmentService';

interface Props {
  show: boolean;
  departments: Department[];
  isCreating: boolean;
  createError: string | null;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

const CreateScheduleModal: React.FC<Props> = ({
  show,
  departments,
  isCreating,
  createError,
  onClose,
  onSubmit,
}) => {
  if (!show) return null;

  return (
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
            <h5 className="modal-title" id="create-schedule-title">
              Create Schedule
            </h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={isCreating}
              onClick={onClose}
            ></button>
          </div>
          <form onSubmit={onSubmit}>
            <div className="modal-body">
              {createError && (
                <div className="alert alert-danger" role="alert">
                  {createError}
                </div>
              )}
              <div className="mb-3">
                <label htmlFor="schedule-name" className="form-label">
                  Name *
                </label>
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
                  <label htmlFor="schedule-start" className="form-label">
                    Start Date *
                  </label>
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
                  <label htmlFor="schedule-end" className="form-label">
                    End Date *
                  </label>
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
                <label htmlFor="schedule-department" className="form-label">
                  Department *
                </label>
                <select
                  id="schedule-department"
                  name="departmentId"
                  className="form-select"
                  required
                  disabled={isCreating || departments.length === 0}
                  defaultValue=""
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
              <div className="mb-3">
                <label htmlFor="schedule-description" className="form-label">
                  Description
                </label>
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
                onClick={onClose}
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
                    <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>Create Schedule
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateScheduleModal;
