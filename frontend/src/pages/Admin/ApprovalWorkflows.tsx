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

import React, { useEffect, useState, useCallback } from 'react';
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  ApprovalWorkflow,
  ApprovalStep,
  ApproverScope,
  CreateWorkflowBody,
} from '../../services/approvalWorkflowService';

const SCOPE_LABELS: Record<ApproverScope, string> = {
  policy_owner: 'Policy Owner',
  unit_manager: 'Unit Manager',
  unit_manager_chain: 'Manager Chain',
  company_role: 'Company Role',
  company_user: 'Specific User',
};

const SCOPE_OPTIONS = Object.entries(SCOPE_LABELS) as [ApproverScope, string][];

const EMPTY_STEP: ApprovalStep = {
  stepOrder: 1,
  approverScope: 'unit_manager',
  approverRoleId: null,
  approverUserId: null,
  autoApproveForOwner: false,
  escalateAfterHours: null,
};

const ApprovalWorkflows: React.FC = () => {
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state
  const [formChangeType, setFormChangeType] = useState('');
  const [formRequireAll, setFormRequireAll] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formSteps, setFormSteps] = useState<ApprovalStep[]>([{ ...EMPTY_STEP }]);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<ApprovalWorkflow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Expand state for viewing steps inline
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listWorkflows();
      setWorkflows(res.data ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load workflows.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      setSaveError('Change type is required.');
      return;
    }
    if (formSteps.length === 0) {
      setSaveError('At least one step is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const stepsPayload = formSteps.map((s, i) => ({
        stepOrder: i + 1,
        approverScope: s.approverScope,
        approverRoleId: s.approverRoleId ?? null,
        approverUserId: s.approverUserId ?? null,
        autoApproveForOwner: s.autoApproveForOwner ?? false,
        escalateAfterHours: s.escalateAfterHours ?? null,
      }));
      if (modalMode === 'create') {
        const body: CreateWorkflowBody = {
          changeType: formChangeType.trim(),
          requireAll: formRequireAll,
          description: formDescription.trim() || undefined,
          steps: stepsPayload,
        };
        await createWorkflow(body);
      } else if (editing) {
        await updateWorkflow(editing.id, {
          requireAll: formRequireAll,
          description: formDescription.trim() || undefined,
          steps: stepsPayload,
        });
      }
      setShowModal(false);
      await load();
    } catch (e) {
      setSaveError((e as Error).message ?? 'Failed to save workflow.');
    } finally {
      setSaving(false);
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
    setDeleting(true);
    try {
      await deleteWorkflow(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to delete workflow.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Approval Workflows</h1>
            <p className="text-muted mb-0 small">Configure multi-step approval chains per change type</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>New Workflow
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
              <span className="spinner-border me-2" role="status" aria-label="Loading workflows"></span>
              <span>Loading…</span>
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center text-muted py-5">
              No approval workflows configured yet.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Change Type</th>
                    <th scope="col">Steps</th>
                    <th scope="col">Require All</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="text-end">Actions</th>
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
                            aria-label={expandedId === w.id ? `Collapse steps for ${w.changeType}` : `Show steps for ${w.changeType}`}
                          >
                            {w.steps.length} step{w.steps.length !== 1 ? 's' : ''}
                            <i
                              className={`bi ms-1 ${expandedId === w.id ? 'bi-chevron-up' : 'bi-chevron-down'}`}
                              aria-hidden="true"
                            ></i>
                          </button>
                        </td>
                        <td>
                          {w.requireAll ? (
                            <span className="badge bg-primary">All</span>
                          ) : (
                            <span className="badge bg-secondary">Any</span>
                          )}
                        </td>
                        <td className="text-muted small">{w.description ?? '—'}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-outline-secondary me-1"
                            onClick={() => openEdit(w)}
                            aria-label={`Edit workflow ${w.changeType}`}
                          >
                            <i className="bi bi-pencil" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => setDeleteTarget(w)}
                            aria-label={`Delete workflow ${w.changeType}`}
                          >
                            <i className="bi bi-trash" aria-hidden="true"></i>
                          </button>
                        </td>
                      </tr>
                      {expandedId === w.id && (
                        <tr>
                          <td colSpan={5} className="bg-light border-top-0">
                            <div className="p-3">
                              <h6 className="small fw-semibold text-uppercase text-muted mb-2">Steps</h6>
                              {w.steps.length === 0 ? (
                                <span className="text-muted small">No steps defined.</span>
                              ) : (
                                <ol className="mb-0 small">
                                  {w.steps.map((s) => (
                                    <li key={s.id}>
                                      <span className="badge bg-secondary me-2">{SCOPE_LABELS[s.approverScope]}</span>
                                      {s.approverRoleId != null && <span className="me-2 text-muted">role: {s.approverRoleId}</span>}
                                      {s.approverUserId != null && <span className="me-2 text-muted">user: {s.approverUserId}</span>}
                                      {s.autoApproveForOwner && <span className="badge bg-success me-2">auto-approve</span>}
                                      {s.escalateAfterHours != null && (
                                        <span className="text-muted">escalate after {s.escalateAfterHours}h</span>
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
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={modalMode === 'create' ? 'Create workflow' : 'Edit workflow'}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {modalMode === 'create' ? 'New Approval Workflow' : `Edit Workflow: ${editing?.changeType}`}
                </h5>
                <button type="button" className="btn-close" aria-label="Close dialog" onClick={() => setShowModal(false)}></button>
              </div>
              <div className="modal-body">
                {saveError && (
                  <div className="alert alert-danger py-2 small" role="alert">{saveError}</div>
                )}
                <div className="mb-3">
                  <label htmlFor="wfChangeType" className="form-label">Change Type <span className="text-danger">*</span></label>
                  <input
                    id="wfChangeType"
                    type="text"
                    className="form-control"
                    placeholder="e.g. TimeOff.Request"
                    value={formChangeType}
                    onChange={(e) => setFormChangeType(e.target.value)}
                    disabled={modalMode === 'edit'}
                  />
                  <div className="form-text">Unique identifier for the change type this workflow governs.</div>
                </div>
                <div className="mb-3">
                  <label htmlFor="wfDescription" className="form-label">Description</label>
                  <input
                    id="wfDescription"
                    type="text"
                    className="form-control"
                    placeholder="Optional description"
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
                    Require all approvers (parallel approval; otherwise any single approver suffices)
                  </label>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <h6 className="mb-0">Approval Steps</h6>
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={addStep}>
                    <i className="bi bi-plus" aria-hidden="true"></i> Add Step
                  </button>
                </div>
                {formSteps.length === 0 && (
                  <p className="text-muted small">No steps yet. Add at least one step.</p>
                )}
                {formSteps.map((step, i) => (
                  <div key={i} className="border rounded p-3 mb-2 bg-light position-relative" aria-label={`Step ${i + 1}`}>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="fw-semibold small">Step {i + 1}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger py-0 px-1"
                        onClick={() => removeStep(i)}
                        disabled={formSteps.length <= 1}
                        aria-label={`Remove step ${i + 1}`}
                      >
                        <i className="bi bi-x" aria-hidden="true"></i>
                      </button>
                    </div>
                    <div className="row g-2">
                      <div className="col-md-4">
                        <label htmlFor={`stepScope-${i}`} className="form-label small">Approver Scope</label>
                        <select
                          id={`stepScope-${i}`}
                          className="form-select form-select-sm"
                          value={step.approverScope}
                          onChange={(e) => updateStep(i, { approverScope: e.target.value as ApproverScope })}
                        >
                          {SCOPE_OPTIONS.map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>
                      {step.approverScope === 'company_role' && (
                        <div className="col-md-4">
                          <label htmlFor={`stepRoleId-${i}`} className="form-label small">Role ID</label>
                          <input
                            id={`stepRoleId-${i}`}
                            type="number"
                            className="form-control form-control-sm"
                            value={step.approverRoleId ?? ''}
                            onChange={(e) => updateStep(i, { approverRoleId: e.target.value ? Number(e.target.value) : null })}
                            min={1}
                            placeholder="Role ID"
                          />
                        </div>
                      )}
                      {step.approverScope === 'company_user' && (
                        <div className="col-md-4">
                          <label htmlFor={`stepUserId-${i}`} className="form-label small">User ID</label>
                          <input
                            id={`stepUserId-${i}`}
                            type="number"
                            className="form-control form-control-sm"
                            value={step.approverUserId ?? ''}
                            onChange={(e) => updateStep(i, { approverUserId: e.target.value ? Number(e.target.value) : null })}
                            min={1}
                            placeholder="User ID"
                          />
                        </div>
                      )}
                      <div className="col-md-4">
                        <label htmlFor={`stepEscalate-${i}`} className="form-label small">Escalate After (hours)</label>
                        <input
                          id={`stepEscalate-${i}`}
                          type="number"
                          className="form-control form-control-sm"
                          value={step.escalateAfterHours ?? ''}
                          onChange={(e) => updateStep(i, { escalateAfterHours: e.target.value ? Number(e.target.value) : null })}
                          min={1}
                          placeholder="Optional"
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
                            Auto-approve when the actor IS the approver (owner exception)
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                  aria-label={modalMode === 'create' ? 'Create workflow' : 'Save workflow'}
                >
                  {saving ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                  ) : (
                    modalMode === 'create' ? 'Create' : 'Save'
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
                <h5 className="modal-title">Delete Workflow</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setDeleteTarget(null)}></button>
              </div>
              <div className="modal-body">
                Delete workflow <strong>{deleteTarget.changeType}</strong>?
                <p className="mt-2 text-muted small">
                  This will also remove all its steps and cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  aria-label={`Confirm delete workflow ${deleteTarget.changeType}`}
                >
                  {deleting ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Deleting…</>
                  ) : 'Delete'}
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
