/**
 * PendingApprovals — inbox for items awaiting the current user's decision.
 *
 * Each row shows the change type, proposer, and the proposed payload.
 * The approver can approve or reject with an optional note, which is recorded
 * in the audit log and advances (or closes) the workflow.
 *
 * When a decision is assigned to a structure (org unit) rather than a
 * person, the structure's head sees three extra actions — keep it, delegate
 * it to one team member, or open it to the whole team — and every row
 * exposes a "Chain of command" panel (visible to everyone who can see the
 * item) showing what happened: which structure it went to, what the head
 * decided, and who ultimately acted on it.
 *
 * Accessible to all authenticated users; the backend only returns items
 * assigned to the current user (directly, or via an opened structure).
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listPendingApprovals,
  approvePendingItem,
  rejectPendingItem,
  keepPendingItem,
  delegatePendingItem,
  openPendingItemToStructure,
  getDecisionChain,
  PendingApprovalItem,
  DecisionChain,
} from '../../services/pendingApprovalService';
import { listMembersDetailed, OrgUnitMemberDetail } from '../../services/orgService';

type DecisionMode = 'approve' | 'reject';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  escalated: 'bg-secondary',
};

const REASSIGNMENT_LABEL: Record<string, string> = {
  kept: 'kept it',
  delegated_to_person: 'delegated it to',
  opened_to_structure: 'opened it to the team',
};

const PendingApprovals: React.FC = () => {
  const { user } = useAuth();
  const currentUserId = user?.id ? Number(user.id) : null;

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

  // Expanded row: chain-of-command panel + (for structure heads) delegation controls
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [chains, setChains] = useState<Record<number, DecisionChain>>({});
  const [chainLoading, setChainLoading] = useState(false);
  const [members, setMembers] = useState<OrgUnitMemberDetail[]>([]);
  const [delegateTargetId, setDelegateTargetId] = useState<string>('');
  const [delegating, setDelegating] = useState(false);
  const [delegateError, setDelegateError] = useState<string | null>(null);

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

  const toggleExpand = async (item: PendingApprovalItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setDelegateTargetId('');
    setDelegateError(null);
    setChainLoading(true);
    try {
      const res = await getDecisionChain(item.id);
      if (res.data) setChains((prev) => ({ ...prev, [item.id]: res.data as DecisionChain }));
      if (item.assignedToOrgUnitId) {
        const membersRes = await listMembersDetailed(item.assignedToOrgUnitId);
        setMembers(membersRes.data ?? []);
      } else {
        setMembers([]);
      }
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load chain of command.');
    } finally {
      setChainLoading(false);
    }
  };

  const refreshChain = async (id: number) => {
    const res = await getDecisionChain(id);
    if (res.data) setChains((prev) => ({ ...prev, [id]: res.data as DecisionChain }));
  };

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

  const handleKeep = async (item: PendingApprovalItem) => {
    setDelegating(true);
    setDelegateError(null);
    try {
      await keepPendingItem(item.id);
      await refreshChain(item.id);
      await load();
    } catch (e) {
      setDelegateError((e as Error).message ?? 'Action failed.');
    } finally {
      setDelegating(false);
    }
  };

  const handleDelegate = async (item: PendingApprovalItem) => {
    const targetUserId = Number(delegateTargetId);
    if (!targetUserId) return;
    setDelegating(true);
    setDelegateError(null);
    try {
      await delegatePendingItem(item.id, targetUserId);
      await refreshChain(item.id);
      await load();
    } catch (e) {
      setDelegateError((e as Error).message ?? 'Action failed.');
    } finally {
      setDelegating(false);
    }
  };

  const handleOpenToStructure = async (item: PendingApprovalItem) => {
    setDelegating(true);
    setDelegateError(null);
    try {
      await openPendingItemToStructure(item.id);
      await refreshChain(item.id);
      await load();
    } catch (e) {
      setDelegateError((e as Error).message ?? 'Action failed.');
    } finally {
      setDelegating(false);
    }
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // A structure-assigned decision still sitting with its default assignee
  // (the head, nobody has delegated/opened it yet) shows the delegation
  // controls to that same head.
  const canManageStructureDecision = (item: PendingApprovalItem): boolean =>
    item.status === 'pending' &&
    item.assignedToOrgUnitId !== null &&
    item.assignedToUserId !== null &&
    item.assignedToUserId === currentUserId;

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
                            onClick={() => void toggleExpand(item)}
                            aria-label={expandedId === item.id ? `Collapse details for item ${item.id}` : `Expand details for item ${item.id}`}
                          >
                            {item.changeType}
                            {item.assignedToOrgUnitId !== null && (
                              <span className="badge bg-info-subtle text-info-emphasis ms-2">Structure</span>
                            )}
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
                              <div className="mb-3">
                                <span className="fw-semibold small text-muted text-uppercase me-2">Proposed Payload</span>
                                <pre className="bg-white border rounded p-2 small mb-0" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}>
                                  {JSON.stringify(item.proposedPayload, null, 2)}
                                </pre>
                              </div>

                              <div className="border-top pt-3">
                                <span className="fw-semibold small text-muted text-uppercase d-block mb-2">Chain of command</span>
                                {chainLoading && !chains[item.id] ? (
                                  <span className="small text-muted">Loading…</span>
                                ) : chains[item.id] ? (
                                  <div className="small d-flex flex-wrap align-items-center gap-2">
                                    {chains[item.id].assignedToOrgUnit ? (
                                      <>
                                        <span className="badge bg-secondary">{chains[item.id].assignedToOrgUnit!.name}</span>
                                        <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                                        <span>
                                          Head: <strong>{chains[item.id].assignedToOrgUnit!.headName ?? 'unassigned'}</strong>
                                        </span>
                                        {chains[item.id].reassignments.map((r) => (
                                          <React.Fragment key={r.id}>
                                            <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                                            <span>
                                              {r.actorName} {REASSIGNMENT_LABEL[r.action] ?? r.action}
                                              {r.targetName ? ` ${r.targetName}` : ''}
                                            </span>
                                          </React.Fragment>
                                        ))}
                                        <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                                        <span>
                                          {chains[item.id].decidedByName
                                            ? <>Decided by <strong>{chains[item.id].decidedByName}</strong></>
                                            : chains[item.id].openToStructure
                                              ? 'Open to the whole team — awaiting decision'
                                              : 'Awaiting decision'}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-muted">Assigned directly to a person — no structure delegation involved.</span>
                                    )}
                                  </div>
                                ) : null}
                              </div>

                              {canManageStructureDecision(item) && (
                                <div className="border-top pt-3 mt-3">
                                  <span className="fw-semibold small text-muted text-uppercase d-block mb-2">
                                    You head this structure — decide what happens to it
                                  </span>
                                  {delegateError && (
                                    <div className="alert alert-danger py-2 small" role="alert">{delegateError}</div>
                                  )}
                                  <div className="d-flex flex-wrap align-items-center gap-2">
                                    <button
                                      className="btn btn-sm btn-outline-primary"
                                      disabled={delegating}
                                      onClick={() => void handleKeep(item)}
                                    >
                                      Keep for myself
                                    </button>
                                    <select
                                      className="form-select form-select-sm"
                                      style={{ width: 'auto' }}
                                      value={delegateTargetId}
                                      onChange={(e) => setDelegateTargetId(e.target.value)}
                                      aria-label="Delegate to team member"
                                    >
                                      <option value="">Delegate to…</option>
                                      {members
                                        .filter((m) => m.userId !== currentUserId)
                                        .map((m) => (
                                          <option key={m.userId} value={m.userId}>
                                            {m.firstName} {m.lastName}
                                          </option>
                                        ))}
                                    </select>
                                    <button
                                      className="btn btn-sm btn-outline-primary"
                                      disabled={delegating || !delegateTargetId}
                                      onClick={() => void handleDelegate(item)}
                                    >
                                      Delegate
                                    </button>
                                    <button
                                      className="btn btn-sm btn-outline-secondary"
                                      disabled={delegating}
                                      onClick={() => void handleOpenToStructure(item)}
                                    >
                                      Open to my team
                                    </button>
                                  </div>
                                </div>
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
