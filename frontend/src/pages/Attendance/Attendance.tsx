/**
 * Attendance — clock-in/clock-out for the current user, plus an approval
 * queue and cost-estimate panel for users holding attendance.approve /
 * attendance.read (Manager/Administrator by default).
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { todayIso } from '../../utils/format';
import ExportCsvLink from '../../components/ExportCsvLink';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import ButtonSpinner from '../../components/ButtonSpinner';
import {
  useMyAttendanceQuery,
  usePendingAttendanceQuery,
  useAttendanceCostQuery,
  useAttendanceMutations,
} from '../../hooks/useAttendance';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
};

const formatDateTime = (value?: string | Date | null): string => {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
};


const Attendance: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canApprove = (user?.permissions ?? []).includes('attendance.approve');
  const canReadCost = (user?.permissions ?? []).includes('attendance.read');

  // One-off action error (a failed mutation), separate from a load error.
  const [actionError, setActionError] = useState<string | null>(null);

  // Server state via TanStack Query; queries are gated by permission so a
  // non-approver never fetches the queue and a non-cost-reader never fetches
  // the estimate. Mutations invalidate the attendance keys, so an action
  // refreshes exactly the affected lists.
  const userId = user?.id ? Number(user.id) : undefined;
  const recordsQuery = useMyAttendanceQuery(userId);
  const pendingQuery = usePendingAttendanceQuery(canApprove);
  const costQuery = useAttendanceCostQuery(canReadCost, todayIso(-30), todayIso());
  const { clockInMutation, clockOutMutation, decisionMutation } = useAttendanceMutations();

  const myRecords = recordsQuery.data ?? [];
  const pending = pendingQuery.data ?? [];
  const cost = costQuery.data ?? null;
  // 404 means the payroll module is disabled — a "panel not available" note, not a banner.
  const costError = costQuery.isError ? (costQuery.error as Error).message : null;
  const acting = clockInMutation.isPending || clockOutMutation.isPending || decisionMutation.isPending;

  const openRecord = myRecords.find((r) => !r.clockOut) ?? null;

  /**
   * Best-effort geolocation: if the browser or the user denies it, clock-in
   * still proceeds with no coordinates. Whether that's actually acceptable is
   * a server-side decision (AttendanceService.clockIn) based on whether the
   * caller's department has an active geofence — the client doesn't need to
   * know that in advance, it just sends what it has.
   */
  const getLocation = (): Promise<{ latitude: number; longitude: number } | undefined> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(undefined);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => resolve(undefined),
        { timeout: 5000 }
      );
    });

  const handleClockIn = async () => {
    setActionError(null);
    try {
      const location = await getLocation();
      await clockInMutation.mutateAsync(location);
    } catch (e) {
      setActionError((e as Error).message ?? t('attendance.clockInFailed'));
    }
  };

  const handleClockOut = async () => {
    if (!openRecord) return;
    setActionError(null);
    try {
      await clockOutMutation.mutateAsync(openRecord.id);
    } catch (e) {
      setActionError((e as Error).message ?? t('attendance.clockOutFailed'));
    }
  };

  const handleDecision = async (id: number | string, decision: 'approve' | 'reject') => {
    setActionError(null);
    try {
      await decisionMutation.mutateAsync({ id, decision });
    } catch (e) {
      setActionError((e as Error).message ?? t('attendance.actionFailed'));
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex justify-content-between align-items-start">
          <div>
            <h1 className="h3 mb-0">{t('attendance.title')}</h1>
            <p className="text-muted mb-0 small">{t('attendance.subtitle')}</p>
          </div>
          {/* An approver exports what their filters select; everyone else gets
              their own records, which the endpoint enforces rather than trusts. */}
          <ExportCsvLink path="/attendance/export" disabled={myRecords.length === 0} />
        </div>
      </div>

      {actionError && <ErrorAlert message={actionError} />}

      <div className="card mb-4">
        <div className="card-body d-flex align-items-center justify-content-between">
          <div>
            <div className="fw-semibold">{t('attendance.yourStatus')}</div>
            <div className="text-muted small">
              {openRecord ? t('attendance.clockedInAt', { time: formatDateTime(openRecord.clockIn) }) : t('attendance.notClockedIn')}
            </div>
          </div>
          <button
            className={`btn ${openRecord ? 'btn-danger' : 'btn-success'}`}
            onClick={openRecord ? handleClockOut : handleClockIn}
            disabled={acting}
          >
            {acting ? (
              <ButtonSpinner />
            ) : (
              <i className={`bi ${openRecord ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} me-1`} aria-hidden="true"></i>
            )}
            {openRecord ? t('attendance.clockOut') : t('attendance.clockIn')}
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">{t('attendance.recentPunches')}</div>
        <div className="card-body p-0">
          <QueryState
            isLoading={recordsQuery.isLoading}
            isError={recordsQuery.isError}
            error={recordsQuery.error}
            onRetry={() => recordsQuery.refetch()}
            isEmpty={myRecords.length === 0}
            empty={<div className="text-center text-muted py-4">{t('attendance.noRecords')}</div>}
          >
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">{t('attendance.columns.clockIn')}</th>
                    <th scope="col">{t('attendance.columns.clockOut')}</th>
                    <th scope="col">{t('attendance.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {myRecords.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{formatDateTime(r.clockIn)}</td>
                      <td className="small">{formatDateTime(r.clockOut)}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{t(`attendance.status.${r.status}`, r.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </div>
      </div>

      {canApprove && (
        <div className="card mb-4">
          <div className="card-header">{t('attendance.pendingApproval')}</div>
          <div className="card-body p-0">
            <QueryState
              isLoading={pendingQuery.isLoading}
              isError={pendingQuery.isError}
              error={pendingQuery.error}
              onRetry={() => pendingQuery.refetch()}
              isEmpty={pending.length === 0}
              empty={
                <div className="text-center text-muted py-4">
                  <i className="bi bi-inbox fs-3 d-block mb-2" aria-hidden="true"></i>{t('attendance.nothingWaiting')}
                </div>
              }
            >
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">{t('attendance.columns.userId')}</th>
                      <th scope="col">{t('attendance.columns.clockIn')}</th>
                      <th scope="col">{t('attendance.columns.clockOut')}</th>
                      <th scope="col" className="text-end">{t('attendance.columns.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.id}>
                        <td className="small text-muted">{r.userId}</td>
                        <td className="small">{formatDateTime(r.clockIn)}</td>
                        <td className="small">{formatDateTime(r.clockOut)}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-success me-1"
                            disabled={acting}
                            onClick={() => handleDecision(r.id, 'approve')}
                            aria-label={t('attendance.approveRecord', { id: r.id })}
                          >
                            <i className="bi bi-check" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={acting}
                            onClick={() => handleDecision(r.id, 'reject')}
                            aria-label={t('attendance.rejectRecord', { id: r.id })}
                          >
                            <i className="bi bi-x" aria-hidden="true"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </QueryState>
          </div>
        </div>
      )}

      {canReadCost && cost && !costError && (
        <div className="card">
          <div className="card-header">{t('attendance.laborCostTitle')}</div>
          <div className="card-body">
            <div className="row text-center">
              <div className="col">
                <div className="text-muted small">{t('attendance.planned')}</div>
                <div className="fs-4">{t('attendance.currencyAmount', { amount: cost.plannedCost.toFixed(2) })}</div>
                <div className="text-muted small">{t('attendance.hoursValue', { hours: cost.plannedHours.toFixed(1) })}</div>
              </div>
              <div className="col">
                <div className="text-muted small">{t('attendance.actualApproved')}</div>
                <div className="fs-4">{t('attendance.currencyAmount', { amount: cost.actualCost.toFixed(2) })}</div>
                <div className="text-muted small">{t('attendance.hoursValue', { hours: cost.actualHours.toFixed(1) })}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
