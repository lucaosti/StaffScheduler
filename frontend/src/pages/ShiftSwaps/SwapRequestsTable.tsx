/**
 * SwapRequestsTable — the two-gate swap request list: the target
 * accepts/declines (`pending_target`), then a manager approves/declines
 * (`pending`). See ShiftSwaps.tsx for why there are two gates.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import QueryState from '../../components/QueryState';
import type { ShiftSwapRequest } from '../../types';
import { useSwapMutations, useSwapRequestsQuery } from '../../hooks/useShiftSwaps';

const STATUS_BADGE: Record<string, string> = {
  pending_target: 'bg-info text-dark',
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  declined: 'bg-danger',
  cancelled: 'bg-secondary',
};

/** Kept as identifiers so the badge class stays keyed on the raw enum while the visible label goes through `t()`. */
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending_target: 'shiftSwaps.status.pendingTarget',
  pending: 'shiftSwaps.status.pending',
  approved: 'shiftSwaps.status.approved',
  declined: 'shiftSwaps.status.declined',
  cancelled: 'shiftSwaps.status.cancelled',
};

interface Props {
  requestsQuery: ReturnType<typeof useSwapRequestsQuery>;
  myId: number | null;
  canDecide: boolean;
  respond: ReturnType<typeof useSwapMutations>['respond'];
  approve: ReturnType<typeof useSwapMutations>['approve'];
  decline: ReturnType<typeof useSwapMutations>['decline'];
  cancel: ReturnType<typeof useSwapMutations>['cancel'];
  act: (action: Promise<unknown>) => Promise<boolean>;
}

const SwapRequestsTable: React.FC<Props> = ({ requestsQuery, myId, canDecide, respond, approve, decline, cancel, act }) => {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="h6 mt-4">{t('shiftSwaps.swapRequests')}</h2>
      <QueryState
        isLoading={requestsQuery.isLoading}
        isError={requestsQuery.isError}
        error={requestsQuery.error}
        onRetry={requestsQuery.refetch}
        isEmpty={(requestsQuery.data?.length ?? 0) === 0}
        loadingMessage={t('shiftSwaps.loadingRequests')}
        empty={<p className="text-muted">{t('shiftSwaps.noRequests')}</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>{t('shiftSwaps.columns.requester')}</th>
              <th>{t('shiftSwaps.columns.otherPerson')}</th>
              <th>{t('shiftSwaps.columns.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(requestsQuery.data ?? []).map((r: ShiftSwapRequest) => {
              const isRequester = r.requesterUserId === myId;
              const isTarget = r.targetUserId === myId;
              return (
                <tr key={r.id}>
                  <td>{isRequester ? t('shiftSwaps.you') : r.requesterUserId}</td>
                  <td>{isTarget ? t('shiftSwaps.you') : r.targetUserId}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? 'bg-secondary'}`}>
                      {t(STATUS_LABEL_KEYS[r.status] ?? r.status)}
                    </span>
                    {r.status === 'declined' && r.declinedBy && (
                      <span className="text-muted small d-block">
                        {r.declinedBy === 'target' ? t('shiftSwaps.declinedByOtherPerson') : t('shiftSwaps.declinedByManager')}
                      </span>
                    )}
                  </td>
                  <td className="text-end">
                    {r.status === 'pending_target' && isTarget && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success me-2"
                          onClick={() => act(respond.mutateAsync({ id: r.id, accepted: true }))}
                          disabled={respond.isPending}
                        >
                          {t('shiftSwaps.accept')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => act(respond.mutateAsync({ id: r.id, accepted: false }))}
                          disabled={respond.isPending}
                        >
                          {t('shiftSwaps.decline')}
                        </button>
                      </>
                    )}
                    {r.status === 'pending_target' && isRequester && (
                      <span className="text-muted small">{t('shiftSwaps.waitingForOtherPerson')}</span>
                    )}
                    {(r.status === 'pending_target' || r.status === 'pending') && isRequester && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary ms-2"
                        onClick={() => act(cancel.mutateAsync(r.id))}
                        disabled={cancel.isPending}
                      >
                        {t('shiftSwaps.withdraw')}
                      </button>
                    )}
                    {r.status === 'pending' && canDecide && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success me-2"
                          onClick={() => act(approve.mutateAsync({ id: r.id }))}
                          disabled={approve.isPending}
                        >
                          {t('shiftSwaps.approve')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => act(decline.mutateAsync({ id: r.id }))}
                          disabled={decline.isPending}
                        >
                          {t('shiftSwaps.decline')}
                        </button>
                      </>
                    )}
                    {/* Said plainly rather than left as an empty cell: the
                        target has no manager-approval action because the
                        model gives them none — their own decision already
                        happened at the pending_target step. */}
                    {r.status === 'pending' && isTarget && !canDecide && (
                      <span className="text-muted small">{t('shiftSwaps.managerDecidesThis')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </QueryState>
    </>
  );
};

export default SwapRequestsTable;
