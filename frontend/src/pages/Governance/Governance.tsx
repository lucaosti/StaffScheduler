/**
 * Governance page.
 *
 * Two tabs:
 *   - Responsibility Matrix: configure who is responsible for what over
 *     which subject group.  Visible to users with `responsibility.read`;
 *     editable by users with `responsibility.manage`.
 *   - Change Requests: list, review and act on subordinate change proposals.
 *     Visible to reviewers (`change_request.review`) and to all authenticated
 *     users who have submitted a request (they can see their own via the
 *     dedicated "My requests" filter).
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import * as responsibilitySvc from '../../services/responsibilityService';
import * as changeRequestSvc from '../../services/changeRequestService';
import type {
  ResponsibilityRule,
  CreateResponsibilityRuleInput,
  ResponsibilitySubjectType,
} from '../../services/responsibilityService';
import type {
  ChangeRequest,
  ChangeRequestStatus,
  CreateChangeRequestInput,
} from '../../services/changeRequestService';
import LoadingSpinner from '../../components/LoadingSpinner';

type Tab = 'matrix' | 'changeRequests';

const SUBJECT_TYPE_LABELS: Record<ResponsibilitySubjectType, string> = {
  org_unit: 'Org Unit',
  department: 'Department',
  role: 'Role',
  all: 'All Users',
};

const STATUS_BADGE: Record<ChangeRequestStatus, string> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  applied: 'primary',
  cancelled: 'secondary',
};

const Governance: React.FC = () => {
  const { user } = useAuth();
  const canManageMatrix = user?.permissions?.includes('responsibility.manage') ?? false;
  const canReadMatrix = user?.permissions?.includes('responsibility.read') ?? false;
  const canReview = user?.permissions?.includes('change_request.review') ?? false;
  const canCreate = user?.permissions?.includes('change_request.create') ?? false;

  const defaultTab: Tab = canReadMatrix ? 'matrix' : 'changeRequests';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Responsibility Matrix state ──────────────────────────────────────────

  const [rules, setRules] = useState<ResponsibilityRule[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<CreateResponsibilityRuleInput>({
    subjectType: 'department',
    permissionCode: '',
    responsibleOrgUnitId: 0,
  });

  const loadRules = useCallback(async () => {
    if (!canReadMatrix) return;
    setMatrixLoading(true);
    try {
      const res = await responsibilitySvc.listResponsibilityRules({ isActive: true });
      if (res.success) setRules(res.data as ResponsibilityRule[]);
    } catch {
      setError('Failed to load responsibility rules');
    } finally {
      setMatrixLoading(false);
    }
  }, [canReadMatrix]);

  useEffect(() => {
    if (activeTab === 'matrix') loadRules();
  }, [activeTab, loadRules]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleForm.permissionCode || !ruleForm.responsibleOrgUnitId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await responsibilitySvc.createResponsibilityRule(ruleForm);
      if (res.success) {
        setShowRuleForm(false);
        setRuleForm({ subjectType: 'department', permissionCode: '', responsibleOrgUnitId: 0 });
        await loadRules();
      } else {
        setError((res as { error?: { message?: string } }).error?.message ?? 'Failed to create rule');
      }
    } catch {
      setError('Failed to create responsibility rule');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRule = async (rule: ResponsibilityRule) => {
    setBusy(true);
    try {
      await responsibilitySvc.updateResponsibilityRule(rule.id, { isActive: !rule.isActive });
      await loadRules();
    } catch {
      setError('Failed to update rule');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!window.confirm('Delete this responsibility rule?')) return;
    setBusy(true);
    try {
      await responsibilitySvc.deleteResponsibilityRule(id);
      await loadRules();
    } catch {
      setError('Failed to delete rule');
    } finally {
      setBusy(false);
    }
  };

  // ── Change Requests state ────────────────────────────────────────────────

  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [crTotal, setCrTotal] = useState(0);
  const [crLoading, setCrLoading] = useState(false);
  const [crFilter, setCrFilter] = useState<ChangeRequestStatus | ''>('');
  const [myOnly, setMyOnly] = useState(!canReview);
  const [showCrForm, setShowCrForm] = useState(false);
  const [crForm, setCrForm] = useState<CreateChangeRequestInput>({
    changeType: '',
    targetEntityType: '',
    proposedPayload: {},
    justification: '',
  });
  const [crPayloadText, setCrPayloadText] = useState('{}');
  const [rejectReason, setRejectReason] = useState('');
  const [actionTargetId, setActionTargetId] = useState<number | null>(null);
  const [crAction, setCrAction] = useState<'approve' | 'reject' | 'apply' | null>(null);

  const loadChangeRequests = useCallback(async () => {
    setCrLoading(true);
    try {
      const filters: Parameters<typeof changeRequestSvc.listChangeRequests>[0] = {};
      if (crFilter) filters.status = crFilter;
      if (myOnly && user?.id) filters.proposerUserId = Number(user.id);
      const res = await changeRequestSvc.listChangeRequests(filters);
      if (res.success && res.data) {
        const page = res.data as { total: number; items: ChangeRequest[] };
        setChangeRequests(page.items);
        setCrTotal(page.total);
      }
    } catch {
      setError('Failed to load change requests');
    } finally {
      setCrLoading(false);
    }
  }, [crFilter, myOnly, user?.id]);

  useEffect(() => {
    if (activeTab === 'changeRequests') loadChangeRequests();
  }, [activeTab, loadChangeRequests]);

  const handleCreateCr = async (e: React.FormEvent) => {
    e.preventDefault();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(crPayloadText); } catch { setError('Proposed payload must be valid JSON'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await changeRequestSvc.createChangeRequest({ ...crForm, proposedPayload: payload });
      if (res.success) {
        setShowCrForm(false);
        setCrForm({ changeType: '', targetEntityType: '', proposedPayload: {}, justification: '' });
        setCrPayloadText('{}');
        await loadChangeRequests();
      } else {
        setError((res as { error?: { message?: string } }).error?.message ?? 'Failed to submit');
      }
    } catch {
      setError('Failed to submit change request');
    } finally {
      setBusy(false);
    }
  };

  const handleCrAction = async () => {
    if (actionTargetId === null || crAction === null) return;
    setBusy(true);
    setError(null);
    try {
      if (crAction === 'approve') await changeRequestSvc.approveChangeRequest(actionTargetId);
      else if (crAction === 'apply') await changeRequestSvc.applyChangeRequest(actionTargetId);
      else if (crAction === 'reject') {
        if (!rejectReason.trim()) { setError('Rejection reason is required'); setBusy(false); return; }
        await changeRequestSvc.rejectChangeRequest(actionTargetId, rejectReason);
      }
      setActionTargetId(null);
      setCrAction(null);
      setRejectReason('');
      await loadChangeRequests();
    } catch {
      setError(`Failed to ${crAction} change request`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelCr = async (id: number) => {
    if (!window.confirm('Cancel this change request?')) return;
    setBusy(true);
    try {
      await changeRequestSvc.cancelChangeRequest(id);
      await loadChangeRequests();
    } catch {
      setError('Failed to cancel change request');
    } finally {
      setBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="governance-page">
      <div className="page-header">
        <h1>Governance</h1>
        <p className="text-muted">Responsibility matrix and change request management</p>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible">
          {error}
          <button className="btn-close" onClick={() => setError(null)} />
        </div>
      )}

      <ul className="nav nav-tabs mb-4">
        {canReadMatrix && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              <i className="bi bi-table me-2" />
              Responsibility Matrix
            </button>
          </li>
        )}
        {(canReview || canCreate) && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'changeRequests' ? 'active' : ''}`}
              onClick={() => setActiveTab('changeRequests')}
            >
              <i className="bi bi-pencil-square me-2" />
              Change Requests
              {crTotal > 0 && crFilter === 'pending' && (
                <span className="badge bg-warning text-dark ms-2">{crTotal}</span>
              )}
            </button>
          </li>
        )}
      </ul>

      {/* ── RESPONSIBILITY MATRIX TAB ─────────────────────────────────── */}
      {activeTab === 'matrix' && canReadMatrix && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">Active Rules</h5>
            {canManageMatrix && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowRuleForm(!showRuleForm)}>
                <i className="bi bi-plus-lg me-1" />
                Add Rule
              </button>
            )}
          </div>

          {showRuleForm && canManageMatrix && (
            <div className="card mb-4">
              <div className="card-body">
                <h6 className="card-title">New Responsibility Rule</h6>
                <form onSubmit={handleCreateRule}>
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label">Subject Type</label>
                      <select
                        className="form-select"
                        value={ruleForm.subjectType}
                        onChange={e => setRuleForm(f => ({ ...f, subjectType: e.target.value as ResponsibilitySubjectType, subjectId: undefined }))}
                      >
                        {Object.entries(SUBJECT_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                    {ruleForm.subjectType !== 'all' && (
                      <div className="col-md-2">
                        <label className="form-label">Subject ID</label>
                        <input
                          type="number"
                          className="form-control"
                          placeholder="e.g. 5"
                          value={ruleForm.subjectId ?? ''}
                          onChange={e => setRuleForm(f => ({ ...f, subjectId: e.target.value ? Number(e.target.value) : undefined }))}
                        />
                      </div>
                    )}
                    <div className="col-md-3">
                      <label className="form-label">Permission Code</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. schedule.manage"
                        value={ruleForm.permissionCode}
                        onChange={e => setRuleForm(f => ({ ...f, permissionCode: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Responsible Org Unit ID</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="e.g. 3"
                        value={ruleForm.responsibleOrgUnitId || ''}
                        onChange={e => setRuleForm(f => ({ ...f, responsibleOrgUnitId: Number(e.target.value) }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Description</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Optional"
                        value={ruleForm.description ?? ''}
                        onChange={e => setRuleForm(f => ({ ...f, description: e.target.value || null }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      {busy ? 'Saving…' : 'Save Rule'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowRuleForm(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {matrixLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Subject Type</th>
                    <th>Subject ID</th>
                    <th>Permission</th>
                    <th>Responsible Org Unit</th>
                    <th>Description</th>
                    <th>Status</th>
                    {canManageMatrix && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 && (
                    <tr><td colSpan={canManageMatrix ? 7 : 6} className="text-center text-muted py-4">No rules defined</td></tr>
                  )}
                  {rules.map(rule => (
                    <tr key={rule.id}>
                      <td><span className="badge bg-secondary">{SUBJECT_TYPE_LABELS[rule.subjectType]}</span></td>
                      <td>{rule.subjectId ?? <em className="text-muted">—</em>}</td>
                      <td><code>{rule.permissionCode}</code></td>
                      <td>{rule.responsibleOrgUnitId}</td>
                      <td>{rule.description ?? <em className="text-muted">—</em>}</td>
                      <td>
                        <span className={`badge ${rule.isActive ? 'bg-success' : 'bg-secondary'}`}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {canManageMatrix && (
                        <td>
                          <button
                            className="btn btn-sm btn-outline-secondary me-1"
                            onClick={() => handleToggleRule(rule)}
                            disabled={busy}
                            title={rule.isActive ? 'Deactivate' : 'Activate'}
                          >
                            <i className={`bi ${rule.isActive ? 'bi-toggle-on' : 'bi-toggle-off'}`} />
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteRule(rule.id)}
                            disabled={busy}
                            title="Delete"
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── CHANGE REQUESTS TAB ──────────────────────────────────────────── */}
      {activeTab === 'changeRequests' && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <select
                className="form-select form-select-sm"
                style={{ width: 'auto' }}
                value={crFilter}
                onChange={e => setCrFilter(e.target.value as ChangeRequestStatus | '')}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="applied">Applied</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {canReview && (
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="myOnly"
                    checked={myOnly}
                    onChange={e => setMyOnly(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="myOnly">My requests only</label>
                </div>
              )}
            </div>
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCrForm(!showCrForm)}>
                <i className="bi bi-plus-lg me-1" />
                New Request
              </button>
            )}
          </div>

          {showCrForm && canCreate && (
            <div className="card mb-4">
              <div className="card-body">
                <h6 className="card-title">Propose a Change</h6>
                <form onSubmit={handleCreateCr}>
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label">Change Type</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Schedule.Override"
                        value={crForm.changeType}
                        onChange={e => setCrForm(f => ({ ...f, changeType: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Target Entity Type</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. schedule"
                        value={crForm.targetEntityType}
                        onChange={e => setCrForm(f => ({ ...f, targetEntityType: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">Target Entity ID</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="Optional"
                        value={crForm.targetEntityId ?? ''}
                        onChange={e => setCrForm(f => ({ ...f, targetEntityId: e.target.value ? Number(e.target.value) : null }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Justification</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Why is this change needed?"
                        value={crForm.justification ?? ''}
                        onChange={e => setCrForm(f => ({ ...f, justification: e.target.value || null }))}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Proposed Payload (JSON)</label>
                      <textarea
                        className="form-control font-monospace"
                        rows={4}
                        value={crPayloadText}
                        onChange={e => setCrPayloadText(e.target.value)}
                      />
                      <small className="text-muted">Must be valid JSON describing the proposed change.</small>
                    </div>
                  </div>
                  <div className="mt-3 d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit Request'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowCrForm(false); setError(null); }}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Reject modal */}
          {crAction === 'reject' && actionTargetId !== null && (
            <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
              <div className="modal-dialog">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title">Reject Change Request #{actionTargetId}</h5>
                    <button className="btn-close" onClick={() => { setCrAction(null); setActionTargetId(null); }} />
                  </div>
                  <div className="modal-body">
                    <label className="form-label">Rejection reason <span className="text-danger">*</span></label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Explain why this request is being rejected…"
                    />
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={() => { setCrAction(null); setActionTargetId(null); setRejectReason(''); }}>Cancel</button>
                    <button className="btn btn-danger" onClick={handleCrAction} disabled={busy || !rejectReason.trim()}>
                      {busy ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {crLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Proposer</th>
                    <th>Justification</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    {(canReview || canCreate) && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {changeRequests.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted py-4">No change requests found</td></tr>
                  )}
                  {changeRequests.map(cr => (
                    <tr key={cr.id}>
                      <td>{cr.id}</td>
                      <td><code>{cr.changeType}</code></td>
                      <td>
                        {cr.targetEntityType}
                        {cr.targetEntityId !== null && <span className="text-muted"> #{cr.targetEntityId}</span>}
                      </td>
                      <td>{cr.proposerUserId}</td>
                      <td>
                        {cr.justification
                          ? <span title={cr.justification}>{cr.justification.length > 40 ? `${cr.justification.slice(0, 40)}…` : cr.justification}</span>
                          : <em className="text-muted">—</em>
                        }
                      </td>
                      <td>
                        <span className={`badge bg-${STATUS_BADGE[cr.status]}`}>{cr.status}</span>
                        {cr.rejectionReason && (
                          <small className="d-block text-muted">{cr.rejectionReason}</small>
                        )}
                      </td>
                      <td><small>{new Date(cr.createdAt).toLocaleDateString()}</small></td>
                      {(canReview || canCreate) && (
                        <td>
                          {canReview && cr.status === 'pending' && (
                            <>
                              <button
                                className="btn btn-sm btn-outline-success me-1"
                                onClick={() => { setActionTargetId(cr.id); setCrAction('approve'); handleCrAction(); }}
                                disabled={busy}
                                title="Approve"
                              >
                                <i className="bi bi-check-lg" />
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger me-1"
                                onClick={() => { setActionTargetId(cr.id); setCrAction('reject'); }}
                                disabled={busy}
                                title="Reject"
                              >
                                <i className="bi bi-x-lg" />
                              </button>
                            </>
                          )}
                          {canReview && cr.status === 'approved' && (
                            <button
                              className="btn btn-sm btn-outline-primary me-1"
                              onClick={() => { setActionTargetId(cr.id); setCrAction('apply'); handleCrAction(); }}
                              disabled={busy}
                              title="Apply"
                            >
                              <i className="bi bi-lightning" />
                            </button>
                          )}
                          {cr.status === 'pending' && (cr.proposerUserId === Number(user?.id) || canReview) && (
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => handleCancelCr(cr.id)}
                              disabled={busy}
                              title="Cancel"
                            >
                              <i className="bi bi-slash-circle" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {crTotal > changeRequests.length && (
                <p className="text-muted text-center small">Showing {changeRequests.length} of {crTotal} requests</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Governance;
