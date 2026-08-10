/**
 * ApprovalRow — one pending-approval table row plus its expandable panel:
 * the proposed payload, the chain-of-command trace, and (for a structure
 * head whose decision still sits at its default assignee) the keep/
 * delegate/open-to-structure controls. See PendingApprovals.tsx.
 *
 * Fetches its own chain-of-command and (if structure-assigned) unit members
 * when expanded, rather than the parent orchestrating that fetch — each row
 * owns the data only it needs.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getDecisionChain,
  PendingApprovalItem,
  DecisionChain,
} from '../../services/pendingApprovalService';
import { listMembersDetailed, OrgUnitMemberDetail } from '../../services/orgService';
import { type UseMutationResult } from '@tanstack/react-query';

type DecisionMode = 'approve' | 'reject';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  escalated: 'bg-secondary',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: 'approvals.status.pending',
  approved: 'approvals.status.approved',
  rejected: 'approvals.status.rejected',
  escalated: 'approvals.status.escalated',
};

const REASSIGNMENT_LABEL_KEYS: Record<string, string> = {
  kept: 'approvals.reassignment.kept',
  delegated_to_person: 'approvals.reassignment.delegatedToPerson',
  opened_to_structure: 'approvals.reassignment.openedToStructure',
};

const formatDate = (iso: string) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

interface Props {
  item: PendingApprovalItem;
  currentUserId: number | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenDecision: (item: PendingApprovalItem, mode: DecisionMode) => void;
  keepMutation: UseMutationResult<unknown, Error, number>;
  delegateMutation: UseMutationResult<unknown, Error, { id: number; targetUserId: number }>;
  openToStructureMutation: UseMutationResult<unknown, Error, number>;
}

const ApprovalRow: React.FC<Props> = ({
  item,
  currentUserId,
  isExpanded,
  onToggleExpand,
  onOpenDecision,
  keepMutation,
  delegateMutation,
  openToStructureMutation,
}) => {
  const { t } = useTranslation();
  const [chain, setChain] = useState<DecisionChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgUnitMemberDetail[]>([]);
  const [delegateTargetId, setDelegateTargetId] = useState('');
  const [delegateError, setDelegateError] = useState<string | null>(null);

  const delegating = keepMutation.isPending || delegateMutation.isPending || openToStructureMutation.isPending;

  // A structure-assigned decision still sitting with its default assignee
  // (the head, nobody has delegated/opened it yet) shows the delegation
  // controls to that same head.
  const canManageStructureDecision =
    item.status === 'pending' &&
    item.assignedToOrgUnitId !== null &&
    item.assignedToUserId !== null &&
    item.assignedToUserId === currentUserId;

  const loadChain = async () => {
    const res = await getDecisionChain(item.id);
    if (res.data) setChain(res.data);
  };

  useEffect(() => {
    if (!isExpanded) return;
    setDelegateTargetId('');
    setDelegateError(null);
    setChainLoading(true);
    setChainError(null);
    (async () => {
      try {
        await loadChain();
        if (item.assignedToOrgUnitId) {
          const membersRes = await listMembersDetailed(item.assignedToOrgUnitId);
          setMembers(membersRes.data ?? []);
        } else {
          setMembers([]);
        }
      } catch (e) {
        setChainError((e as Error).message ?? t('approvals.chainLoadFailed'));
      } finally {
        setChainLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, item.id]);

  const handleKeep = async () => {
    setDelegateError(null);
    try {
      await keepMutation.mutateAsync(item.id);
      await loadChain();
    } catch (e) {
      setDelegateError((e as Error).message ?? t('approvals.actionFailed'));
    }
  };

  const handleDelegate = async () => {
    const targetUserId = Number(delegateTargetId);
    if (!targetUserId) return;
    setDelegateError(null);
    try {
      await delegateMutation.mutateAsync({ id: item.id, targetUserId });
      await loadChain();
    } catch (e) {
      setDelegateError((e as Error).message ?? t('approvals.actionFailed'));
    }
  };

  const handleOpenToStructure = async () => {
    setDelegateError(null);
    try {
      await openToStructureMutation.mutateAsync(item.id);
      await loadChain();
    } catch (e) {
      setDelegateError((e as Error).message ?? t('approvals.actionFailed'));
    }
  };

  return (
    <React.Fragment>
      <tr>
        <td className="text-muted small">{item.id}</td>
        <td>
          <button
            className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold text-start"
            onClick={onToggleExpand}
            aria-label={isExpanded
              ? t('approvals.collapseAriaLabel', { id: item.id })
              : t('approvals.expandAriaLabel', { id: item.id })}
          >
            {item.changeType}
            {item.assignedToOrgUnitId !== null && (
              <span className="badge bg-info-subtle text-info-emphasis ms-2">{t('approvals.structureBadge')}</span>
            )}
            <i className={`bi ms-1 ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true"></i>
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
            {STATUS_LABEL_KEYS[item.status] ? t(STATUS_LABEL_KEYS[item.status]) : item.status}
          </span>
        </td>
        <td className="small text-muted text-nowrap">{formatDate(item.createdAt)}</td>
        <td className="text-end">
          {item.status === 'pending' && (
            <>
              <button
                className="btn btn-sm btn-success me-1"
                onClick={() => onOpenDecision(item, 'approve')}
                aria-label={t('approvals.approveAriaLabel', { id: item.id })}
              >
                <i className="bi bi-check" aria-hidden="true"></i>
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => onOpenDecision(item, 'reject')}
                aria-label={t('approvals.rejectAriaLabel', { id: item.id })}
              >
                <i className="bi bi-x" aria-hidden="true"></i>
              </button>
            </>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-light border-top-0">
            <div className="p-3">
              {item.justification && (
                <div className="mb-2">
                  <span className="fw-semibold small text-muted text-uppercase me-2">{t('approvals.justification')}</span>
                  <span className="small">{item.justification}</span>
                </div>
              )}
              <div className="mb-3">
                <span className="fw-semibold small text-muted text-uppercase me-2">{t('approvals.proposedPayload')}</span>
                <pre className="bg-white border rounded p-2 small mb-0" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}>
                  {JSON.stringify(item.proposedPayload, null, 2)}
                </pre>
              </div>

              <div className="border-top pt-3">
                <span className="fw-semibold small text-muted text-uppercase d-block mb-2">{t('approvals.chainOfCommand')}</span>
                {chainError && (
                  <div className="alert alert-danger py-2 small" role="alert">{chainError}</div>
                )}
                {chainLoading && !chain ? (
                  <span className="small text-muted">{t('common.loading')}</span>
                ) : chain ? (
                  <div className="small d-flex flex-wrap align-items-center gap-2">
                    {chain.assignedToOrgUnit ? (
                      <>
                        <span className="badge bg-secondary">{chain.assignedToOrgUnit.name}</span>
                        <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                        <span>
                          {t('approvals.head')} <strong>{chain.assignedToOrgUnit.headName ?? t('approvals.unassigned')}</strong>
                        </span>
                        {chain.reassignments.map((r) => (
                          <React.Fragment key={r.id}>
                            <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                            <span>
                              {r.actorName} {REASSIGNMENT_LABEL_KEYS[r.action] ? t(REASSIGNMENT_LABEL_KEYS[r.action]) : r.action}
                              {r.targetName ? ` ${r.targetName}` : ''}
                            </span>
                          </React.Fragment>
                        ))}
                        <i className="bi bi-arrow-right text-muted" aria-hidden="true"></i>
                        <span>
                          {chain.decidedByName
                            ? <>{t('approvals.decidedBy')} <strong>{chain.decidedByName}</strong></>
                            : chain.openToStructure
                              ? t('approvals.openToTeamAwaiting')
                              : t('approvals.awaitingDecision')}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">{t('approvals.assignedDirectly')}</span>
                    )}
                  </div>
                ) : null}
              </div>

              {canManageStructureDecision && (
                <div className="border-top pt-3 mt-3">
                  <span className="fw-semibold small text-muted text-uppercase d-block mb-2">
                    {t('approvals.youHeadThisStructure')}
                  </span>
                  {delegateError && (
                    <div className="alert alert-danger py-2 small" role="alert">{delegateError}</div>
                  )}
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      disabled={delegating}
                      onClick={() => void handleKeep()}
                    >
                      {t('approvals.keepForMyself')}
                    </button>
                    <select
                      className="form-select form-select-sm"
                      style={{ width: 'auto' }}
                      value={delegateTargetId}
                      onChange={(e) => setDelegateTargetId(e.target.value)}
                      aria-label={t('approvals.delegateToTeamMemberAriaLabel')}
                    >
                      <option value="">{t('approvals.delegateToPlaceholder')}</option>
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
                      onClick={() => void handleDelegate()}
                    >
                      {t('approvals.delegate')}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={delegating}
                      onClick={() => void handleOpenToStructure()}
                    >
                      {t('approvals.openToMyTeam')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};

export default ApprovalRow;
