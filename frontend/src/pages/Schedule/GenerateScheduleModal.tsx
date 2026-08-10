/**
 * GenerateScheduleModal — picks an existing schedule and triggers optimization.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Schedule } from '../../types';
import ErrorAlert from '../../components/ErrorAlert';

interface Props {
  show: boolean;
  schedules: Schedule[];
  selectedScheduleId: string | number | null;
  isGenerating: boolean;
  generateError: string | null;
  onSelectSchedule: (id: string | number | null) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

const GenerateScheduleModal: React.FC<Props> = ({
  show,
  schedules,
  selectedScheduleId,
  isGenerating,
  generateError,
  onSelectSchedule,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();

  if (!show) return null;

  return (
    <div
      className="modal show d-block"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-schedule-title"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="generate-schedule-title">
              {t('schedule.generateModalTitle')}
            </h5>
            <button
              type="button"
              className="btn-close"
              aria-label={t('common.close')}
              disabled={isGenerating}
              onClick={onClose}
            ></button>
          </div>
          <form onSubmit={onSubmit}>
            <div className="modal-body">
              {generateError && <ErrorAlert message={generateError} />}
              <div className="mb-3">
                <label htmlFor="generate-schedule-id" className="form-label">
                  {t('schedule.scheduleLabel')}
                </label>
                <select
                  id="generate-schedule-id"
                  className="form-select"
                  value={selectedScheduleId !== null ? String(selectedScheduleId) : ''}
                  onChange={(e) => onSelectSchedule(e.target.value || null)}
                  required
                  disabled={isGenerating || schedules.length === 0}
                >
                  <option value="" disabled>
                    {schedules.length === 0
                      ? t('schedule.noSchedulesAvailable')
                      : t('schedule.selectSchedule')}
                  </option>
                  {schedules.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {t('schedule.optionRange', {
                        name: s.name,
                        start: String(s.startDate).slice(0, 10),
                        end: String(s.endDate).slice(0, 10),
                      })}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-muted small mb-0">{t('schedule.generateHint')}</p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={isGenerating}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-success" disabled={isGenerating}>
                {isGenerating ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    {t('schedule.generating')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-magic me-2"></i>{t('schedule.generate')}
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

export default GenerateScheduleModal;
