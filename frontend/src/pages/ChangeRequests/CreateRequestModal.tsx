/**
 * CreateRequestModal — submit a new change request. See ChangeRequests.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateChangeRequestInput } from '../../services/changeRequestService';
import ButtonSpinner from '../../components/ButtonSpinner';

const EMPTY_FORM: Omit<CreateChangeRequestInput, 'proposedPayload'> & { payloadText: string } = {
  changeType: '',
  targetEntityType: '',
  targetEntityId: undefined,
  justification: '',
  payloadText: '{}',
};

interface Props {
  show: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (body: CreateChangeRequestInput) => Promise<void>;
}

const CreateRequestModal: React.FC<Props> = ({ show, creating, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);

  // Resets the form every time the modal opens.
  useEffect(() => {
    if (show) {
      setForm({ ...EMPTY_FORM });
      setError(null);
    }
  }, [show]);

  if (!show) return null;

  const handleSubmit = async () => {
    if (!form.changeType.trim()) { setError(t('changeRequests.validation.changeTypeRequired')); return; }
    if (!form.targetEntityType.trim()) { setError(t('changeRequests.validation.entityTypeRequired')); return; }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(form.payloadText || '{}');
    } catch {
      setError(t('changeRequests.validation.payloadInvalidJson'));
      return;
    }
    setError(null);
    try {
      await onSubmit({
        changeType: form.changeType.trim(),
        targetEntityType: form.targetEntityType.trim(),
        targetEntityId: form.targetEntityId ?? null,
        proposedPayload: payload,
        justification: form.justification?.trim() || null,
      });
    } catch (e) {
      setError((e as Error).message ?? t('changeRequests.createFailed'));
    }
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('changeRequests.newChangeRequest')}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{t('changeRequests.newChangeRequest')}</h5>
            <button type="button" className="btn-close" aria-label={t('common.close')} onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {error && (
              <div className="alert alert-danger py-2 small" role="alert">{error}</div>
            )}
            <div className="row g-3">
              <div className="col-md-6">
                <label htmlFor="crChangeType" className="form-label">{t('changeRequests.form.changeType')} <span className="text-danger">*</span></label>
                <input
                  id="crChangeType"
                  type="text"
                  className="form-control"
                  placeholder={t('changeRequests.form.changeTypePlaceholder')}
                  value={form.changeType}
                  onChange={(e) => setForm((f) => ({ ...f, changeType: e.target.value }))}
                />
              </div>
              <div className="col-md-6">
                <label htmlFor="crEntityType" className="form-label">{t('changeRequests.form.entityType')} <span className="text-danger">*</span></label>
                <input
                  id="crEntityType"
                  type="text"
                  className="form-control"
                  placeholder={t('changeRequests.form.entityTypePlaceholder')}
                  value={form.targetEntityType}
                  onChange={(e) => setForm((f) => ({ ...f, targetEntityType: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label htmlFor="crEntityId" className="form-label">{t('changeRequests.form.entityId')} <span className="text-muted small">{t('changeRequests.form.optional')}</span></label>
                <input
                  id="crEntityId"
                  type="number"
                  className="form-control"
                  placeholder={t('changeRequests.form.entityIdPlaceholder')}
                  value={form.targetEntityId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, targetEntityId: e.target.value ? Number(e.target.value) : undefined }))}
                  min={1}
                />
              </div>
              <div className="col-12">
                <label htmlFor="crPayload" className="form-label">{t('changeRequests.form.proposedPayload')} <span className="text-danger">*</span></label>
                <textarea
                  id="crPayload"
                  className="form-control font-monospace"
                  rows={5}
                  value={form.payloadText}
                  onChange={(e) => setForm((f) => ({ ...f, payloadText: e.target.value }))}
                  placeholder='{}'
                />
              </div>
              <div className="col-12">
                <label htmlFor="crJustification" className="form-label">{t('changeRequests.form.justification')} <span className="text-muted small">{t('changeRequests.form.optional')}</span></label>
                <textarea
                  id="crJustification"
                  className="form-control"
                  rows={2}
                  value={form.justification ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                  placeholder={t('changeRequests.form.justificationPlaceholder')}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSubmit()}
              disabled={creating}
              aria-label={t('changeRequests.form.submitAriaLabel')}
            >
              {creating ? (
                <><ButtonSpinner />{t('changeRequests.submitting')}</>
              ) : t('changeRequests.submit')}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </div>
  );
};

export default CreateRequestModal;
