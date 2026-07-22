/**
 * ChangeRequests — page for submitting and tracking change requests.
 *
 * Users with `change_request.create` can submit requests that appear as
 * proposals for review. Reviewers with `change_request.review` can approve,
 * reject, or apply requests. Proposers can cancel their own pending requests.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  cancelChangeRequest,
  ChangeRequest,
  ChangeRequestStatus,
  CreateChangeRequestInput,
} from '../../services/changeRequestService';
import { useChangeRequestsQuery } from '../../hooks/useGovernance';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_BADGE: Record<ChangeRequestStatus, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  applied: 'bg-primary',
  cancelled: 'bg-secondary',
};

const EMPTY_FORM: Omit<CreateChangeRequestInput, 'proposedPayload'> & { payloadText: string } = {
  changeType: '',
  targetEntityType: '',
  targetEntityId: undefined,
  justification: '',
  payloadText: '{}',
};

const ChangeRequests: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [statusFilter, setStatusFilter] = useState<ChangeRequestStatus | ''>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Review modal (approve/reject)
  const [reviewTarget, setReviewTarget] = useState<ChangeRequest | null>(null);
  const [reviewMode, setReviewMode] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const canReview = user?.permissions?.includes('change_request.review') ?? false;

  // Server state via TanStack Query, keyed by the tab (mine/all) and status
  // filter so switching either refetches. Shares the cache entry with the
  // Governance page's change-request view.
  const proposerUserId = tab === 'mine' ? Number(user?.id) : undefined;
  const crQuery = useChangeRequestsQuery(true, statusFilter, proposerUserId);
  const items = crQuery.data?.items ?? [];
  const total = crQuery.data?.total ?? 0;
  const loading = crQuery.isLoading;
  const [actionError, setError] = useState<string | null>(null);
  const error = crQuery.isError
    ? (crQuery.error as Error).message ?? 'Failed to load change requests.'
    : actionError;
  const load = () => queryClient.invalidateQueries({ queryKey: ['change-requests'] });

  // ---------- Create ----------

  const handleCreate = async () => {
    if (!form.changeType.trim()) { setCreateError('Change type is required.'); return; }
    if (!form.targetEntityType.trim()) { setCreateError('Entity type is required.'); return; }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(form.payloadText || '{}');
    } catch {
      setCreateError('Proposed payload must be valid JSON.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const body: CreateChangeRequestInput = {
        changeType: form.changeType.trim(),
        targetEntityType: form.targetEntityType.trim(),
        targetEntityId: form.targetEntityId ?? null,
        proposedPayload: payload,
        justification: form.justification?.trim() || null,
      };
      await createChangeRequest(body);
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (e) {
      setCreateError((e as Error).message ?? 'Failed to submit change request.');
    } finally {
      setCreating(false);
    }
  };

  // ---------- Review ----------

  const openReview = (item: ChangeRequest, mode: 'approve' | 'reject') => {
    setReviewTarget(item);
    setReviewMode(mode);
    setReviewNote('');
    setReviewError(null);
  };

  const handleReview = async () => {
    if (!reviewTarget) return;
    if (reviewMode === 'reject' && !reviewNote.trim()) {
      setReviewError('A rejection reason is required.');
      return;
    }
    setReviewing(true);
    setReviewError(null);
    try {
      if (reviewMode === 'approve') {
        await approveChangeRequest(reviewTarget.id, reviewNote.trim() || null);
      } else {
        await rejectChangeRequest(reviewTarget.id, reviewNote.trim());
      }
      setReviewTarget(null);
      await load();
    } catch (e) {
      setReviewError((e as Error).message ?? 'Action failed.');
    } finally {
      setReviewing(false);
    }
  };

  // ---------- Cancel ----------

  const handleCancel = async (item: ChangeRequest) => {
    try {
      await cancelChangeRequest(item.id);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Cancel failed.');
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Change Requests</h1>
            <p className="text-muted mb-0 small">Propose changes that appear as manager decisions when approved</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm({ ...EMPTY_FORM }); setCreateError(null); setShowCreate(true); }}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>New Request
          </button>
        </div>
      </div>

      {/* Tabs and filters */}
      <div className="d-flex align-items-center gap-3 mb-3">
        <ul className="nav nav-tabs mb-0 flex-shrink-0" role="tablist">
          <li className="nav-item">
            <button
              className={`nav-link ${tab === 'mine' ? 'active' : ''}`}
              role="tab"
              onClick={() => setTab('mine')}
            >
              My Requests
            </button>
          </li>
          {canReview && (
            <li className="nav-item">
              <button
                className={`nav-link ${tab === 'all' ? 'active' : ''}`}
                role="tab"
                onClick={() => setTab('all')}
              >
                All Requests
              </button>
            </li>
          )}
        </ul>
        <select
          className="form-select form-select-sm w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | '')}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="applied">Applied</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card">
        <div className="card-header d-flex align-items-center justify-content-between">
          <small className="text-muted">{loading ? 'Loading…' : `${total} request${total !== 1 ? 's' : ''}`}</small>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <span className="spinner-border me-2" role="status" aria-label="Loading"></span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted py-5">No change requests found.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Change Type</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Submitted</th>
                    <th scope="col" className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <React.Fragment key={item.id}>
                      <tr>
                        <td className="text-muted small">{item.id}</td>
                        <td>
                          <button
                            className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold text-start"
                            onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                            aria-label={expandedId === item.id ? `Collapse request ${item.id}` : `Expand request ${item.id}`}
                          >
                            {item.changeType}
                            <i className={`bi ms-1 ${expandedId === item.id ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true"></i>
                          </button>
                        </td>
                        <td className="small text-muted">
                          {item.targetEntityType}
                          {item.targetEntityId != null && ` #${item.targetEntityId}`}
                        </td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[item.status]}`}>{item.status}</span>
                        </td>
                        <td className="small text-muted text-nowrap">{formatDate(item.createdAt)}</td>
                        <td className="text-end">
                          {canReview && item.status === 'pending' && (
                            <>
                              <button
                                className="btn btn-sm btn-success me-1"
                                onClick={() => openReview(item, 'approve')}
                                aria-label={`Approve request ${item.id}`}
                              >
                                <i className="bi bi-check" aria-hidden="true"></i>
                              </button>
                              <button
                                className="btn btn-sm btn-danger me-1"
                                onClick={() => openReview(item, 'reject')}
                                aria-label={`Reject request ${item.id}`}
                              >
                                <i className="bi bi-x" aria-hidden="true"></i>
                              </button>
                            </>
                          )}
                          {item.status === 'pending' && (
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => handleCancel(item)}
                              aria-label={`Cancel request ${item.id}`}
                            >
                              <i className="bi bi-slash-circle" aria-hidden="true"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === item.id && (
                        <tr>
                          <td colSpan={6} className="bg-light border-top-0">
                            <div className="p-3">
                              {item.justification && (
                                <div className="mb-2">
                                  <span className="fw-semibold small text-muted text-uppercase me-2">Justification</span>
                                  <span className="small">{item.justification}</span>
                                </div>
                              )}
                              {item.rejectionReason && (
                                <div className="mb-2">
                                  <span className="fw-semibold small text-danger text-uppercase me-2">Rejection Reason</span>
                                  <span className="small">{item.rejectionReason}</span>
                                </div>
                              )}
                              <div>
                                <span className="fw-semibold small text-muted text-uppercase me-2">Proposed Payload</span>
                                <pre className="bg-white border rounded p-2 small mb-0" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}>
                                  {JSON.stringify(item.proposedPayload, null, 2)}
                                </pre>
                              </div>
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

      {/* Create Modal */}
      {showCreate && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label="New change request">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">New Change Request</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setShowCreate(false)}></button>
              </div>
              <div className="modal-body">
                {createError && (
                  <div className="alert alert-danger py-2 small" role="alert">{createError}</div>
                )}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label htmlFor="crChangeType" className="form-label">Change Type <span className="text-danger">*</span></label>
                    <input
                      id="crChangeType"
                      type="text"
                      className="form-control"
                      placeholder="e.g. TimeOff.Request"
                      value={form.changeType}
                      onChange={(e) => setForm((f) => ({ ...f, changeType: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="crEntityType" className="form-label">Entity Type <span className="text-danger">*</span></label>
                    <input
                      id="crEntityType"
                      type="text"
                      className="form-control"
                      placeholder="e.g. leave, shift"
                      value={form.targetEntityType}
                      onChange={(e) => setForm((f) => ({ ...f, targetEntityType: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-4">
                    <label htmlFor="crEntityId" className="form-label">Entity ID <span className="text-muted small">(optional)</span></label>
                    <input
                      id="crEntityId"
                      type="number"
                      className="form-control"
                      placeholder="Optional"
                      value={form.targetEntityId ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, targetEntityId: e.target.value ? Number(e.target.value) : undefined }))}
                      min={1}
                    />
                  </div>
                  <div className="col-12">
                    <label htmlFor="crPayload" className="form-label">Proposed Payload (JSON) <span className="text-danger">*</span></label>
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
                    <label htmlFor="crJustification" className="form-label">Justification <span className="text-muted small">(optional)</span></label>
                    <textarea
                      id="crJustification"
                      className="form-control"
                      rows={2}
                      value={form.justification ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                      placeholder="Reason for this change request"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={creating}
                  aria-label="Submit change request"
                >
                  {creating ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Submitting…</>
                  ) : 'Submit'}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true"
          aria-label={reviewMode === 'approve' ? `Approve request ${reviewTarget.id}` : `Reject request ${reviewTarget.id}`}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {reviewMode === 'approve' ? 'Approve' : 'Reject'} — {reviewTarget.changeType}
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setReviewTarget(null)}></button>
              </div>
              <div className="modal-body">
                {reviewError && (
                  <div className="alert alert-danger py-2 small" role="alert">{reviewError}</div>
                )}
                <div>
                  <label htmlFor="reviewNote" className="form-label">
                    {reviewMode === 'reject' ? 'Rejection Reason' : 'Justification'}
                    {reviewMode === 'reject' && <span className="text-danger"> *</span>}
                    {reviewMode === 'approve' && <span className="text-muted small"> (optional)</span>}
                  </label>
                  <textarea
                    id="reviewNote"
                    className="form-control"
                    rows={3}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder={reviewMode === 'reject' ? 'Required — reason for rejection' : 'Optional justification'}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReviewTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className={`btn ${reviewMode === 'approve' ? 'btn-success' : 'btn-danger'}`}
                  onClick={handleReview}
                  disabled={reviewing}
                  aria-label={reviewMode === 'approve' ? 'Confirm approve' : 'Confirm reject'}
                >
                  {reviewing ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                  ) : (
                    reviewMode === 'approve' ? 'Approve' : 'Reject'
                  )}
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

export default ChangeRequests;
