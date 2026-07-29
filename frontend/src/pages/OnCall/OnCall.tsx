/**
 * On call — when I am on call, and who is on call.
 *
 * WHY BEING ON CALL IS NOT PRESENTED AS A SHIFT. A period is HELD, not worked:
 * the person is available, not at work, and the hours are not hours worked.
 * Showing it in the same shape as a shift would invite exactly that reading —
 * which is also why it is a separate source on the timeline rather than more
 * bars of the same colour.
 *
 * WHY THE STAFFING COUNT IS ON EVERY ROW. A period declares how many people it
 * needs, and the only question anyone asks of an on-call rota is whether it is
 * covered. A count someone has to open a period to see is a count nobody
 * checks.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import {
  useMyOnCallQuery,
  useOnCallPeriodsQuery,
  usePeriodAssignmentsQuery,
  useOnCallMutations,
} from '../../hooks/useOnCall';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import type { OnCallPeriod } from '../../services/onCallService';

const time = (value?: string): string => (value ? value.slice(0, 5) : '—');

const isoDay = (offset = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const OnCall: React.FC = () => {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canRead = permissions.includes('schedule.read');
  const canManage = permissions.includes('oncall.manage');

  const [from, setFrom] = useState(isoDay());
  const [to, setTo] = useState(isoDay(30));
  const [openPeriod, setOpenPeriod] = useState<OnCallPeriod | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const mine = useMyOnCallQuery({ start: from, end: to });
  // Gated on the permission rather than fetched and hidden: the rota is a
  // statement about where named colleagues have to be reachable.
  const periods = useOnCallPeriodsQuery({ start: from, end: to }, canRead);
  const assignments = usePeriodAssignmentsQuery(openPeriod ? openPeriod.id : null);
  // A numeric id field would be unusable. Anyone holding `oncall.manage` also
  // holds `employee.read` in the default roles, so the real list is available
  // — and it is only asked for while a period is open and the caller can
  // actually add someone to it.
  const employees = useEmployeesQuery('', '', canManage && openPeriod !== null);
  const { remove, assign, unassign } = useOnCallMutations();

  const act = async (run: Promise<unknown>) => {
    setMessage(null);
    try {
      await run;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The request failed');
    }
  };

  const coverage = (p: OnCallPeriod) => {
    const short = p.assignedCount < p.minStaff;
    return (
      <span className={short ? 'text-danger' : 'text-success'}>
        {p.assignedCount}/{p.minStaff}
        {short ? ' — short' : ''}
      </span>
    );
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">On call</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <div className="row g-2 align-items-end mb-3">
        <div className="col-auto">
          <label className="form-label" htmlFor="oncall-from">From</label>
          <input
            id="oncall-from"
            type="date"
            className="form-control"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="oncall-to">To</label>
          <input
            id="oncall-to"
            type="date"
            className="form-control"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <h2 className="h6">When I am on call</h2>
      <QueryState
        isLoading={mine.isLoading}
        isError={mine.isError}
        error={mine.error}
        onRetry={mine.refetch}
        isEmpty={(mine.data?.length ?? 0) === 0}
        loadingMessage="Loading your on-call periods…"
        empty={<p className="text-muted">You are not on call in this range.</p>}
      >
        <ul className="list-group mb-4">
          {(mine.data ?? []).map((p) => (
            <li key={p.id} className="list-group-item">
              {p.date} {time(p.startTime)}–{time(p.endTime)}
              {p.departmentName ? ` — ${p.departmentName}` : ''}
            </li>
          ))}
        </ul>
      </QueryState>

      {canRead && (
        <>
          <h2 className="h6">On-call periods</h2>
          <QueryState
            isLoading={periods.isLoading}
            isError={periods.isError}
            error={periods.error}
            onRetry={periods.refetch}
            isEmpty={(periods.data?.length ?? 0) === 0}
            loadingMessage="Loading periods…"
            empty={<p className="text-muted">No on-call periods in this range.</p>}
          >
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Hours</th>
                  <th>Department</th>
                  <th>Covered</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(periods.data ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.date}</td>
                    <td>
                      {time(p.startTime)}–{time(p.endTime)}
                    </td>
                    <td>{p.departmentName ?? p.departmentId}</td>
                    <td>{coverage(p)}</td>
                    <td>{p.status}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-2"
                        onClick={() => setOpenPeriod(openPeriod?.id === p.id ? null : p)}
                      >
                        Who
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => act(remove.mutateAsync(p.id))}
                          disabled={remove.isPending}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QueryState>
        </>
      )}

      {openPeriod && (
        <div className="card">
          <div className="card-header">
            Who is on call — {openPeriod.date} {time(openPeriod.startTime)}–
            {time(openPeriod.endTime)}
          </div>
          <div className="card-body">
            <QueryState
              isLoading={assignments.isLoading}
              isError={assignments.isError}
              error={assignments.error}
              onRetry={assignments.refetch}
              isEmpty={(assignments.data?.length ?? 0) === 0}
              loadingMessage="Loading…"
              empty={<p className="text-muted">Nobody is on call for this period.</p>}
            >
              <ul className="list-group mb-3">
                {(assignments.data ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="list-group-item d-flex justify-content-between align-items-center"
                  >
                    <span>
                      {a.userName ?? `User ${a.userId}`}{' '}
                      <span className="badge bg-light text-dark">{a.status}</span>
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() =>
                          act(unassign.mutateAsync({ id: openPeriod.id, userId: a.userId }))
                        }
                        disabled={unassign.isPending}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </QueryState>

            {canManage && (
              <form
                className="row g-2 align-items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    assign
                      .mutateAsync({ id: openPeriod.id, userId: Number(assignUserId) })
                      .then(() => setAssignUserId(''))
                  );
                }}
              >
                <div className="col-md-4">
                  <label className="form-label" htmlFor="oncall-user">Person</label>
                  <select
                    id="oncall-user"
                    className="form-select"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    required
                  >
                    <option value="">Choose someone…</option>
                    {(employees.data ?? []).map((e) => (
                      <option key={String(e.id)} value={String(e.id)}>
                        {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-primary" disabled={assign.isPending}>
                    Add to rota
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OnCall;
