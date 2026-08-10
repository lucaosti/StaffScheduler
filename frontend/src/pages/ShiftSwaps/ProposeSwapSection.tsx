/**
 * ProposeSwapSection — pick one of your own shifts and propose a swap
 * against an eligible candidate. See ShiftSwaps.tsx for why both sides are
 * shown before anything is sent.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import QueryState from '../../components/QueryState';
import type { ShiftAssignment } from '../../types';
import { useSwapCandidatesQuery, useSwapMutations } from '../../hooks/useShiftSwaps';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, describeCandidate } from './shiftSwapFormat';

interface Props {
  swappable: ShiftAssignment[];
  mineQuery: UseQueryResult<ShiftAssignment[]>;
  giving: ShiftAssignment | null;
  onGivingChange: (assignment: ShiftAssignment | null) => void;
  proposeMutation: ReturnType<typeof useSwapMutations>['propose'];
  act: (action: Promise<unknown>) => Promise<boolean>;
}

const ProposeSwapSection: React.FC<Props> = ({ swappable, mineQuery, giving, onGivingChange, proposeMutation, act }) => {
  const { t } = useTranslation();
  const candidates = useSwapCandidatesQuery(giving ? Number(giving.id) : null);

  return (
    <>
      <h2 className="h6">{t('shiftSwaps.proposeSwap')}</h2>
      <QueryState
        isLoading={mineQuery.isLoading}
        isError={mineQuery.isError}
        error={mineQuery.error}
        onRetry={mineQuery.refetch}
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
              onGivingChange(swappable.find((a) => String(a.id) === e.target.value) ?? null)
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
                      proposeMutation
                        .mutateAsync({
                          requesterAssignmentId: Number(giving.id),
                          targetAssignmentId: c.assignmentId,
                        })
                        .then(() => onGivingChange(null))
                    )
                  }
                  disabled={proposeMutation.isPending}
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
    </>
  );
};

export default ProposeSwapSection;
