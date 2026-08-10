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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import * as responsibilitySvc from '../../services/responsibilityService';
import * as changeRequestSvc from '../../services/changeRequestService';
import type {
  ResponsibilityRule,
  CreateResponsibilityRuleInput,
  ResponsibilitySubjectType,
} from '../../services/responsibilityService';
import type {
  ChangeRequestStatus,
  CreateChangeRequestInput,
} from '../../services/changeRequestService';
import {
  governanceKeys,
  useResponsibilityRulesQuery,
  useChangeRequestsQuery,
} from '../../hooks/useGovernance';
import LoadingSpinner from '../../components/LoadingSpinner';

type Tab = 'matrix' | 'changeRequests';

const SUBJECT_TYPE_LABEL_KEYS: Record<ResponsibilitySubjectType, string> = {
  org_unit: 'governance.subjectTypes.orgUnit',
  department: 'governance.subjectTypes.department',
  role: 'governance.subjectTypes.role',
  all: 'governance.subjectTypes.all',
};

const STATUS_BADGE: Record<ChangeRequestStatus, string> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  applied: 'primary',
  cancelled: 'secondary',
};

// Kept as identifiers (not JSX literals) so the option `value`s stay the raw
// enum the backend expects while the visible label goes through `t()`.
const CR_STATUSES: ChangeRequestStatus[] = ['pending', 'approved', 'applied', 'rejected', 'cancelled'];

const CR_STATUS_LABEL_KEYS: Record<ChangeRequestStatus, string> = {
  pending: 'governance.changeRequests.status.pending',
  approved: 'governance.changeRequests.status.approved',
  applied: 'governance.changeRequests.status.applied',
  rejected: 'governance.changeRequests.status.rejected',
  cancelled: 'governance.changeRequests.status.cancelled',
};

