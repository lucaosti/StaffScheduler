/**
 * PendingApprovals — inbox for items awaiting the current user's decision.
 *
 * Each row shows the change type, proposer, and the proposed payload.
 * The approver can approve or reject with an optional note, which is recorded
 * in the audit log and advances (or closes) the workflow.
 *
 * Accessible to all authenticated users; the backend only returns items
 * assigned to the current user.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  listPendingApprovals,
  approvePendingItem,
  rejectPendingItem,
  PendingApprovalItem,
} from '../../services/pendingApprovalService';

type DecisionMode = 'approve' | 'reject';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  escalated: 'bg-secondary',
};

const PendingApprovals: React.FC = () => {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  // Decision modal state
  const [decisionTarget, setDecisionTarget] = useState<PendingApprovalItem | null>(null);
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('approve');
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Expanded row for payload view
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = filter === 'pending' ? 'pending' : undefined;
      const res = await listPendingApprovals(status as string);
      setItems(res.data?.items ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load pending approvals.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDecision = (item: PendingApprovalItem, mode: DecisionMode) => {
    setDecisionTarget(item);
    setDecisionMode(mode);
    setNote('');
    setDecisionError(null);
  };

  const handleDecisionConfirm = async () => {
    if (!decisionTarget) return;
    setDeciding(true);
    setDecisionError(null);
    try {
      if (decisionMode === 'approve') {
        await approvePendingItem(decisionTarget.id, note || undefined);
      } else {
        await rejectPendingItem(decisionTarget.id, note || undefined);
      }
      setDecisionTarget(null);
      await load();
    } catch (e) {
      setDecisionError((e as Error).message ?? 'Action failed.');
    } finally {
      setDeciding(false);
    }
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Pending Approvals</h1>
            <p className="text-muted mb-0 small">Items assigned to you for review</p>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <div className="btn-group btn-group-sm" role="group" aria-label="Filter by status">
              <button
                type="button"
                className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilter('pending')}
              >
                Pending
              </button>
              <button
                type="button"
                className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={load} aria-label="Refresh">
              <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </button>
          </div>
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
              <span className="spinner-border me-2" role="status" aria-label="Loading"></span>
              <span>Loading…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-inbox fs-3 d-block mb-2" aria-hidden="true"></i>
              No pending approvals for you.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Change Type</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Proposer ID</th>
                    <th scope="col">Step</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
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
                            aria-label={expandedId === item.id ? `Collapse details for item ${item.id}` : `Expand details for item ${item.id}`}
                          >
                            {item.changeType}
                            <i className={`bi ms-1 ${expandedId === item.id ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true"></i>
                          </button>
                        </td>
                        <td className="small text-muted">
                          {item.targetEntityType}
                          {item.targetEntityId != null && ` #${item.targetEntityId}`}
                        </td>
                        <td className="small text-muted">{item.proposerUserId}</td>
                        <td className="small">{item.stepOrder}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[item.status] ?? 'bg-secondary'}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="small text-muted text-nowrap">{formatDate(item.createdAt)}</td>
                        <td className="text-end">
                          {item.status === 'pending' && (
                            <>
                              <button
                                className="btn btn-sm btn-success me-1"
                                onClick={() => openDecision(item, 'approve')}
                                aria-label={`Approve item ${item.id}`}
                              >
                                <i className="bi bi-check" aria-hidden="true"></i>
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => openDecision(item, 'reject')}
                                aria-label={`Reject item ${item.id}`}
                              >
                                <i className="bi bi-x" aria-hidden="true"></i>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === item.id && (
                        <tr>
                          <td colSpan={8} className="bg-light border-top-0">
                            <div className="p-3">
                              {item.justification && (
                                <div className="mb-2">
                                  <span className="fw-semibold small text-muted text-uppercase me-2">Justification</span>
                                  <span className="small">{item.justification}</span>
                                </div>
                              )}
                              <div className="mb-0">
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

      {/* Decision Modal */}
      {decisionTarget && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true"
          aria-label={decisionMode === 'approve' ? `Approve item ${decisionTarget.id}` : `Reject item ${decisionTarget.id}`}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {decisionMode === 'approve' ? 'Approve' : 'Reject'} — {decisionTarget.changeType}
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setDecisionTarget(null)}></button>
              </div>
              <div className="modal-body">
                {decisionError && (
                  <div className="alert alert-danger py-2 small" role="alert">{decisionError}</div>
                )}
                <div className="mb-3">
                  <label htmlFor="decisionNote" className="form-label">
                    Note <span className="text-muted small">(optional)</span>
                  </label>
                  <textarea
                    id="decisionNote"
                    className="form-control"
                    rows={3}
                    placeholder="Optional note recorded in the audit log"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDecisionTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn ${decisionMode === 'approve' ? 'btn-success' : 'btn-danger'}`}
                  onClick={handleDecisionConfirm}
                  disabled={deciding}
                  aria-label={decisionMode === 'approve' ? 'Confirm approve' : 'Confirm reject'}
                >
                  {deciding ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                  ) : (
                    decisionMode === 'approve' ? 'Approve' : 'Reject'
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

export default PendingApprovals;
