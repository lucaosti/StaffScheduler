/**
 * DecisionModal — approve/reject a pending approval with an optional note.
 * See PendingApprovals.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PendingApprovalItem } from '../../services/pendingApprovalService';

type DecisionMode = 'approve' | 'reject';

interface Props {
  target: PendingApprovalItem | null;
  mode: DecisionMode;
  deciding: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}

const DecisionModal: React.FC<Props> = ({ target, mode, deciding, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm(note);
    } catch (e) {
      setError((e as Error).message ?? t('approvals.actionFailed'));
    }
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true"
      aria-label={mode === 'approve'
        ? t('approvals.approveAriaLabel', { id: target.id })
        : t('approvals.rejectAriaLabel', { id: target.id })}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {t('approvals.reviewModalTitle', {
                action: mode === 'approve' ? t('approvals.approve') : t('approvals.reject'),
                changeType: target.changeType,
              })}
            </h5>
            <button type="button" className="btn-close" aria-label={t('common.close')} onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {error && (
              <div className="alert alert-danger py-2 small" role="alert">{error}</div>
            )}
            <div className="mb-3">
              <label htmlFor="decisionNote" className="form-label">
                {t('approvals.note')} <span className="text-muted small">{t('approvals.optional')}</span>
              </label>
              <textarea
                id="decisionNote"
                className="form-control"
                rows={3}
                placeholder={t('approvals.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={`btn ${mode === 'approve' ? 'btn-success' : 'btn-danger'}`}
              onClick={() => void handleConfirm()}
              disabled={deciding}
              aria-label={mode === 'approve' ? t('approvals.confirmApproveAriaLabel') : t('approvals.confirmRejectAriaLabel')}
            >
              {deciding ? (
                <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('approvals.saving')}</>
              ) : (
                mode === 'approve' ? t('approvals.approve') : t('approvals.reject')
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </div>
  );
};

export default DecisionModal;
