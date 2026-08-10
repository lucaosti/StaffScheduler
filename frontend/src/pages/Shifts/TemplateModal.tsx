/**
 * TemplateModal — Create/edit shift modal form.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shift, Schedule } from '../../types';
import type { Department } from '../../services/departmentService';
import { toLocalDateString, todayIso } from '../../utils/format';
import { useStaffingSuggestion } from '../../hooks/useStaffingSuggestion';

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
  const { t } = useTranslation();
  const editingDateDefault = toLocalDateString(editingShift?.date) || todayIso();

  // Tracked separately from the rest of the (uncontrolled) form, purely to
  // feed the staffing suggestion — the fields that decide which historical
  // shifts match. Submission itself still reads everything from FormData.
  const [departmentId, setDepartmentId] = useState(
    editingShift?.departmentId ? String(editingShift.departmentId) : ''
  );
  const [date, setDate] = useState(editingDateDefault);
  const [startTime, setStartTime] = useState(editingShift?.startTime || '');
  const [endTime, setEndTime] = useState(editingShift?.endTime || '');

  const { data: suggestion, isLoading: suggestionLoading } = useStaffingSuggestion(
    {
      departmentId: departmentId ? Number(departmentId) : undefined,
      date: date || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    },
    show
  );

  if (!show) return null;

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
              {editingShift ? t('shifts.modal.editTitle') : t('shifts.modal.addTitle')}
            </h5>
            <button
              type="button"
              className="btn-close"
              aria-label={t('common.close')}
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
                    {t('shifts.form.schedule')}
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
                      {schedules.length === 0 ? t('shifts.form.noSchedulesAvailable') : t('shifts.form.selectSchedule')}
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
                    {t('shifts.form.department')}
                  </label>
                  <select
                    id="shift-department"
                    name="departmentId"
                    className="form-select"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    required
                    disabled={submitting || departments.length === 0}
                  >
                    <option value="" disabled>
                      {departments.length === 0
                        ? t('shifts.form.noDepartmentsAvailable')
                        : t('shifts.form.selectDepartment')}
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
                    {t('shifts.form.date')}
                  </label>
                  <input
                    type="date"
                    id="shift-date"
                    name="date"
                    className="form-control"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-start" className="form-label">
                    {t('shifts.form.startTime')}
                  </label>
                  <input
                    type="time"
                    id="shift-start"
                    name="startTime"
                    className="form-control"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-end" className="form-label">
                    {t('shifts.form.endTime')}
                  </label>
                  <input
                    type="time"
                    id="shift-end"
                    name="endTime"
                    className="form-control"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    disabled={submitting}
                  />
                  <div className="form-text">
                    {t('shifts.form.overnightHint')}
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-min" className="form-label">
                    {t('shifts.form.minStaff')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    id="shift-min"
                    name="minStaff"
                    className="form-control"
                    defaultValue={editingShift?.minStaff ?? 1}
                    required
                    disabled={submitting}
                  />
                  {suggestionLoading && (
                    <div className="form-text">{t('shifts.form.checkingHistory')}</div>
                  )}
                  {!suggestionLoading && suggestion && (
                    <div className="form-text">
                      {suggestion.basedOnOccurrences > 0
                        ? t(
                            suggestion.basedOnOccurrences === 1
                              ? 'shifts.form.suggestionWithHistoryOne'
                              : 'shifts.form.suggestionWithHistoryOther',
                            {
                              count: suggestion.suggestedMinStaff,
                              occurrences: suggestion.basedOnOccurrences,
                              weeks: suggestion.lookbackWeeks,
                            }
                          )
                        : t('shifts.form.suggestionWithoutHistory', {
                            count: suggestion.suggestedMinStaff,
                          })}
                    </div>
                  )}
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="shift-max" className="form-label">
                    {t('shifts.form.maxStaff')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    id="shift-max"
                    name="maxStaff"
                    className="form-control"
                    defaultValue={editingShift?.maxStaff ?? ''}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="mb-3">
                <label htmlFor="shift-notes" className="form-label">
                  {t('shifts.form.notes')}
                </label>
                <textarea
                  id="shift-notes"
                  name="notes"
                  className="form-control"
                  rows={3}
                  defaultValue={editingShift?.notes || ''}
                  placeholder={t('shifts.form.notesPlaceholder')}
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
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <>
                    <span
                      className="spinner-border spinner-border-sm me-2"
                      role="status"
                    ></span>
                    {t('shifts.form.saving')}
                  </>
                ) : (
                  <>{editingShift ? t('shifts.modal.updateShift') : t('shifts.modal.createShift')}</>
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
