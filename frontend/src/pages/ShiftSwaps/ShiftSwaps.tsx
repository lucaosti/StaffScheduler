/**
 * Shift swaps — proposing one, responding to one, and deciding one.
 *
 * WHY BOTH SIDES ARE SHOWN BEFORE ANYTHING IS SENT. A swap changes two
 * people's commitments at once. A screen that shows only what you are giving
 * up, or only what you are taking, is how someone agrees to a shift they did
 * not realise they were taking — and the whole reason published assignments
 * are pinned and broken commitments are notified is that a shift someone has
 * been told about is one they have arranged their life around.
 *
 * TWO GATES, NOT ONE (#522). A swap used to skip straight from creation to
 * manager approval — the target was never asked, and discovered the swap by
 * finding themselves working a different day. `pending_target` is the state
 * before the target has responded; only they can accept or decline it
 * (gated on identity, not a permission code — whether to agree to a swap of
 * your own shift isn't a manager privilege). Accepting moves the request to
 * `pending`, which now means "target accepted, awaiting manager" rather
 * than "request submitted"; only then do `approve`/`decline` (gated on
 * `shiftswap.approve`) become available. A target decline ends the request
 * immediately — there is nothing left for a manager to approve.
 *
 * THE OPEN BOARD IS A DISCOVERY LAYER, NOT A THIRD FLOW. Proposing a swap
 * above requires already knowing who to ask. Posting a shift to the board
 * instead makes it visible to anyone eligible; claiming one immediately
 * pairs it with an assignment of the claimer's own and produces the exact
 * same kind of swap request as the targeted flow — already at "awaiting
 * approval", since offering a specific assignment back is the claimer's
 * consent in one action. The requests table above is where that swap then
 * shows up; the board never displays its own separate status.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useMyAssignmentsQuery } from '../../hooks/useAssignments';
import {
  useSwapRequestsQuery,
  useSwapCandidatesQuery,
  useSwapMutations,
  useOpenOffersQuery,
  useOpenOfferMutations,
} from '../../hooks/useShiftSwaps';
import type { ShiftAssignment, ShiftSwapRequest } from '../../types';
import type { SwapCandidate, ShiftSwapOffer } from '../../services/shiftSwapService';
import { formatTime } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';

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

const OFFER_STATUS_LABEL_KEYS: Record<string, string> = {
  open: 'shiftSwaps.offerStatus.open',
  claimed: 'shiftSwaps.offerStatus.claimed',
  cancelled: 'shiftSwaps.offerStatus.cancelled',
};

const describe = (a: ShiftAssignment): string =>
  `${String(a.shiftDate ?? '').slice(0, 10)} ${shiftTime(a.startTime)}–${shiftTime(a.endTime)}`;

const describeCandidate = (c: SwapCandidate): string =>
  `${c.date} ${shiftTime(c.startTime)}–${shiftTime(c.endTime)}`;

const describeOffer = (o: ShiftSwapOffer): string =>
  `${o.date} ${shiftTime(o.startTime)}–${shiftTime(o.endTime)}`;

const ShiftSwaps: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const myId = user?.id ? Number(user.id) : null;
  const canDecide = (user?.permissions ?? []).includes('shiftswap.approve');

  const [giving, setGiving] = useState<ShiftAssignment | null>(null);
  const [posting, setPosting] = useState<ShiftAssignment | null>(null);
  const [claimingOfferId, setClaimingOfferId] = useState<number | null>(null);
  const [claimWith, setClaimWith] = useState<ShiftAssignment | null>(null);

  const mine = useMyAssignmentsQuery(myId);
  const requests = useSwapRequestsQuery();
  const candidates = useSwapCandidatesQuery(giving ? Number(giving.id) : null);
  const { propose, respond, approve, decline, cancel } = useSwapMutations();
  const myOffers = useOpenOffersQuery(true);
  const openOffers = useOpenOffersQuery(false);
  const { post: postOffer, claim: claimOffer, cancel: cancelOffer } = useOpenOfferMutations();

  const swappable = (mine.data ?? []).filter(
    (a: ShiftAssignment) => a.status === 'pending' || a.status === 'confirmed'
  );

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">{t('shiftSwaps.title')}</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <h2 className="h6">{t('shiftSwaps.proposeSwap')}</h2>
      <QueryState
        isLoading={mine.isLoading}
        isError={mine.isError}
        error={mine.error}
        onRetry={mine.refetch}
        isEmpty={swappable.length === 0}
        loadingMessage={t('shiftSwaps.loadingYourShifts')}
        empty={<p className="text-muted">{t('shiftSwaps.noShiftsToSwap')}</p>}
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="swap-giving">{t('shiftSwaps.shiftYouWouldGiveUp')}</label>
          <select
            id="swap-giving"
            className="form-select"
            value={giving ? String(giving.id) : ''}
            onChange={(e) =>
              setGiving(swappable.find((a) => String(a.id) === e.target.value) ?? null)
            }
          >
            <option value="">{t('shiftSwaps.chooseOneOfYourShifts')}</option>
            {swappable.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {t('shiftSwaps.shiftOptionLabel', { shift: describe(a), department: a.departmentName ?? '' })}
              </option>
            ))}
          </select>
        </div>
      </QueryState>

      {giving && (
        <QueryState
          isLoading={candidates.isLoading}
          isError={candidates.isError}
          error={candidates.error}
          onRetry={candidates.refetch}
          isEmpty={(candidates.data?.candidates.length ?? 0) === 0}
          loadingMessage={t('shiftSwaps.findingCandidates')}
          empty={
            <p className="text-muted">
              {t('shiftSwaps.noCandidatesFound')}
            </p>
          }
        >
          <ul className="list-group mb-2">
            {(candidates.data?.candidates ?? []).map((c) => (
              <li
                key={c.assignmentId}
                className="list-group-item d-flex justify-content-between align-items-center"
              >
                {/* Both sides, in one sentence, before anything is sent. */}
                <span>
                  {t('shiftSwaps.candidateSummary', {
                    theirs: describeCandidate(c),
                    theirDept: c.departmentName,
                    userName: c.userName,
                    yours: describe(giving),
                  })}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() =>
                    act(
                      propose
                        .mutateAsync({
                          requesterAssignmentId: Number(giving.id),
                          targetAssignmentId: c.assignmentId,
                        })
                        .then(() => setGiving(null))
                    )
                  }
                  disabled={propose.isPending}
                >
                  {t('shiftSwaps.propose')}
                </button>
              </li>
            ))}
          </ul>
          {candidates.data?.truncated && (
            <p className="text-muted small">
              {t('shiftSwaps.truncatedNotice')}
            </p>
          )}
        </QueryState>
      )}

      <h2 className="h6 mt-4">{t('shiftSwaps.openShiftBoard')}</h2>
      <p className="text-muted small">
        {t('shiftSwaps.openShiftBoardDescription')}
      </p>

      <div className="mb-3">
        <label className="form-label" htmlFor="board-posting">{t('shiftSwaps.postToBoard')}</label>
        <div className="d-flex gap-2">
          <select
            id="board-posting"
            className="form-select"
            value={posting ? String(posting.id) : ''}
            onChange={(e) =>
              setPosting(swappable.find((a) => String(a.id) === e.target.value) ?? null)
            }
          >
            <option value="">{t('shiftSwaps.chooseOneOfYourShifts')}</option>
            {swappable.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {t('shiftSwaps.shiftOptionLabel', { shift: describe(a), department: a.departmentName ?? '' })}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline-primary text-nowrap"
            disabled={!posting || postOffer.isPending}
            onClick={() =>
              posting &&
              act(postOffer.mutateAsync({ assignmentId: Number(posting.id) }).then(() => setPosting(null)))
            }
          >
            {t('shiftSwaps.post')}
          </button>
        </div>
      </div>

      {(myOffers.data?.length ?? 0) > 0 && (
        <QueryState
          isLoading={myOffers.isLoading}
          isError={myOffers.isError}
          error={myOffers.error}
          onRetry={myOffers.refetch}
          isEmpty={false}
        >
          <p className="text-muted small mb-1">{t('shiftSwaps.yourPostedOffers')}</p>
          <ul className="list-group mb-3">
            {(myOffers.data ?? []).map((o) => (
              <li key={o.id} className="list-group-item d-flex justify-content-between align-items-center">
                <span>
                  {t('shiftSwaps.offerLabel', { offer: describeOffer(o), department: o.departmentName })}
                  {o.status !== 'open' && (
                    <span className="badge bg-secondary ms-2">{t(OFFER_STATUS_LABEL_KEYS[o.status] ?? o.status)}</span>
                  )}
                </span>
                {o.status === 'open' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => act(cancelOffer.mutateAsync(o.id))}
                    disabled={cancelOffer.isPending}
                  >
                    {t('shiftSwaps.withdraw')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      )}

      <QueryState
        isLoading={openOffers.isLoading}
        isError={openOffers.isError}
        error={openOffers.error}
        onRetry={openOffers.refetch}
        isEmpty={(openOffers.data?.length ?? 0) === 0}
        loadingMessage={t('shiftSwaps.loadingBoard')}
        empty={<p className="text-muted">{t('shiftSwaps.noOpenOffers')}</p>}
      >
        <ul className="list-group mb-2">
          {(openOffers.data ?? []).map((o) => (
            <li key={o.id} className="list-group-item">
              <div className="d-flex justify-content-between align-items-center">
                <span>
                  {t('shiftSwaps.offerSummary', { offer: describeOffer(o), dept: o.departmentName, userName: o.userName })}
                </span>
                {claimingOfferId !== o.id && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => {
                      setClaimingOfferId(o.id);
                      setClaimWith(null);
                    }}
                  >
                    {t('shiftSwaps.claim')}
                  </button>
                )}
              </div>
              {claimingOfferId === o.id && (
                <div className="mt-2 d-flex gap-2 align-items-center">
                  <select
                    className="form-select form-select-sm"
                    aria-label={t('shiftSwaps.offerOneOfYourShiftsBackAriaLabel')}
                    value={claimWith ? String(claimWith.id) : ''}
                    onChange={(e) =>
                      setClaimWith(swappable.find((a) => String(a.id) === e.target.value) ?? null)
                    }
                  >
                    <option value="">{t('shiftSwaps.offerOneOfYourShiftsBack')}</option>
                    {swappable.map((a) => (
                      <option key={String(a.id)} value={String(a.id)}>
                        {t('shiftSwaps.shiftOptionLabel', { shift: describe(a), department: a.departmentName ?? '' })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary text-nowrap"
                    disabled={!claimWith || claimOffer.isPending}
                    onClick={() =>
                      claimWith &&
                      act(
                        claimOffer
                          .mutateAsync({ id: o.id, assignmentId: Number(claimWith.id) })
                          .then(() => {
                            setClaimingOfferId(null);
                            setClaimWith(null);
                          })
                      )
                    }
                  >
                    {t('shiftSwaps.confirmClaim')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setClaimingOfferId(null)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </QueryState>

      <h2 className="h6 mt-4">{t('shiftSwaps.swapRequests')}</h2>
      <QueryState
        isLoading={requests.isLoading}
        isError={requests.isError}
        error={requests.error}
        onRetry={requests.refetch}
        isEmpty={(requests.data?.length ?? 0) === 0}
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
            {(requests.data ?? []).map((r: ShiftSwapRequest) => {
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
    </div>
  );
};

export default ShiftSwaps;
