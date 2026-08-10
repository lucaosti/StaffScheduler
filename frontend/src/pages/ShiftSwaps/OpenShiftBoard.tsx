/**
 * OpenShiftBoard — the discovery layer for shift swaps: post one of your own
 * shifts to the board, see your own posted offers, and claim someone else's
 * by offering a shift of your own back (which immediately produces a swap
 * request already at "awaiting approval"). See ShiftSwaps.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QueryState from '../../components/QueryState';
import type { ShiftAssignment } from '../../types';
import { useOpenOffersQuery, useOpenOfferMutations } from '../../hooks/useShiftSwaps';
import { describe, describeOffer } from './shiftSwapFormat';

const OFFER_STATUS_LABEL_KEYS: Record<string, string> = {
  open: 'shiftSwaps.offerStatus.open',
  claimed: 'shiftSwaps.offerStatus.claimed',
  cancelled: 'shiftSwaps.offerStatus.cancelled',
};

interface Props {
  swappable: ShiftAssignment[];
  act: (action: Promise<unknown>) => Promise<boolean>;
}

const OpenShiftBoard: React.FC<Props> = ({ swappable, act }) => {
  const { t } = useTranslation();
  const [posting, setPosting] = useState<ShiftAssignment | null>(null);
  const [claimingOfferId, setClaimingOfferId] = useState<number | null>(null);
  const [claimWith, setClaimWith] = useState<ShiftAssignment | null>(null);

  const myOffers = useOpenOffersQuery(true);
  const openOffers = useOpenOffersQuery(false);
  const { post: postOffer, claim: claimOffer, cancel: cancelOffer } = useOpenOfferMutations();

  return (
    <>
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
    </>
  );
};

export default OpenShiftBoard;
