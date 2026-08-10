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
 * decided, and who ultimately acted on it. Both the panel and the
 * delegation controls live in ApprovalRow, which fetches its own chain and
 * unit-members data when expanded. The approve/reject form lives in
 * DecisionModal.
 *
 * Accessible to all authenticated users; the backend only returns items
 * assigned to the current user (directly, or via an opened structure).
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { PendingApprovalItem } from '../../services/pendingApprovalService';
import { usePendingApprovalsQuery, usePendingApprovalMutations } from '../../hooks/usePendingApprovals';
import ApprovalRow from './ApprovalRow';
import DecisionModal from './DecisionModal';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';

type DecisionMode = 'approve' | 'reject';

const PendingApprovals: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentUserId = user?.id ? Number(user.id) : null;

  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const [decisionTarget, setDecisionTarget] = useState<PendingApprovalItem | null>(null);
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('approve');

  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Main queue via TanStack Query (keyed by filter).
  const queueQuery = usePendingApprovalsQuery(filter);
  const items = queueQuery.data ?? [];
  const { approve, reject, keep, delegate, openToStructure } = usePendingApprovalMutations();
  const deciding = approve.isPending || reject.isPending;

  const openDecision = (item: PendingApprovalItem, mode: DecisionMode) => {
    setDecisionTarget(item);
    setDecisionMode(mode);
  };

  const handleDecisionConfirm = async (note: string) => {
    if (!decisionTarget) return;
    if (decisionMode === 'approve') {
      await approve.mutateAsync({ id: decisionTarget.id, note: note || undefined });
    } else {
      await reject.mutateAsync({ id: decisionTarget.id, note: note || undefined });
    }
    setDecisionTarget(null);
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('approvals.title')}</h1>
            <p className="text-muted mb-0 small">{t('approvals.subtitle')}</p>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <div className="btn-group btn-group-sm" role="group" aria-label={t('approvals.filterAriaLabel')}>
              <button
                type="button"
                className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilter('pending')}
              >
                {t('approvals.filterPending')}
              </button>
              <button
                type="button"
                className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilter('all')}
              >
                {t('approvals.all')}
              </button>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => queueQuery.refetch()} aria-label={t('approvals.refresh')}>
              <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      {queueQuery.isError && (
        <ErrorAlert
          message={(queueQuery.error as Error).message ?? t('approvals.loadFailed')}
          onRetry={() => queueQuery.refetch()}
        />
      )}

      <div className="card">
        <div className="card-body p-0">
          <QueryState
            isLoading={queueQuery.isLoading}
            loadingMessage={t('common.loading')}
            isEmpty={items.length === 0}
            empty={
              <div className="text-center text-muted py-5">
                <i className="bi bi-inbox fs-3 d-block mb-2" aria-hidden="true"></i>
                {t('approvals.empty')}
              </div>
            }
          >
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('approvals.columns.changeType')}</th>
                    <th scope="col">{t('approvals.columns.entity')}</th>
                    <th scope="col">{t('approvals.columns.proposerId')}</th>
                    <th scope="col">{t('approvals.columns.step')}</th>
                    <th scope="col">{t('approvals.columns.status')}</th>
                    <th scope="col">{t('approvals.columns.created')}</th>
                    <th scope="col" className="text-end">{t('approvals.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ApprovalRow
                      key={item.id}
                      item={item}
                      currentUserId={currentUserId}
                      isExpanded={expandedId === item.id}
                      onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      onOpenDecision={openDecision}
                      keepMutation={keep}
                      delegateMutation={delegate}
                      openToStructureMutation={openToStructure}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </div>
      </div>

      <DecisionModal
        target={decisionTarget}
        mode={decisionMode}
        deciding={deciding}
        onClose={() => setDecisionTarget(null)}
        onConfirm={handleDecisionConfirm}
      />
    </div>
  );
};

export default PendingApprovals;
