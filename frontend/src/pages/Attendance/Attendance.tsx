/**
 * Attendance — clock-in/clock-out for the current user, plus an approval
 * queue and cost-estimate panel for users holding attendance.approve /
 * attendance.read (Manager/Administrator by default).
 *
 * @author Luca Ostinelli
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { AttendanceRecord, AttendanceCostEstimate } from '../../types';
import {
  clockIn,
  clockOut,
  getAttendanceRecords,
  getPendingApprovals,
  approveAttendance,
  rejectAttendance,
  getCostEstimate,
} from '../../services/attendanceService';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
};

const formatDateTime = (value?: string | Date | null): string => {
  if (!value) return '—';
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const daysAgoIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const Attendance: React.FC = () => {
  const { user } = useAuth();
  const canApprove = (user?.permissions ?? []).includes('attendance.approve');
  const canReadCost = (user?.permissions ?? []).includes('attendance.read');

  const [myRecords, setMyRecords] = useState<AttendanceRecord[]>([]);
  const [pending, setPending] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const [cost, setCost] = useState<AttendanceCostEstimate | null>(null);
  const [costError, setCostError] = useState<string | null>(null);

  const openRecord = myRecords.find((r) => !r.clockOut) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mine = await getAttendanceRecords({ userId: user?.id ? Number(user.id) : undefined });
      setMyRecords(mine.data ?? []);
      if (canApprove) {
        const queue = await getPendingApprovals();
        setPending(queue.data ?? []);
      }
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load attendance records.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, canApprove]);

  const loadCost = useCallback(async () => {
    if (!canReadCost) return;
    setCostError(null);
    try {
      const res = await getCostEstimate({ startDate: daysAgoIso(30), endDate: todayIso() });
      setCost(res.data ?? null);
    } catch (e) {
      // 404 means the payroll module is disabled — treat as "panel not available", not an error banner.
      setCost(null);
      setCostError((e as Error).message ?? null);
    }
  }, [canReadCost]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCost(); }, [loadCost]);

  const handleClockIn = async () => {
    setActing(true);
    setError(null);
    try {
      await clockIn();
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Clock-in failed.');
    } finally {
      setActing(false);
    }
  };

  const handleClockOut = async () => {
    if (!openRecord) return;
    setActing(true);
    setError(null);
    try {
      await clockOut(openRecord.id);
      await load();
    } catch (e) {
      setError((e as Error).message ?? 'Clock-out failed.');
    } finally {
      setActing(false);
    }
  };

  const handleDecision = async (id: number | string, decision: 'approve' | 'reject') => {
    setActing(true);
    try {
      if (decision === 'approve') await approveAttendance(id);
      else await rejectAttendance(id);
      await load();
      await loadCost();
    } catch (e) {
      setError((e as Error).message ?? 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col">
          <h1 className="h3 mb-0">Attendance</h1>
          <p className="text-muted mb-0 small">Clock in and out; punches are reviewed before they count.</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body d-flex align-items-center justify-content-between">
          <div>
            <div className="fw-semibold">Your status</div>
            <div className="text-muted small">
              {openRecord ? `Clocked in at ${formatDateTime(openRecord.clockIn)}` : 'Not clocked in'}
            </div>
          </div>
          <button
            className={`btn ${openRecord ? 'btn-danger' : 'btn-success'}`}
            onClick={openRecord ? handleClockOut : handleClockIn}
            disabled={acting}
          >
            {acting ? (
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
            ) : (
              <i className={`bi ${openRecord ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} me-1`} aria-hidden="true"></i>
            )}
            {openRecord ? 'Clock out' : 'Clock in'}
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">Your recent punches</div>
        <div className="card-body p-0">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-4">
              <span className="spinner-border me-2" role="status" aria-label="Loading"></span>Loading…
            </div>
          ) : myRecords.length === 0 ? (
            <div className="text-center text-muted py-4">No attendance records yet.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Clock in</th>
                    <th scope="col">Clock out</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myRecords.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{formatDateTime(r.clockIn)}</td>
                      <td className="small">{formatDateTime(r.clockOut)}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {canApprove && (
        <div className="card mb-4">
          <div className="card-header">Pending approval</div>
          <div className="card-body p-0">
            {pending.length === 0 ? (
              <div className="text-center text-muted py-4">
                <i className="bi bi-inbox fs-3 d-block mb-2" aria-hidden="true"></i>Nothing waiting for review.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">User ID</th>
                      <th scope="col">Clock in</th>
                      <th scope="col">Clock out</th>
                      <th scope="col" className="text-end">Actions</th>
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
                            aria-label={`Approve record ${r.id}`}
                          >
                            <i className="bi bi-check" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={acting}
                            onClick={() => handleDecision(r.id, 'reject')}
                            aria-label={`Reject record ${r.id}`}
                          >
                            <i className="bi bi-x" aria-hidden="true"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {canReadCost && cost && !costError && (
        <div className="card">
          <div className="card-header">Labor cost — last 30 days</div>
          <div className="card-body">
            <div className="row text-center">
              <div className="col">
                <div className="text-muted small">Planned</div>
                <div className="fs-4">€{cost.plannedCost.toFixed(2)}</div>
                <div className="text-muted small">{cost.plannedHours.toFixed(1)} h</div>
              </div>
              <div className="col">
                <div className="text-muted small">Actual (approved)</div>
                <div className="fs-4">€{cost.actualCost.toFixed(2)}</div>
                <div className="text-muted small">{cost.actualHours.toFixed(1)} h</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