const Governance: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManageMatrix = user?.permissions?.includes('responsibility.manage') ?? false;
  const canReadMatrix = user?.permissions?.includes('responsibility.read') ?? false;
  const canReview = user?.permissions?.includes('change_request.review') ?? false;
  const canCreate = user?.permissions?.includes('change_request.create') ?? false;

  const defaultTab: Tab = canReadMatrix ? 'matrix' : 'changeRequests';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  // ── Responsibility Matrix state ──────────────────────────────────────────

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<CreateResponsibilityRuleInput>({
    subjectType: 'department',
    permissionCode: '',
    responsibleOrgUnitId: 0,
  });

  // Rules load only when the matrix tab is open (and the user can read it);
  // mutation handlers call loadRules() which now invalidates the cached query.
  const rulesQuery = useResponsibilityRulesQuery(canReadMatrix && activeTab === 'matrix');
  const rules = rulesQuery.data ?? [];
  const matrixLoading = rulesQuery.isLoading;
  const loadRules = () => queryClient.invalidateQueries({ queryKey: governanceKeys.rules });

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
        setError((res as { error?: { message?: string } }).error?.message ?? t('governance.matrix.createFailed'));
      }
    } catch {
      setError(t('governance.matrix.createFailed'));
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
      setError(t('governance.matrix.updateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!window.confirm(t('governance.matrix.confirmDelete'))) return;
    setBusy(true);
    try {
      await responsibilitySvc.deleteResponsibilityRule(id);
      await loadRules();
    } catch {
      setError(t('governance.matrix.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  // ── Change Requests state ────────────────────────────────────────────────

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

  // Change requests load only on their tab; the query key includes the status
  // and my-only filters, so changing a filter refetches. Mutation handlers call
  // loadChangeRequests() which invalidates the whole change-request family.
  const crProposerId = myOnly && user?.id ? Number(user.id) : undefined;
  const crQuery = useChangeRequestsQuery(activeTab === 'changeRequests', crFilter, crProposerId);
  const changeRequests = crQuery.data?.items ?? [];
  const crTotal = crQuery.data?.total ?? 0;
  const crLoading = crQuery.isLoading;
  const loadChangeRequests = () =>
    queryClient.invalidateQueries({ queryKey: ['change-requests'] });

  const handleCreateCr = async (e: React.FormEvent) => {
    e.preventDefault();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(crPayloadText); } catch { setError(t('governance.changeRequests.invalidJson')); return; }
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
        setError((res as { error?: { message?: string } }).error?.message ?? t('governance.changeRequests.submitFailed'));
      }
    } catch {
      setError(t('governance.changeRequests.submitFailed'));
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
        if (!rejectReason.trim()) { setError(t('governance.changeRequests.rejectionReasonRequired')); setBusy(false); return; }
        await changeRequestSvc.rejectChangeRequest(actionTargetId, rejectReason);
      }
      setActionTargetId(null);
      setCrAction(null);
      setRejectReason('');
      await loadChangeRequests();
    } catch {
      setError(t('governance.changeRequests.actionFailed', { action: crAction }));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelCr = async (id: number) => {
    if (!window.confirm(t('governance.changeRequests.confirmCancel'))) return;
    setBusy(true);
    try {
      await changeRequestSvc.cancelChangeRequest(id);
      await loadChangeRequests();
    } catch {
      setError(t('governance.changeRequests.cancelFailed'));
    } finally {
      setBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="governance-page">
      <div className="page-header">
        <h1>{t('governance.title')}</h1>
        <p className="text-muted">{t('governance.subtitle')}</p>
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
              {t('governance.tabs.matrix')}
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
              {t('governance.tabs.changeRequests')}
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
            <h5 className="mb-0">{t('governance.matrix.activeRules')}</h5>
            {canManageMatrix && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowRuleForm(!showRuleForm)}>
                <i className="bi bi-plus-lg me-1" />
                {t('governance.matrix.addRule')}
              </button>
            )}
          </div>

          {showRuleForm && canManageMatrix && (
            <div className="card mb-4">
              <div className="card-body">
                <h6 className="card-title">{t('governance.matrix.newRuleTitle')}</h6>
                <form onSubmit={handleCreateRule}>
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label">{t('governance.matrix.form.subjectType')}</label>
                      <select
                        className="form-select"
                        value={ruleForm.subjectType}
                        onChange={e => setRuleForm(f => ({ ...f, subjectType: e.target.value as ResponsibilitySubjectType, subjectId: undefined }))}
                      >
                        {(Object.keys(SUBJECT_TYPE_LABEL_KEYS) as ResponsibilitySubjectType[]).map((v) => (
                          <option key={v} value={v}>{t(SUBJECT_TYPE_LABEL_KEYS[v])}</option>
                        ))}
                      </select>
                    </div>
                    {ruleForm.subjectType !== 'all' && (
                      <div className="col-md-2">
                        <label className="form-label">{t('governance.matrix.form.subjectId')}</label>
                        <input
                          type="number"
                          className="form-control"
                          placeholder={t('governance.matrix.form.subjectIdPlaceholder')}
                          value={ruleForm.subjectId ?? ''}
                          onChange={e => setRuleForm(f => ({ ...f, subjectId: e.target.value ? Number(e.target.value) : undefined }))}
                        />
                      </div>
                    )}
                    <div className="col-md-3">
                      <label className="form-label">{t('governance.matrix.form.permissionCode')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('governance.matrix.form.permissionCodePlaceholder')}
                        value={ruleForm.permissionCode}
                        onChange={e => setRuleForm(f => ({ ...f, permissionCode: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">{t('governance.matrix.form.responsibleOrgUnitId')}</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder={t('governance.matrix.form.responsibleOrgUnitIdPlaceholder')}
                        value={ruleForm.responsibleOrgUnitId || ''}
                        onChange={e => setRuleForm(f => ({ ...f, responsibleOrgUnitId: Number(e.target.value) }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">{t('governance.matrix.form.description')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('governance.matrix.form.descriptionPlaceholder')}
                        value={ruleForm.description ?? ''}
                        onChange={e => setRuleForm(f => ({ ...f, description: e.target.value || null }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      {busy ? t('governance.matrix.saving') : t('governance.matrix.saveRule')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowRuleForm(false)}>
                      {t('common.cancel')}
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
                    <th>{t('governance.matrix.columns.subjectType')}</th>
                    <th>{t('governance.matrix.columns.subjectId')}</th>
                    <th>{t('governance.matrix.columns.permission')}</th>
                    <th>{t('governance.matrix.columns.responsibleOrgUnit')}</th>
                    <th>{t('governance.matrix.columns.description')}</th>
                    <th>{t('governance.matrix.columns.status')}</th>
                    {canManageMatrix && <th>{t('governance.matrix.columns.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 && (
                    <tr><td colSpan={canManageMatrix ? 7 : 6} className="text-center text-muted py-4">{t('governance.matrix.noRules')}</td></tr>
                  )}
                  {rules.map(rule => (
                    <tr key={rule.id}>
                      <td><span className="badge bg-secondary">{t(SUBJECT_TYPE_LABEL_KEYS[rule.subjectType])}</span></td>
                      <td>{rule.subjectId ?? <em className="text-muted">{t('common.emptyValue')}</em>}</td>
                      <td><code>{rule.permissionCode}</code></td>
                      <td>{rule.responsibleOrgUnitId}</td>
                      <td>{rule.description ?? <em className="text-muted">{t('common.emptyValue')}</em>}</td>
                      <td>
                        <span className={`badge ${rule.isActive ? 'bg-success' : 'bg-secondary'}`}>
                          {rule.isActive ? t('governance.matrix.status.active') : t('governance.matrix.status.inactive')}
                        </span>
                      </td>
                      {canManageMatrix && (
                        <td>
                          <button
                            className="btn btn-sm btn-outline-secondary me-1"
                            onClick={() => handleToggleRule(rule)}
                            disabled={busy}
                            title={rule.isActive ? t('governance.matrix.deactivate') : t('governance.matrix.activate')}
                          >
                            <i className={`bi ${rule.isActive ? 'bi-toggle-on' : 'bi-toggle-off'}`} />
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteRule(rule.id)}
                            disabled={busy}
                            title={t('common.delete')}
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
                <option value="">{t('governance.changeRequests.allStatuses')}</option>
                {CR_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(CR_STATUS_LABEL_KEYS[status])}</option>
                ))}
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
                  <label className="form-check-label" htmlFor="myOnly">{t('governance.changeRequests.myRequestsOnly')}</label>
                </div>
              )}
            </div>
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCrForm(!showCrForm)}>
                <i className="bi bi-plus-lg me-1" />
                {t('governance.changeRequests.newRequest')}
              </button>
            )}
          </div>

          {showCrForm && canCreate && (
            <div className="card mb-4">
              <div className="card-body">
                <h6 className="card-title">{t('governance.changeRequests.proposeTitle')}</h6>
                <form onSubmit={handleCreateCr}>
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label">{t('governance.changeRequests.form.changeType')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('governance.changeRequests.form.changeTypePlaceholder')}
                        value={crForm.changeType}
                        onChange={e => setCrForm(f => ({ ...f, changeType: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">{t('governance.changeRequests.form.targetEntityType')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('governance.changeRequests.form.targetEntityTypePlaceholder')}
                        value={crForm.targetEntityType}
                        onChange={e => setCrForm(f => ({ ...f, targetEntityType: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label">{t('governance.changeRequests.form.targetEntityId')}</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder={t('governance.changeRequests.form.optional')}
                        value={crForm.targetEntityId ?? ''}
                        onChange={e => setCrForm(f => ({ ...f, targetEntityId: e.target.value ? Number(e.target.value) : null }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">{t('governance.changeRequests.form.justification')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('governance.changeRequests.form.justificationPlaceholder')}
                        value={crForm.justification ?? ''}
                        onChange={e => setCrForm(f => ({ ...f, justification: e.target.value || null }))}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{t('governance.changeRequests.form.proposedPayload')}</label>
                      <textarea
                        className="form-control font-monospace"
                        rows={4}
                        value={crPayloadText}
                        onChange={e => setCrPayloadText(e.target.value)}
                      />
                      <small className="text-muted">{t('governance.changeRequests.form.payloadHint')}</small>
                    </div>
                  </div>
                  <div className="mt-3 d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                      {busy ? t('governance.changeRequests.submitting') : t('governance.changeRequests.submitRequest')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowCrForm(false); setError(null); }}>
                      {t('common.cancel')}
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
                    <h5 className="modal-title">{t('governance.changeRequests.rejectModalTitle', { id: actionTargetId })}</h5>
                    <button className="btn-close" onClick={() => { setCrAction(null); setActionTargetId(null); }} />
                  </div>
                  <div className="modal-body">
                    <label className="form-label">{t('governance.changeRequests.rejectionReason')} <span className="text-danger">*</span></label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder={t('governance.changeRequests.rejectionReasonPlaceholder')}
                    />
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={() => { setCrAction(null); setActionTargetId(null); setRejectReason(''); }}>{t('common.cancel')}</button>
                    <button className="btn btn-danger" onClick={handleCrAction} disabled={busy || !rejectReason.trim()}>
                      {busy ? t('governance.changeRequests.rejecting') : t('governance.changeRequests.reject')}
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
                    <th>{t('governance.changeRequests.columns.id')}</th>
                    <th>{t('governance.changeRequests.columns.type')}</th>
                    <th>{t('governance.changeRequests.columns.target')}</th>
                    <th>{t('governance.changeRequests.columns.proposer')}</th>
                    <th>{t('governance.changeRequests.columns.justification')}</th>
                    <th>{t('governance.changeRequests.columns.status')}</th>
                    <th>{t('governance.changeRequests.columns.submitted')}</th>
                    {(canReview || canCreate) && <th>{t('governance.changeRequests.columns.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {changeRequests.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted py-4">{t('governance.changeRequests.noneFound')}</td></tr>
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
                          ? <span title={cr.justification}>{cr.justification.length > 40 ? `${cr.justification.slice(0, 40)}${t('common.ellipsis')}` : cr.justification}</span>
                          : <em className="text-muted">{t('common.emptyValue')}</em>
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
                                title={t('governance.changeRequests.approve')}
                              >
                                <i className="bi bi-check-lg" />
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger me-1"
                                onClick={() => { setActionTargetId(cr.id); setCrAction('reject'); }}
                                disabled={busy}
                                title={t('governance.changeRequests.reject')}
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
                              title={t('governance.changeRequests.apply')}
                            >
                              <i className="bi bi-lightning" />
                            </button>
                          )}
                          {cr.status === 'pending' && (cr.proposerUserId === Number(user?.id) || canReview) && (
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => handleCancelCr(cr.id)}
                              disabled={busy}
                              title={t('governance.changeRequests.cancel')}
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
                <p className="text-muted text-center small">
                  {t('governance.changeRequests.showingCount', { shown: changeRequests.length, total: crTotal })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Governance;
