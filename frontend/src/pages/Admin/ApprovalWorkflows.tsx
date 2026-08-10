/**
 * ApprovalWorkflows — Admin configuration page for multi-step approval workflows.
 *
 * Each workflow ties a change type (e.g. "TimeOff.Request") to an ordered list
 * of approver steps. Steps can delegate to a unit manager, the manager chain,
 * a specific company role, or a specific user.
 *
 * Requires `approval.manage` permission; the route is protected via PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApprovalWorkflow,
  ApprovalStep,
  ApproverScope,
  CreateWorkflowBody,
} from '../../services/approvalWorkflowService';
import { useApprovalWorkflowsQuery, useApprovalWorkflowMutations } from '../../hooks/useApprovalWorkflows';

const SCOPE_LABEL_KEYS: Record<ApproverScope, string> = {
  policy_owner: 'admin.approvalWorkflows.scopes.policyOwner',
  unit_manager: 'admin.approvalWorkflows.scopes.unitManager',
  unit_manager_chain: 'admin.approvalWorkflows.scopes.managerChain',
  company_role: 'admin.approvalWorkflows.scopes.companyRole',
  company_user: 'admin.approvalWorkflows.scopes.specificUser',
};

const SCOPE_KEYS = Object.keys(SCOPE_LABEL_KEYS) as ApproverScope[];

const EMPTY_STEP: ApprovalStep = {
  stepOrder: 1,
  approverScope: 'unit_manager',
  approverRoleId: null,
  approverUserId: null,
  autoApproveForOwner: false,
  escalateAfterHours: null,
};

const ApprovalWorkflows: React.FC = () => {
  const { t } = useTranslation();
  const [actionError, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state
  const [formChangeType, setFormChangeType] = useState('');
  const [formRequireAll, setFormRequireAll] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formSteps, setFormSteps] = useState<ApprovalStep[]>([{ ...EMPTY_STEP }]);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<ApprovalWorkflow | null>(null);

  // Expand state for viewing steps inline
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const workflowsQuery = useApprovalWorkflowsQuery();
  const workflows = workflowsQuery.data ?? [];
  const loading = workflowsQuery.isLoading;
  const { create, update, remove } = useApprovalWorkflowMutations();
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;
  const error = workflowsQuery.isError
    ? (workflowsQuery.error as Error).message ?? t('admin.approvalWorkflows.errors.loadFailed')
    : actionError;

  // ---------- Modal helpers ----------

  const openCreate = () => {
    setModalMode('create');
    setEditing(null);
    setFormChangeType('');
    setFormRequireAll(false);
    setFormDescription('');
    setFormSteps([{ ...EMPTY_STEP }]);
    setSaveError(null);
    setShowModal(true);
  };

  const openEdit = (w: ApprovalWorkflow) => {
    setModalMode('edit');
    setEditing(w);
    setFormChangeType(w.changeType);
    setFormRequireAll(w.requireAll);
    setFormDescription(w.description ?? '');
    setFormSteps(
      w.steps.length > 0
        ? w.steps.map((s) => ({ ...s }))
        : [{ ...EMPTY_STEP }]
    );
    setSaveError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formChangeType.trim()) {
      setSaveError(t('admin.approvalWorkflows.errors.changeTypeRequired'));
      return;
    }
    if (formSteps.length === 0) {
      setSaveError(t('admin.approvalWorkflows.errors.atLeastOneStep'));
      return;
    }
    setSaveError(null);
    const stepsPayload = formSteps.map((s, i) => ({
      stepOrder: i + 1,
      approverScope: s.approverScope,
      approverRoleId: s.approverRoleId ?? null,
      approverUserId: s.approverUserId ?? null,
      autoApproveForOwner: s.autoApproveForOwner ?? false,
      escalateAfterHours: s.escalateAfterHours ?? null,
    }));
    try {
      if (modalMode === 'create') {
        const body: CreateWorkflowBody = {
          changeType: formChangeType.trim(),
          requireAll: formRequireAll,
          description: formDescription.trim() || undefined,
          steps: stepsPayload,
        };
        await create.mutateAsync(body);
      } else if (editing) {
        await update.mutateAsync({
          id: editing.id,
          requireAll: formRequireAll,
          description: formDescription.trim() || undefined,
          steps: stepsPayload,
        });
      }
      setShowModal(false);
    } catch (e) {
      setSaveError((e as Error).message ?? t('admin.approvalWorkflows.errors.saveFailed'));
    }
  };

  // ---------- Step editor helpers ----------

  const addStep = () => {
    setFormSteps((prev) => [
      ...prev,
      { ...EMPTY_STEP, stepOrder: prev.length + 1 },
    ]);
  };

  const removeStep = (index: number) => {
    setFormSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, patch: Partial<ApprovalStep>) => {
    setFormSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  };

  // ---------- Delete ----------

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setError((e as Error).message ?? t('admin.approvalWorkflows.errors.deleteFailed'));
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('admin.approvalWorkflows.title')}</h1>
            <p className="text-muted mb-0 small">{t('admin.approvalWorkflows.subtitle')}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>{t('admin.approvalWorkflows.newWorkflow')}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <span className="spinner-border me-2" role="status" aria-label={t('admin.approvalWorkflows.loadingAriaLabel')}></span>
              <span>{t('common.loading')}</span>
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center text-muted py-5">
              {t('admin.approvalWorkflows.empty')}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">{t('admin.approvalWorkflows.columns.changeType')}</th>
                    <th scope="col">{t('admin.approvalWorkflows.columns.steps')}</th>
                    <th scope="col">{t('admin.approvalWorkflows.columns.requireAll')}</th>
                    <th scope="col">{t('admin.approvalWorkflows.columns.description')}</th>
                    <th scope="col" className="text-end">{t('admin.approvalWorkflows.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((w) => (
                    <React.Fragment key={w.id}>
                      <tr>
                        <td className="font-monospace small fw-semibold">{w.changeType}</td>
                        <td>
                          <button
                            className="btn btn-link btn-sm p-0 text-decoration-none"
                            onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                            aria-label={expandedId === w.id
                              ? t('admin.approvalWorkflows.collapseStepsAriaLabel', { changeType: w.changeType })
                              : t('admin.approvalWorkflows.showStepsAriaLabel', { changeType: w.changeType })}
                          >
                            {t(w.steps.length === 1 ? 'admin.approvalWorkflows.stepsCount_one' : 'admin.approvalWorkflows.stepsCount_other', { count: w.steps.length })}
                            <i
                              className={`bi ms-1 ${expandedId === w.id ? 'bi-chevron-up' : 'bi-chevron-down'}`}
                              aria-hidden="true"
                            ></i>
                          </button>
                        </td>
                        <td>
                          {w.requireAll ? (
                            <span className="badge bg-primary">{t('admin.approvalWorkflows.requireAll.all')}</span>
                          ) : (
                            <span className="badge bg-secondary">{t('admin.approvalWorkflows.requireAll.any')}</span>
                          )}
                        </td>
                        <td className="text-muted small">{w.description ?? t('common.emptyValue')}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-outline-secondary me-1"
                            onClick={() => openEdit(w)}
                            aria-label={t('admin.approvalWorkflows.editAriaLabel', { changeType: w.changeType })}
                          >
                            <i className="bi bi-pencil" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => setDeleteTarget(w)}
                            aria-label={t('admin.approvalWorkflows.deleteAriaLabel', { changeType: w.changeType })}
                          >
                            <i className="bi bi-trash" aria-hidden="true"></i>
                          </button>
                        </td>
                      </tr>
                      {expandedId === w.id && (
                        <tr>
                          <td colSpan={5} className="bg-light border-top-0">
                            <div className="p-3">
                              <h6 className="small fw-semibold text-uppercase text-muted mb-2">{t('admin.approvalWorkflows.stepsHeading')}</h6>
                              {w.steps.length === 0 ? (
                                <span className="text-muted small">{t('admin.approvalWorkflows.noStepsDefined')}</span>
                              ) : (
                                <ol className="mb-0 small">
                                  {w.steps.map((s) => (
                                    <li key={s.id}>
                                      <span className="badge bg-secondary me-2">{t(SCOPE_LABEL_KEYS[s.approverScope])}</span>
                                      {s.approverRoleId != null && <span className="me-2 text-muted">{t('admin.approvalWorkflows.rolePrefix', { id: s.approverRoleId })}</span>}
                                      {s.approverUserId != null && <span className="me-2 text-muted">{t('admin.approvalWorkflows.userPrefix', { id: s.approverUserId })}</span>}
                                      {s.autoApproveForOwner && <span className="badge bg-success me-2">{t('admin.approvalWorkflows.autoApproveBadge')}</span>}
                                      {s.escalateAfterHours != null && (
                                        <span className="text-muted">{t('admin.approvalWorkflows.escalateAfter', { hours: s.escalateAfterHours })}</span>
                                      )}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={modalMode === 'create' ? t('admin.approvalWorkflows.modal.createDialogAriaLabel') : t('admin.approvalWorkflows.modal.editDialogAriaLabel')}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {modalMode === 'create' ? t('admin.approvalWorkflows.modal.createTitle') : t('admin.approvalWorkflows.modal.editTitle', { changeType: editing?.changeType })}
                </h5>
                <button type="button" className="btn-close" aria-label={t('admin.approvalWorkflows.modal.closeDialogAriaLabel')} onClick={() => setShowModal(false)}></button>
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
                    value={formChangeType}
                    onChange={(e) => setFormChangeType(e.target.value)}
                    disabled={modalMode === 'edit'}
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
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>
                <div className="mb-3 form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="wfRequireAll"
                    checked={formRequireAll}
                    onChange={(e) => setFormRequireAll(e.target.checked)}
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
                {formSteps.length === 0 && (
                  <p className="text-muted small">{t('admin.approvalWorkflows.modal.noStepsYet')}</p>
                )}
                {formSteps.map((step, i) => (
                  <div key={i} className="border rounded p-3 mb-2 bg-light position-relative" aria-label={t('admin.approvalWorkflows.modal.stepAriaLabel', { n: i + 1 })}>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="fw-semibold small">{t('admin.approvalWorkflows.modal.stepLabel', { n: i + 1 })}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger py-0 px-1"
                        onClick={() => removeStep(i)}
                        disabled={formSteps.length <= 1}
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                  aria-label={modalMode === 'create' ? t('admin.approvalWorkflows.modal.createSaveAriaLabel') : t('admin.approvalWorkflows.modal.editSaveAriaLabel')}
                >
                  {saving ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.approvalWorkflows.modal.saving')}</>
                  ) : (
                    modalMode === 'create' ? t('admin.approvalWorkflows.modal.create') : t('admin.approvalWorkflows.modal.save')
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('admin.approvalWorkflows.deleteModal.title')}</h5>
                <button type="button" className="btn-close" aria-label={t('common.close')} onClick={() => setDeleteTarget(null)}></button>
              </div>
              <div className="modal-body">
                {t('admin.approvalWorkflows.deleteModal.confirmPrefix')} <strong>{deleteTarget.changeType}</strong>?
                <p className="mt-2 text-muted small">
                  {t('admin.approvalWorkflows.deleteModal.warning')}
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  aria-label={t('admin.approvalWorkflows.deleteModal.confirmAriaLabel', { changeType: deleteTarget.changeType })}
                >
                  {deleting ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.approvalWorkflows.deleteModal.deleting')}</>
                  ) : t('common.delete')}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}
    </div>
  );
};

export default ApprovalWorkflows;
