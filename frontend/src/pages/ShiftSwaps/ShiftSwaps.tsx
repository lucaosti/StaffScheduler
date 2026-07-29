/**
 * Shift swaps — proposing one, and deciding one.
 *
 * WHY BOTH SIDES ARE SHOWN BEFORE ANYTHING IS SENT. A swap changes two
 * people's commitments at once. A screen that shows only what you are giving
 * up, or only what you are taking, is how someone agrees to a shift they did
 * not realise they were taking — and the whole reason published assignments
 * are pinned and broken commitments are notified is that a shift someone has
 * been told about is one they have arranged their life around.
 *
 * WHAT THIS PAGE IS HONEST ABOUT. In the current model the person whose shift
 * is being taken is never asked: `approve` and `decline` are gated on
 * `shiftswap.approve`, so a manager decides and both assignments move. The
 * target sees the request in their list with no action available, and the page
 * says so plainly rather than showing buttons that would 403 or implying a
 * consent the system never collects. Whether that model is right is #522; what
 * would be wrong is a UI that hides it.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useMyAssignmentsQuery } from '../../hooks/useAssignments';
import {
  useSwapRequestsQuery,
  useSwapCandidatesQuery,
  useSwapMutations,
} from '../../hooks/useShiftSwaps';
import type { Assignment, ShiftSwapRequest } from '../../types';
import type { SwapCandidate } from '../../services/shiftSwapService';
import { formatTime } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  cancelled: 'bg-secondary',
};


const describe = (a: Assignment): string =>
  `${String(a.shiftDate ?? '').slice(0, 10)} ${shiftTime(a.startTime)}–${shiftTime(a.endTime)}`;

const describeCandidate = (c: SwapCandidate): string =>
  `${c.date} ${shiftTime(c.startTime)}–${shiftTime(c.endTime)}`;

const ShiftSwaps: React.FC = () => {
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const myId = user?.id ? Number(user.id) : null;
  const canDecide = (user?.permissions ?? []).includes('shiftswap.approve');

  const [giving, setGiving] = useState<Assignment | null>(null);

  const mine = useMyAssignmentsQuery(myId);
  const requests = useSwapRequestsQuery();
  const candidates = useSwapCandidatesQuery(giving ? Number(giving.id) : null);
  const { propose, approve, decline, cancel } = useSwapMutations();


  const swappable = (mine.data ?? []).filter(
    (a: Assignment) => a.status === 'pending' || a.status === 'confirmed'
  );

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">Shift swaps</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <h2 className="h6">Propose a swap</h2>
      <QueryState
        isLoading={mine.isLoading}
        isError={mine.isError}
        error={mine.error}
        onRetry={mine.refetch}
        isEmpty={swappable.length === 0}
        loadingMessage="Loading your shifts…"
        empty={<p className="text-muted">You have no shifts to swap.</p>}
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="swap-giving">The shift you would give up</label>
          <select
            id="swap-giving"
            className="form-select"
            value={giving ? String(giving.id) : ''}
            onChange={(e) =>
              setGiving(swappable.find((a) => String(a.id) === e.target.value) ?? null)
            }
          >
            <option value="">Choose one of your shifts…</option>
            {swappable.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {describe(a)} — {a.departmentName ?? ''}
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
          loadingMessage="Finding shifts you could swap for…"
          empty={
            <p className="text-muted">
              No shift can be swapped for this one — every candidate would leave someone working
              two shifts at once, or is outside the people you work with.
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
                  You take <strong>{describeCandidate(c)}</strong> ({c.departmentName}) —{' '}
                  {c.userName} takes <strong>{describe(giving)}</strong>
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
                  Propose
                </button>
              </li>
            ))}
          </ul>
          {candidates.data?.truncated && (
            <p className="text-muted small">
              Showing the first matches only — there may be more.
            </p>
          )}
        </QueryState>
      )}

      <h2 className="h6 mt-4">Swap requests</h2>
      <QueryState
        isLoading={requests.isLoading}
        isError={requests.isError}
        error={requests.error}
        onRetry={requests.refetch}
        isEmpty={(requests.data?.length ?? 0) === 0}
        loadingMessage="Loading swap requests…"
        empty={<p className="text-muted">No swap requests.</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Requester</th>
              <th>Other person</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(requests.data ?? []).map((r: ShiftSwapRequest) => {
              const isRequester = r.requesterUserId === myId;
              const isTarget = r.targetUserId === myId;
              return (
                <tr key={r.id}>
                  <td>{isRequester ? 'You' : r.requesterUserId}</td>
                  <td>{isTarget ? 'You' : r.targetUserId}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? 'bg-secondary'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="text-end">
                    {r.status === 'pending' && isRequester && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-2"
                        onClick={() => act(cancel.mutateAsync(r.id))}
                        disabled={cancel.isPending}
                      >
                        Withdraw
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
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => act(decline.mutateAsync({ id: r.id }))}
                          disabled={decline.isPending}
                        >
                          Decline
                        </button>
                      </>
                    )}
                    {/* Said plainly rather than left as an empty cell: the
                        target has no action because the model gives them
                        none, and a blank space would read as a page that
                        failed to load its buttons. */}
                    {r.status === 'pending' && isTarget && !canDecide && (
                      <span className="text-muted small">A manager decides this</span>
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
