/**
 * CreateScheduleModal — modal form for creating a new schedule.
 *
 * WHY REACT HOOK FORM + THE SHARED ZOD SCHEMA
 * -------------------------------------------
 * This form validates against `createScheduleBody` from `@staff-scheduler/shared`
 * — the exact schema the backend validates the request with. Reusing it via
 * `zodResolver` means the client and server agree on the rules by construction:
 * a field the API would reject (empty name, non-positive department, end date
 * before start) is caught here before a request is sent, and the two can never
 * drift because there is only one schema. React Hook Form manages the field
 * state, wiring and error display so the component holds no manual value state.
 *
 * The parent still owns the async concerns (submitting flag, server error), so
 * this component takes `isCreating`/`createError` and hands validated, typed
 * values to `onSubmit` — it never touches the API itself.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createScheduleBody } from '@staff-scheduler/shared';
import type { Department } from '../../services/departmentService';

export type CreateScheduleValues = z.infer<typeof createScheduleBody>;

interface Props {
  show: boolean;
  departments: Department[];
  isCreating: boolean;
  createError: string | null;
  onClose: () => void;
  onSubmit: (values: CreateScheduleValues) => void;
}

const CreateScheduleModal: React.FC<Props> = ({
  show,
  departments,
  isCreating,
  createError,
  onClose,
  onSubmit,
}) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateScheduleValues>({
    resolver: zodResolver(createScheduleBody),
    defaultValues: { name: '', startDate: '', endDate: '', notes: '' },
  });

  // Reset the fields whenever the modal is (re)opened so a previous draft or the
  // last submission never leaks into a fresh create.
  useEffect(() => {
    if (show) reset({ name: '', startDate: '', endDate: '', notes: '' });
  }, [show, reset]);

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
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
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
                  type="text"
                  className={`form-control${errors.name ? ' is-invalid' : ''}`}
                  placeholder="e.g. April 2026 — ER"
                  disabled={isCreating}
                  {...register('name')}
                />
                {errors.name && <div className="invalid-feedback">{errors.name.message}</div>}
              </div>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="schedule-start" className="form-label">
                    Start Date *
                  </label>
                  <input
                    id="schedule-start"
                    type="date"
                    className={`form-control${errors.startDate ? ' is-invalid' : ''}`}
                    disabled={isCreating}
                    {...register('startDate')}
                  />
                  {errors.startDate && (
                    <div className="invalid-feedback">{errors.startDate.message}</div>
                  )}
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="schedule-end" className="form-label">
                    End Date *
                  </label>
                  <input
                    id="schedule-end"
                    type="date"
                    className={`form-control${errors.endDate ? ' is-invalid' : ''}`}
                    disabled={isCreating}
                    {...register('endDate')}
                  />
                  {errors.endDate && (
                    <div className="invalid-feedback">{errors.endDate.message}</div>
                  )}
                </div>
              </div>
              <div className="mb-3">
                <label htmlFor="schedule-department" className="form-label">
                  Department *
                </label>
                <select
                  id="schedule-department"
                  className={`form-select${errors.departmentId ? ' is-invalid' : ''}`}
                  disabled={isCreating || departments.length === 0}
                  defaultValue=""
                  {...register('departmentId', { valueAsNumber: true })}
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
                {errors.departmentId && (
                  <div className="invalid-feedback">Please select a department.</div>
                )}
              </div>
              <div className="mb-3">
                <label htmlFor="schedule-description" className="form-label">
                  Description
                </label>
                <textarea
                  id="schedule-description"
                  className="form-control"
                  rows={2}
                  placeholder="Optional notes about this schedule"
                  disabled={isCreating}
                  {...register('notes')}
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
