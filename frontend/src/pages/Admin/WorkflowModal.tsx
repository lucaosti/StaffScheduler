/**
 * WorkflowModal — create/edit form for an approval workflow, including its
 * ordered approver-step editor. See ApprovalWorkflows.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApprovalWorkflow,
  ApprovalStep,
  ApproverScope,
  CreateWorkflowBody,
} from '../../services/approvalWorkflowService';
import { SCOPE_LABEL_KEYS } from './WorkflowTable';
import ButtonSpinner from '../../components/ButtonSpinner';

const SCOPE_KEYS = Object.keys(SCOPE_LABEL_KEYS) as ApproverScope[];

const EMPTY_STEP: ApprovalStep = {
  stepOrder: 1,
  approverScope: 'unit_manager',
  approverRoleId: null,
  approverUserId: null,
  autoApproveForOwner: false,
  escalateAfterHours: null,
};

export interface WorkflowUpdatePayload {
  requireAll: boolean;
  description?: string;
  steps: ApprovalStep[];
}

interface Props {
  show: boolean;
  mode: 'create' | 'edit';
  editing: ApprovalWorkflow | null;
  saving: boolean;
  onClose: () => void;
  onCreate: (body: CreateWorkflowBody) => Promise<void>;
  onUpdate: (id: number, body: WorkflowUpdatePayload) => Promise<void>;
}

const WorkflowModal: React.FC<Props> = ({ show, mode, editing, saving, onClose, onCreate, onUpdate }) => {
  const { t } = useTranslation();
  const [changeType, setChangeType] = useState('');
  const [requireAll, setRequireAll] = useState(false);
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<ApprovalStep[]>([{ ...EMPTY_STEP }]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resets the form from `editing` (or to a blank create form) every time the
  // modal opens, so switching between two "edit" clicks without the modal
  // ever unmounting still starts from the right workflow.
  useEffect(() => {
    if (!show) return;
    setSaveError(null);
    if (mode === 'edit' && editing) {
      setChangeType(editing.changeType);
      setRequireAll(editing.requireAll);
      setDescription(editing.description ?? '');
      setSteps(editing.steps.length > 0 ? editing.steps.map((s) => ({ ...s })) : [{ ...EMPTY_STEP }]);
    } else {
      setChangeType('');
      setRequireAll(false);
      setDescription('');
      setSteps([{ ...EMPTY_STEP }]);
    }
  }, [show, mode, editing]);

  if (!show) return null;

  const addStep = () => setSteps((prev) => [...prev, { ...EMPTY_STEP, stepOrder: prev.length + 1 }]);
  const removeStep = (index: number) => setSteps((prev) => prev.filter((_, i) => i !== index));
  const updateStep = (index: number, patch: Partial<ApprovalStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const handleSave = async () => {
    if (!changeType.trim()) {
      setSaveError(t('admin.approvalWorkflows.errors.changeTypeRequired'));
      return;
    }
    if (steps.length === 0) {
      setSaveError(t('admin.approvalWorkflows.errors.atLeastOneStep'));
      return;
    }
    setSaveError(null);
    const stepsPayload = steps.map((s, i) => ({
      stepOrder: i + 1,
      approverScope: s.approverScope,
      approverRoleId: s.approverRoleId ?? null,
      approverUserId: s.approverUserId ?? null,
      autoApproveForOwner: s.autoApproveForOwner ?? false,
      escalateAfterHours: s.escalateAfterHours ?? null,
    }));
    try {
      if (mode === 'create') {
        await onCreate({
          changeType: changeType.trim(),
          requireAll,
          description: description.trim() || undefined,
          steps: stepsPayload,
        });
      } else if (editing) {
        await onUpdate(editing.id, {
          requireAll,
          description: description.trim() || undefined,
          steps: stepsPayload,
        });
      }
    } catch (e) {
      setSaveError((e as Error).message ?? t('admin.approvalWorkflows.errors.saveFailed'));
    }
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={mode === 'create' ? t('admin.approvalWorkflows.modal.createDialogAriaLabel') : t('admin.approvalWorkflows.modal.editDialogAriaLabel')}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {mode === 'create' ? t('admin.approvalWorkflows.modal.createTitle') : t('admin.approvalWorkflows.modal.editTitle', { changeType: editing?.changeType })}
            </h5>
            <button type="button" className="btn-close" aria-label={t('admin.approvalWorkflows.modal.closeDialogAriaLabel')} onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {saveError && (
              <div className="alert alert-danger py-2 small" role="alert">{saveError}</div>
            )}
            <div className="mb-3">
              <label htmlFor="wfChangeType" className="form-label">{t('admin.approvalWorkflows.modal.changeTypeLabel')} <span className="text-danger">*</span></label>
              <input
                id="wfChangeType"
                type="text"
                className="form-control"
                placeholder={t('admin.approvalWorkflows.modal.changeTypePlaceholder')}
                value={changeType}
                onChange={(e) => setChangeType(e.target.value)}
                disabled={mode === 'edit'}
              />
              <div className="form-text">{t('admin.approvalWorkflows.modal.changeTypeHelp')}</div>
            </div>
            <div className="mb-3">
              <label htmlFor="wfDescription" className="form-label">{t('admin.approvalWorkflows.modal.descriptionLabel')}</label>
              <input
                id="wfDescription"
                type="text"
                className="form-control"
                placeholder={t('admin.approvalWorkflows.modal.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="mb-3 form-check">
              <input
                type="checkbox"
                className="form-check-input"
                id="wfRequireAll"
                checked={requireAll}
                onChange={(e) => setRequireAll(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="wfRequireAll">
                {t('admin.approvalWorkflows.modal.requireAllLabel')}
              </label>
            </div>

            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="mb-0">{t('admin.approvalWorkflows.modal.approvalStepsHeading')}</h6>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={addStep}>
                <i className="bi bi-plus" aria-hidden="true"></i> {t('admin.approvalWorkflows.modal.addStep')}
              </button>
            </div>
            {steps.length === 0 && (
              <p className="text-muted small">{t('admin.approvalWorkflows.modal.noStepsYet')}</p>
            )}
            {steps.map((step, i) => (
              <div key={i} className="border rounded p-3 mb-2 bg-light position-relative" aria-label={t('admin.approvalWorkflows.modal.stepAriaLabel', { n: i + 1 })}>
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold small">{t('admin.approvalWorkflows.modal.stepLabel', { n: i + 1 })}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger py-0 px-1"
                    onClick={() => removeStep(i)}
                    disabled={steps.length <= 1}
                    aria-label={t('admin.approvalWorkflows.modal.removeStepAriaLabel', { n: i + 1 })}
                  >
                    <i className="bi bi-x" aria-hidden="true"></i>
                  </button>
                </div>
                <div className="row g-2">
                  <div className="col-md-4">
                    <label htmlFor={`stepScope-${i}`} className="form-label small">{t('admin.approvalWorkflows.modal.approverScope')}</label>
                    <select
                      id={`stepScope-${i}`}
                      className="form-select form-select-sm"
                      value={step.approverScope}
                      onChange={(e) => updateStep(i, { approverScope: e.target.value as ApproverScope })}
                    >
                      {SCOPE_KEYS.map((val) => (
                        <option key={val} value={val}>{t(SCOPE_LABEL_KEYS[val])}</option>
                      ))}
                    </select>
                  </div>
                  {step.approverScope === 'company_role' && (
                    <div className="col-md-4">
                      <label htmlFor={`stepRoleId-${i}`} className="form-label small">{t('admin.approvalWorkflows.modal.roleId')}</label>
                      <input
                        id={`stepRoleId-${i}`}
                        type="number"
                        className="form-control form-control-sm"
                        value={step.approverRoleId ?? ''}
                        onChange={(e) => updateStep(i, { approverRoleId: e.target.value ? Number(e.target.value) : null })}
                        min={1}
                        placeholder={t('admin.approvalWorkflows.modal.roleIdPlaceholder')}
                      />
                    </div>
                  )}
                  {step.approverScope === 'company_user' && (
                    <div className="col-md-4">
                      <label htmlFor={`stepUserId-${i}`} className="form-label small">{t('admin.approvalWorkflows.modal.userId')}</label>
                      <input
                        id={`stepUserId-${i}`}
                        type="number"
                        className="form-control form-control-sm"
                        value={step.approverUserId ?? ''}
                        onChange={(e) => updateStep(i, { approverUserId: e.target.value ? Number(e.target.value) : null })}
                        min={1}
                        placeholder={t('admin.approvalWorkflows.modal.userIdPlaceholder')}
                      />
                    </div>
                  )}
                  <div className="col-md-4">
                    <label htmlFor={`stepEscalate-${i}`} className="form-label small">{t('admin.approvalWorkflows.modal.escalateAfterHours')}</label>
                    <input
                      id={`stepEscalate-${i}`}
                      type="number"
                      className="form-control form-control-sm"
                      value={step.escalateAfterHours ?? ''}
                      onChange={(e) => updateStep(i, { escalateAfterHours: e.target.value ? Number(e.target.value) : null })}
                      min={1}
                      placeholder={t('admin.approvalWorkflows.modal.optionalPlaceholder')}
                    />
                  </div>
                  <div className="col-12">
                    <div className="form-check form-switch">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id={`stepAutoApprove-${i}`}
                        checked={step.autoApproveForOwner ?? false}
                        onChange={(e) => updateStep(i, { autoApproveForOwner: e.target.checked })}
                      />
                      <label className="form-check-label small" htmlFor={`stepAutoApprove-${i}`}>
                        {t('admin.approvalWorkflows.modal.autoApproveLabel')}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={saving}
              aria-label={mode === 'create' ? t('admin.approvalWorkflows.modal.createSaveAriaLabel') : t('admin.approvalWorkflows.modal.editSaveAriaLabel')}
            >
              {saving ? (
                <><ButtonSpinner />{t('admin.approvalWorkflows.modal.saving')}</>
              ) : (
                mode === 'create' ? t('admin.approvalWorkflows.modal.create') : t('admin.approvalWorkflows.modal.save')
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </div>
  );
};

export default WorkflowModal;
