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
import { useTranslation } from 'react-i18next';
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
import { formatTime, todayIso } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';



const OnCall: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const permissions = user?.permissions ?? [];
  const canRead = permissions.includes('schedule.read');
  const canManage = permissions.includes('oncall.manage');

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso(30));
  const [openPeriod, setOpenPeriod] = useState<OnCallPeriod | null>(null);
  const [assignUserId, setAssignUserId] = useState('');

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


  const coverage = (p: OnCallPeriod) => {
    const short = p.assignedCount < p.minStaff;
    return (
      <span className={short ? 'text-danger' : 'text-success'}>
        {p.assignedCount}/{p.minStaff}
        {short ? ` — ${t('onCall.short')}` : ''}
      </span>
    );
  };

  return (
    <div className="container-fluid py-3 oncall-page">
      <h1 className="h4 mb-3">{t('onCall.title')}</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <div className="row g-2 align-items-end mb-3">
        <div className="col-auto">
          <label className="form-label" htmlFor="oncall-from">{t('onCall.from')}</label>
          <input
            id="oncall-from"
            type="date"
            className="form-control"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="col-auto">
          <label className="form-label" htmlFor="oncall-to">{t('onCall.to')}</label>
          <input
            id="oncall-to"
            type="date"
            className="form-control"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <h2 className="h6">{t('onCall.whenIAmOnCall')}</h2>
      <QueryState
        isLoading={mine.isLoading}
        isError={mine.isError}
        error={mine.error}
        onRetry={mine.refetch}
        isEmpty={(mine.data?.length ?? 0) === 0}
        loadingMessage={t('onCall.loadingMine')}
        empty={<p className="text-muted">{t('onCall.emptyMine')}</p>}
      >
        <ul className="list-group mb-4">
          {(mine.data ?? []).map((p) => (
            <li key={p.id} className="list-group-item">
              {p.date} {t('common.timeRange', { start: shiftTime(p.startTime), end: shiftTime(p.endTime) })}
              {p.departmentName ? t('onCall.departmentSuffix', { department: p.departmentName }) : ''}
            </li>
          ))}
        </ul>
      </QueryState>

      {canRead && (
        <>
          <h2 className="h6">{t('onCall.periodsTitle')}</h2>
          <QueryState
            isLoading={periods.isLoading}
            isError={periods.isError}
            error={periods.error}
            onRetry={periods.refetch}
            isEmpty={(periods.data?.length ?? 0) === 0}
            loadingMessage={t('onCall.loadingPeriods')}
            empty={<p className="text-muted">{t('onCall.emptyPeriods')}</p>}
          >
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>{t('onCall.columns.date')}</th>
                    <th>{t('onCall.columns.hours')}</th>
                    <th>{t('onCall.columns.department')}</th>
                    <th>{t('onCall.columns.covered')}</th>
                    <th>{t('onCall.columns.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(periods.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>{p.date}</td>
                      <td>
                        {t('common.timeRange', { start: shiftTime(p.startTime), end: shiftTime(p.endTime) })}
                      </td>
                      <td>{p.departmentName ?? p.departmentId}</td>
                      <td>{coverage(p)}</td>
                      <td>{p.status}</td>
                      <td className="text-end">
                        <div className="d-flex flex-wrap justify-content-end gap-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => setOpenPeriod(openPeriod?.id === p.id ? null : p)}
                          >
                            {t('onCall.who')}
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => act(remove.mutateAsync(p.id))}
                              disabled={remove.isPending}
                            >
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </>
      )}

      {openPeriod && (
        <div className="card">
          <div className="card-header">
            {t('onCall.whoIsOnCall', {
              date: openPeriod.date,
              start: shiftTime(openPeriod.startTime),
              end: shiftTime(openPeriod.endTime),
            })}
          </div>
          <div className="card-body">
            <QueryState
              isLoading={assignments.isLoading}
              isError={assignments.isError}
              error={assignments.error}
              onRetry={assignments.refetch}
              isEmpty={(assignments.data?.length ?? 0) === 0}
              loadingMessage={t('common.loading')}
              empty={<p className="text-muted">{t('onCall.emptyAssignments')}</p>}
            >
              <ul className="list-group mb-3">
                {(assignments.data ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2"
                  >
                    <span>
                      {a.userName ?? t('onCall.userFallback', { id: a.userId })}{' '}
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
                        {t('onCall.remove')}
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
                  <label className="form-label" htmlFor="oncall-user">{t('onCall.person')}</label>
                  <select
                    id="oncall-user"
                    className="form-select"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    required
                  >
                    <option value="">{t('onCall.chooseSomeone')}</option>
                    {(employees.data ?? []).map((e) => (
                      <option key={String(e.id)} value={String(e.id)}>
                        {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-primary" disabled={assign.isPending}>
                    {t('onCall.addToRota')}
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
