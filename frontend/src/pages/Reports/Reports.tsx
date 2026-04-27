/**
 * Reports Page Component (F08).
 *
 * Wires the reports API exposed by the backend (`/api/reports/*`):
 *   - hours-worked: total hours per user in a date range
 *   - cost-by-department: hours and labour cost rolled up by department
 *
 * The user picks a date range; both reports refresh together. Errors are
 * surfaced inline. Output is a couple of tables — sufficient as a v1 UI
 * on top of the API; richer charts can land later without changing the
 * service.
 *
 * @author Luca Ostinelli
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { hoursWorked, costByDepartment, HoursWorkedRow, CostByDepartmentRow } from '../../services/reportsService';
import { formatCurrency } from '../../utils/format';
import { errorMessage } from '../../utils/notify';

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoFirstOfMonth = (): string => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

const Reports: React.FC = () => {
  const [start, setStart] = useState(isoFirstOfMonth());
  const [end, setEnd] = useState(isoToday());
  const [hours, setHours] = useState<HoursWorkedRow[]>([]);
  const [cost, setCost] = useState<CostByDepartmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hoursRes, costRes] = await Promise.all([
        hoursWorked(start, end),
        costByDepartment(start, end),
      ]);
      if (hoursRes.success && hoursRes.data) setHours(hoursRes.data);
      if (costRes.success && costRes.data) setCost(costRes.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load reports'));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    reload();
  }, [reload]);

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

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">Hours worked by user</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th>User</th>
                    <th className="text-end">Hours</th>
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
                    <th>Department</th>
                    <th className="text-end">Hours</th>
                    <th className="text-end">Cost</th>
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
    </div>
  );
};

export default Reports;
