/**
 * ChangeRequests — page for submitting and tracking change requests.
 *
 * Users with `change_request.create` can submit requests that appear as
 * proposals for review. Reviewers with `change_request.review` can approve,
 * reject, or apply requests. Proposers can cancel their own pending requests.
 *
 * The list (with its inline expandable row) lives in ChangeRequestTable; the
 * create and review forms live in CreateRequestModal / ReviewRequestModal.
 * This file owns the query wiring, tab/filter state, and modal-open state.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChangeRequest,
  ChangeRequestStatus,
  CreateChangeRequestInput,
} from '../../services/changeRequestService';
import { useChangeRequestsQuery, useChangeRequestMutations } from '../../hooks/useGovernance';
import { useAuth } from '../../contexts/AuthContext';
import ChangeRequestTable from './ChangeRequestTable';
import CreateRequestModal from './CreateRequestModal';
import ReviewRequestModal from './ReviewRequestModal';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';

const STATUS_FILTER_LABEL_KEYS: Record<ChangeRequestStatus, string> = {
  pending: 'changeRequests.filterStatus.pending',
  approved: 'changeRequests.filterStatus.approved',
  rejected: 'changeRequests.filterStatus.rejected',
  applied: 'changeRequests.filterStatus.applied',
  cancelled: 'changeRequests.filterStatus.cancelled',
};

const STATUS_FILTER_OPTIONS: ChangeRequestStatus[] = ['pending', 'approved', 'rejected', 'applied', 'cancelled'];

type ReviewMode = 'approve' | 'reject';

const ChangeRequests: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [statusFilter, setStatusFilter] = useState<ChangeRequestStatus | ''>('');

  const [showCreate, setShowCreate] = useState(false);

  const [reviewTarget, setReviewTarget] = useState<ChangeRequest | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('approve');

  const canReview = user?.permissions?.includes('change_request.review') ?? false;

  // Server state via TanStack Query, keyed by the tab (mine/all) and status
  // filter so switching either refetches. Shares the cache entry (and the
  // mutations, so a decision here invalidates the Governance page's view too)
  // with the Governance page's change-request view.
  const proposerUserId = tab === 'mine' ? Number(user?.id) : undefined;
  const crQuery = useChangeRequestsQuery(true, statusFilter, proposerUserId);
  const items = crQuery.data?.items ?? [];
  const total = crQuery.data?.total ?? 0;
  const [actionError, setError] = useState<string | null>(null);
  const { create, approve, reject, cancel } = useChangeRequestMutations();
  const creating = create.isPending;
  const reviewing = approve.isPending || reject.isPending;

  const handleCreate = async (body: CreateChangeRequestInput) => {
    await create.mutateAsync(body);
    setShowCreate(false);
  };

  const openReview = (item: ChangeRequest, mode: ReviewMode) => {
    setReviewTarget(item);
    setReviewMode(mode);
  };

  const handleReview = async (note: string) => {
    if (!reviewTarget) return;
    if (reviewMode === 'approve') {
      await approve.mutateAsync({ id: reviewTarget.id, justification: note.trim() || null });
    } else {
      await reject.mutateAsync({ id: reviewTarget.id, reason: note.trim() });
    }
    setReviewTarget(null);
  };

  const handleCancel = async (item: ChangeRequest) => {
    try {
      await cancel.mutateAsync(item.id);
    } catch (e) {
      setError((e as Error).message ?? t('changeRequests.cancelFailed'));
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('changeRequests.title')}</h1>
            <p className="text-muted mb-0 small">{t('changeRequests.subtitle')}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>{t('changeRequests.newRequest')}
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
              {t('changeRequests.tabs.mine')}
            </button>
          </li>
          {canReview && (
            <li className="nav-item">
              <button
                className={`nav-link ${tab === 'all' ? 'active' : ''}`}
                role="tab"
                onClick={() => setTab('all')}
              >
                {t('changeRequests.tabs.all')}
              </button>
            </li>
          )}
        </ul>
        <select
          className="form-select form-select-sm w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ChangeRequestStatus | '')}
          aria-label={t('changeRequests.filterAriaLabel')}
        >
          <option value="">{t('changeRequests.allStatuses')}</option>
          {STATUS_FILTER_OPTIONS.map((status) => (
            <option key={status} value={status}>{t(STATUS_FILTER_LABEL_KEYS[status])}</option>
          ))}
        </select>
      </div>

      {actionError && <ErrorAlert message={actionError} />}

      <div className="card">
        <div className="card-header d-flex align-items-center justify-content-between">
          <small className="text-muted">{crQuery.isLoading ? t('common.loading') : t('changeRequests.count', { count: total })}</small>
        </div>
        <div className="card-body p-0">
          <QueryState
            isLoading={crQuery.isLoading}
            isError={crQuery.isError}
            error={crQuery.error}
            onRetry={() => crQuery.refetch()}
            isEmpty={items.length === 0}
            empty={<div className="text-center text-muted py-5">{t('changeRequests.empty')}</div>}
          >
            <ChangeRequestTable
              items={items}
              canReview={canReview}
              onReview={openReview}
              onCancel={handleCancel}
            />
          </QueryState>
        </div>
      </div>

      <CreateRequestModal
        show={showCreate}
        creating={creating}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
      />

      <ReviewRequestModal
        target={reviewTarget}
        mode={reviewMode}
        reviewing={reviewing}
        onClose={() => setReviewTarget(null)}
        onConfirm={handleReview}
      />
    </div>
  );
};

export default ChangeRequests;
