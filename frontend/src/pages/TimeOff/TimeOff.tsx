/**
 * Time off — requesting leave, and deciding other people's requests.
 *
 * WHY BOTH ON ONE PAGE. A manager is also a person who takes leave, and
 * splitting the two would mean they visit one screen to ask and another to
 * answer. The queue is simply absent for someone without `timeoff.approve`,
 * so the page is the whole feature for them rather than a stripped version of
 * a manager's page.
 *
 * WHY "REFLECTED IN THE SCHEDULE" IS SHOWN. An approved request is not yet
 * time off: approval writes an unavailability row, and only a schedule
 * generated afterwards actually leaves the person free. `unavailabilityId` is
 * the server's record of that having happened, and showing it is the
 * difference between "approved" and "you are actually off" — the one thing
 * someone reading this page most needs to be sure of before making plans.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useTimeOffQuery, useTimeOffMutations } from '../../hooks/useTimeOff';
import type { TimeOffRequest } from '../../types';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { todayIso } from '../../utils/format';
import ExportCsvLink from '../../components/ExportCsvLink';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  cancelled: 'bg-secondary',
};

const TYPES = ['vacation', 'sick', 'personal', 'other'] as const;


const TimeOff: React.FC = () => {
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const canApprove = (user?.permissions ?? []).includes('timeoff.approve');

  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [type, setType] = useState<string>('vacation');
  const [reason, setReason] = useState('');

  const mine = useTimeOffQuery(user?.id ? { userId: Number(user.id) } : {});
  // Only asked for by someone who can act on it: a queue nobody may decide is
  // a list of other people's private business.
  const queue = useTimeOffQuery({ status: 'pending' }, canApprove);
  const { request, approve, reject, cancel } = useTimeOffMutations();


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(
      request.mutateAsync({ startDate, endDate, type, reason: reason || undefined }).then(() => {
        setReason('');
      })
    );
  };

  const period = (r: TimeOffRequest): string =>
    r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Time off</h1>
        <ExportCsvLink path="/time-off/export" disabled={(mine.data?.length ?? 0) === 0} />
      </div>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <form className="row g-2 align-items-end mb-4" onSubmit={submit}>
        <div className="col-auto">
          <label className="form-label" htmlFor="timeoff-from">From</label>
          <input
            id="timeoff-from"
            type="date"
            className="form-control"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="timeoff-to">To</label>
          <input
            id="timeoff-to"
            type="date"
            className="form-control"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="timeoff-type">Type</label>
          <select
            id="timeoff-type"
            className="form-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="col-md-4">
          <label className="form-label" htmlFor="timeoff-reason">Reason (optional)</label>
          <input
            id="timeoff-reason"
            className="form-control"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <button type="submit" className="btn btn-primary" disabled={request.isPending}>
            Request
          </button>
        </div>
      </form>

      <h2 className="h6">My requests</h2>
      <QueryState
        isLoading={mine.isLoading}
        isError={mine.isError}
        error={mine.error}
        onRetry={mine.refetch}
        isEmpty={(mine.data?.length ?? 0) === 0}
        loadingMessage="Loading your requests…"
        empty={<p className="text-muted">You have no time-off requests.</p>}
      >
        <table className="table table-sm align-middle mb-4">
          <thead>
            <tr>
              <th>Period</th>
              <th>Type</th>
              <th>Status</th>
              <th>In the schedule</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(mine.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{period(r)}</td>
                <td>{r.type}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? 'bg-secondary'}`}>
                    {r.status}
                  </span>
                </td>
                <td>
                  {/* Approved is not the same as off. Approval writes an
                      unavailability row; until it exists, the optimizer has
                      never been told. */}
                  {r.status !== 'approved' ? (
                    <span className="text-muted">—</span>
                  ) : r.unavailabilityId ? (
                    <span className="text-success">Recorded</span>
                  ) : (
                    <span className="text-warning">Not yet recorded</span>
                  )}
                </td>
                <td className="text-end">
                  {r.status === 'pending' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => act(cancel.mutateAsync(r.id))}
                      disabled={cancel.isPending}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>

      {canApprove && (
        <>
          <h2 className="h6">Awaiting a decision</h2>
          <QueryState
            isLoading={queue.isLoading}
            isError={queue.isError}
            error={queue.error}
            onRetry={queue.refetch}
            isEmpty={(queue.data?.length ?? 0) === 0}
            loadingMessage="Loading the queue…"
            empty={<p className="text-muted">Nothing is waiting for a decision.</p>}
          >
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Period</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(queue.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{r.userId}</td>
                    <td>{period(r)}</td>
                    <td>{r.type}</td>
                    <td className="text-muted">{r.reason ?? '—'}</td>
                    <td className="text-end">
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
                        onClick={() => act(reject.mutateAsync({ id: r.id }))}
                        disabled={reject.isPending}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QueryState>
        </>
      )}
    </div>
  );
};

export default TimeOff;
