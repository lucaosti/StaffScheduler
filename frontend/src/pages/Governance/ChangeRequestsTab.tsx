/**
 * ChangeRequestsTab — list, review and act on subordinate change proposals.
 * Visible to reviewers (`change_request.review`) and to all authenticated
 * users who have submitted a request (they can see their own via the
 * dedicated "My requests" filter). See Governance.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import type {
  ChangeRequestStatus,
  CreateChangeRequestInput,
} from '../../services/changeRequestService';
import { useChangeRequestsQuery, useChangeRequestMutations } from '../../hooks/useGovernance';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import QueryState from '../../components/QueryState';

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

interface Props {
  canReview: boolean;
  canCreate: boolean;
  // Reports the total shown by the tab whenever its own filter is 'pending',
  // so the tab-nav badge (owned by Governance.tsx) reflects it without this
  // component reaching outside its own state.
  onPendingTotalChange: (total: number | null) => void;
}

const ChangeRequestsTab: React.FC<Props> = ({ canReview, canCreate, onPendingTotalChange }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, setMessage, run: act } = useActionFeedback();

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
  // The request the reject modal is open for; null means the modal is closed.
  // Approve/apply need no such staging — they act immediately, see below.
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);

  // Change requests load as soon as this tab mounts (Governance.tsx only
  // mounts it while the tab is open); the query key includes the status and
  // my-only filters, so changing a filter refetches. The mutations below
  // invalidate the whole change-request family on success, so every filtered
  // view (including a reviewer's queue and a proposer's own list) refreshes.
  const crProposerId = myOnly && user?.id ? Number(user.id) : undefined;
  const crQuery = useChangeRequestsQuery(true, crFilter, crProposerId);
  const changeRequests = crQuery.data?.items ?? [];
  const crTotal = crQuery.data?.total ?? 0;
  const {
    create: createCr,
    approve: approveCr,
    reject: rejectCr,
    apply: applyCr,
    cancel: cancelCr,
  } = useChangeRequestMutations();

  useEffect(() => {
    onPendingTotalChange(crFilter === 'pending' ? crTotal : null);
    // Clears the nav badge once this tab unmounts (the user switched away),
    // rather than leaving it showing a total from a query that stopped running.
    return () => onPendingTotalChange(null);
  }, [crFilter, crTotal, onPendingTotalChange]);

  const handleCreateCr = async (e: React.FormEvent) => {
    e.preventDefault();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(crPayloadText); } catch { setMessage(t('governance.changeRequests.invalidJson')); return; }
    await act(
      createCr.mutateAsync({ ...crForm, proposedPayload: payload }).then(() => {
        setShowCrForm(false);
        setCrForm({ changeType: '', targetEntityType: '', proposedPayload: {}, justification: '' });
        setCrPayloadText('{}');
      })
    );
  };

  // Approve/apply need no confirmation step, so they call the mutation
  // directly rather than routing through state + a handler below: doing it
  // in two steps (set the target, then read it back in the same event
  // handler) would read the PRE-update state, since a setState call does not
  // apply before the handler that queued it returns.
  const handleApproveCr = (id: number) => act(approveCr.mutateAsync({ id }));
  const handleApplyCr = (id: number) => act(applyCr.mutateAsync(id));

  // Reject needs a reason, collected in the modal opened by setting
  // `rejectTargetId`; this reads it back once the modal's own confirm
  // button is clicked, in a LATER render where the state has settled.
  const handleRejectCr = async () => {
    if (rejectTargetId === null) return;
    if (!rejectReason.trim()) {
      setMessage(t('governance.changeRequests.rejectionReasonRequired'));
      return;
    }
    await act(
      rejectCr.mutateAsync({ id: rejectTargetId, reason: rejectReason }).then(() => {
        setRejectTargetId(null);
        setRejectReason('');
      })
    );
  };

  const handleCancelCr = (id: number) => {
    if (!window.confirm(t('governance.changeRequests.confirmCancel'))) return;
    return act(cancelCr.mutateAsync(id));
  };

  const busy =
    createCr.isPending ||
    approveCr.isPending ||
    rejectCr.isPending ||
    applyCr.isPending ||
    cancelCr.isPending;

  return (
    <div>
      {message && (
        <div className="alert alert-danger alert-dismissible">
          {message}
          <button className="btn-close" onClick={() => setMessage(null)} />
        </div>
      )}

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
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowCrForm(false); setMessage(null); }}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectTargetId !== null && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('governance.changeRequests.rejectModalTitle', { id: rejectTargetId })}</h5>
                <button className="btn-close" onClick={() => setRejectTargetId(null)} />
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
                <button className="btn btn-secondary" onClick={() => { setRejectTargetId(null); setRejectReason(''); }}>{t('common.cancel')}</button>
                <button className="btn btn-danger" onClick={handleRejectCr} disabled={busy || !rejectReason.trim()}>
                  {busy ? t('governance.changeRequests.rejecting') : t('governance.changeRequests.reject')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QueryState
        isLoading={crQuery.isLoading}
        isError={crQuery.isError}
        error={crQuery.error}
        onRetry={() => crQuery.refetch()}
        isEmpty={changeRequests.length === 0}
        empty={<p className="text-muted text-center py-4 mb-0">{t('governance.changeRequests.noneFound')}</p>}
      >
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
                            onClick={() => handleApproveCr(cr.id)}
                            disabled={busy}
                            title={t('governance.changeRequests.approve')}
                          >
                            <i className="bi bi-check-lg" />
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger me-1"
                            onClick={() => setRejectTargetId(cr.id)}
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
                          onClick={() => handleApplyCr(cr.id)}
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
      </QueryState>
    </div>
  );
};

export default ChangeRequestsTab;
