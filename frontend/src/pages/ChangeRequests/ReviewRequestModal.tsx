/**
 * ReviewRequestModal — approve/reject a change request with a note (required
 * on reject, optional on approve). See ChangeRequests.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangeRequest } from '../../services/changeRequestService';

type ReviewMode = 'approve' | 'reject';

interface Props {
  target: ChangeRequest | null;
  mode: ReviewMode;
  reviewing: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}

const ReviewRequestModal: React.FC<Props> = ({ target, mode, reviewing, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  const handleConfirm = async () => {
    if (mode === 'reject' && !note.trim()) {
      setError(t('changeRequests.validation.rejectionReasonRequired'));
      return;
    }
    setError(null);
    try {
      await onConfirm(note);
    } catch (e) {
      setError((e as Error).message ?? t('changeRequests.actionFailed'));
    }
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true"
      aria-label={mode === 'approve'
        ? t('changeRequests.approveAriaLabel', { id: target.id })
        : t('changeRequests.rejectAriaLabel', { id: target.id })}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {t('changeRequests.reviewModalTitle', {
                action: mode === 'approve' ? t('changeRequests.approve') : t('changeRequests.reject'),
                changeType: target.changeType,
              })}
            </h5>
            <button type="button" className="btn-close" aria-label={t('common.close')} onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {error && (
              <div className="alert alert-danger py-2 small" role="alert">{error}</div>
            )}
            <div>
              <label htmlFor="reviewNote" className="form-label">
                {mode === 'reject' ? t('changeRequests.rejectionReason') : t('changeRequests.justification')}
                {mode === 'reject' && <span className="text-danger"> *</span>}
                {mode === 'approve' && <span className="text-muted small"> {t('changeRequests.form.optional')}</span>}
              </label>
              <textarea
                id="reviewNote"
                className="form-control"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={mode === 'reject' ? t('changeRequests.form.rejectionReasonPlaceholder') : t('changeRequests.form.optionalJustificationPlaceholder')}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button
              type="button"
              className={`btn ${mode === 'approve' ? 'btn-success' : 'btn-danger'}`}
              onClick={() => void handleConfirm()}
              disabled={reviewing}
              aria-label={mode === 'approve' ? t('changeRequests.confirmApproveAriaLabel') : t('changeRequests.confirmRejectAriaLabel')}
            >
              {reviewing ? (
                <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('changeRequests.saving')}</>
              ) : (
                mode === 'approve' ? t('changeRequests.approve') : t('changeRequests.reject')
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </div>
  );
};

export default ReviewRequestModal;
