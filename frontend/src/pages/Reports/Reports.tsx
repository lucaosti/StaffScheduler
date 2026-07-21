/**
 * Reports Page Component (F08).
 *
 * Wires the reports API exposed by the backend (`/api/reports/*`):
 *   - hours-worked: total hours per user in a date range
 *   - cost-by-department: hours and labour cost rolled up by department
 *   - fairness: workload distribution stats for a selected schedule
 *
 * The user picks a date range; the first two reports refresh together.
 * The fairness section requires selecting a schedule.
 *
 * @author Luca Ostinelli
 */

import React, { useMemo, useState } from 'react';
import { formatCurrency } from '../../utils/format';
import { errorMessage } from '../../utils/notify';
import {
  useRangeReportsQuery,
  useReportSchedulesQuery,
  useFairnessQuery,
} from '../../hooks/useReports';

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoFirstOfMonth = (): string => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

const Reports: React.FC = () => {
  const [start, setStart] = useState(() => isoFirstOfMonth());
  const [end, setEnd] = useState(() => isoToday());
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);

  // Server state via TanStack Query: the range pair refetches when start/end
  // change; schedules load once; the fairness report is gated on a selection.
  const rangeQuery = useRangeReportsQuery(start, end);
  const schedulesQuery = useReportSchedulesQuery();
  const fairnessQuery = useFairnessQuery(selectedScheduleId);

  const hours = rangeQuery.data?.hours ?? [];
  const cost = useMemo(() => rangeQuery.data?.cost ?? [], [rangeQuery.data]);
  const loading = rangeQuery.isLoading || rangeQuery.isFetching;
  const error = rangeQuery.isError ? errorMessage(rangeQuery.error, 'Failed to load reports') : null;

  const schedules = schedulesQuery.data ?? [];
  const fairness = fairnessQuery.data ?? null;
  const fairnessLoading = selectedScheduleId !== null && fairnessQuery.isLoading;
  const fairnessError = fairnessQuery.isError
    ? errorMessage(fairnessQuery.error, 'Failed to load fairness report')
    : null;

  // Explicit "reload" from the form submit; the range query already reacts to
  // date changes, so this covers re-running with the same dates.
  const reload = () => rangeQuery.refetch();

  const totalCost = useMemo(() => cost.reduce((acc, r) => acc + (r.cost || 0), 0), [cost]);

  return (
    <div>
      <h1 className="h3 mb-4">Reports</h1>

      <form
        className="row g-2 mb-4 align-items-end"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <div className="col-md-3">
          <label htmlFor="rep-start" className="form-label">From</label>
          <input
            id="rep-start"
            type="date"
            className="form-control"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="col-md-3">
          <label htmlFor="rep-end" className="form-label">To</label>
          <input
            id="rep-end"
            type="date"
            className="form-control"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="col-md-3">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </form>

      {error && (
        <div className="alert alert-danger" role="alert">{error}</div>
      )}

      <div className="row g-4 mb-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">Hours worked by user</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col" className="text-end">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-muted">No data for this range.</td>
                    </tr>
                  ) : (
                    hours.map((row) => (
                      <tr key={row.userId}>
                        <td>{row.fullName}</td>
                        <td className="text-end">{row.hours.toFixed(1)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between">
              <span>Cost by department</span>
              <span className="text-muted">Total: {formatCurrency(totalCost)}</span>
            </div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">Department</th>
                    <th scope="col" className="text-end">Hours</th>
                    <th scope="col" className="text-end">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-muted">No data for this range.</td>
                    </tr>
                  ) : (
                    cost.map((row) => (
                      <tr key={row.departmentId}>
                        <td>{row.departmentName}</td>
                        <td className="text-end">{row.hours.toFixed(1)}</td>
                        <td className="text-end">{formatCurrency(row.cost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Fairness report */}
      <div className="card">
        <div className="card-header d-flex align-items-center gap-3">
          <span className="fw-semibold">Workload fairness by schedule</span>
          <select
            className="form-select form-select-sm w-auto"
            value={selectedScheduleId ?? ''}
            onChange={(e) =>
              setSelectedScheduleId(e.target.value ? Number(e.target.value) : null)
            }
            aria-label="Select schedule for fairness report"
          >
            <option value="">— select a schedule —</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {selectedScheduleId === null ? (
          <div className="card-body text-muted">
            Select a schedule above to see workload distribution statistics.
          </div>
        ) : fairnessLoading ? (
          <div className="card-body text-muted">Loading…</div>
        ) : fairnessError ? (
          <div className="card-body">
            <div className="alert alert-danger mb-0" role="alert">{fairnessError}</div>
          </div>
        ) : fairness && fairness.perUser.length === 0 ? (
          <div className="card-body text-muted">No assignments in this schedule yet.</div>
        ) : fairness ? (
          <div className="card-body">
            <div className="row g-3 mb-3">
              {[
                { label: 'Employees', value: fairness.stats.count },
                { label: 'Min hours', value: fairness.stats.min.toFixed(1) },
                { label: 'Max hours', value: fairness.stats.max.toFixed(1) },
                { label: 'Mean hours', value: fairness.stats.mean.toFixed(1) },
                { label: 'Std dev', value: fairness.stats.stddev.toFixed(2) },
              ].map(({ label, value }) => (
                <div key={label} className="col-auto">
                  <div className="border rounded p-2 text-center" style={{ minWidth: '90px' }}>
                    <div className="fw-semibold">{value}</div>
                    <small className="text-muted">{label}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col" className="text-end">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {fairness.perUser.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.fullName}</td>
                      <td className="text-end">{row.hours.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Reports;
