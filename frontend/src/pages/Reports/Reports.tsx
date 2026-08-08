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
import { useTranslation } from 'react-i18next';
import { formatCurrency, todayIso, firstOfMonthIso } from '../../utils/format';
import BarChart from '../../components/BarChart';
import ExportCsvLink from '../../components/ExportCsvLink';
import { errorMessage } from '../../utils/notify';
import {
  useRangeReportsQuery,
  useReportSchedulesQuery,
  useFairnessQuery,
} from '../../hooks/useReports';


const Reports: React.FC = () => {
  const { t } = useTranslation();
  const [start, setStart] = useState(() => firstOfMonthIso());
  const [end, setEnd] = useState(() => todayIso());
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);

  // Server state via TanStack Query: the range pair refetches when start/end
  // change; schedules load once; the fairness report is gated on a selection.
  const rangeQuery = useRangeReportsQuery(start, end);
  const schedulesQuery = useReportSchedulesQuery();
  const fairnessQuery = useFairnessQuery(selectedScheduleId);

  const hours = rangeQuery.data?.hours ?? [];
  const cost = useMemo(() => rangeQuery.data?.cost ?? [], [rangeQuery.data]);
  const loading = rangeQuery.isLoading || rangeQuery.isFetching;
  const error = rangeQuery.isError ? errorMessage(rangeQuery.error, t('reports.loadFailed')) : null;

  const schedules = schedulesQuery.data ?? [];
  const fairness = fairnessQuery.data ?? null;
  const fairnessLoading = selectedScheduleId !== null && fairnessQuery.isLoading;
  const fairnessError = fairnessQuery.isError
    ? errorMessage(fairnessQuery.error, t('reports.fairness.loadFailed'))
    : null;

  // Explicit "reload" from the form submit; the range query already reacts to
  // date changes, so this covers re-running with the same dates.
  const reload = () => rangeQuery.refetch();

  const totalCost = useMemo(() => cost.reduce((acc, r) => acc + (r.cost || 0), 0), [cost]);

  return (
    <div>
      <h1 className="h3 mb-4">{t('reports.title')}</h1>

      <form
        className="row g-2 mb-4 align-items-end"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <div className="col-md-3">
          <label htmlFor="rep-start" className="form-label">{t('reports.from')}</label>
          <input
            id="rep-start"
            type="date"
            className="form-control"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="col-md-3">
          <label htmlFor="rep-end" className="form-label">{t('reports.to')}</label>
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
            {loading ? t('common.loading') : t('reports.refresh')}
          </button>
        </div>
      </form>

      {error && (
        <div className="alert alert-danger" role="alert">{error}</div>
      )}

      <div className="row g-4 mb-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>{t('reports.hoursByUser.title')}</span>
              {/* Carries the range currently on screen, so the file matches the
                  table rather than some server-side default. */}
              <ExportCsvLink
                path="/reports/hours-worked/export"
                params={{ startDate: start, endDate: end }}
                label={t('reports.csv')}
                disabled={hours.length === 0}
              />
            </div>
            {hours.length > 0 && (
              <div className="card-body pb-0">
                <BarChart
                  caption={t('reports.hoursByUser.chartCaption')}
                  data={[...hours]
                    // Sorted, because the question a ranking answers is "who is
                    // highest" — in source order the reader has to scan.
                    .sort((a, b) => b.hours - a.hours)
                    .map((row) => ({
                      label: row.fullName,
                      value: row.hours,
                      display: row.hours.toFixed(1),
                    }))}
                />
              </div>
            )}
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">{t('reports.columns.user')}</th>
                    <th scope="col" className="text-end">{t('reports.columns.hours')}</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-muted">{t('reports.noDataForRange')}</td>
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
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>{t('reports.costByDepartment.title')}</span>
              <span className="d-flex align-items-center gap-3">
                <span className="text-muted">{t('reports.costByDepartment.total', { amount: formatCurrency(totalCost) })}</span>
                <ExportCsvLink
                  path="/reports/cost-by-department/export"
                  params={{ startDate: start, endDate: end }}
                  label={t('reports.csv')}
                  disabled={cost.length === 0}
                />
              </span>
            </div>
            {cost.length > 0 && (
              <div className="card-body pb-0">
                <BarChart
                  caption={t('reports.costByDepartment.chartCaption')}
                  data={[...cost]
                    .sort((a, b) => b.cost - a.cost)
                    .map((row) => ({
                      label: row.departmentName,
                      value: row.cost,
                      display: formatCurrency(row.cost),
                    }))}
                />
              </div>
            )}
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">{t('reports.columns.department')}</th>
                    <th scope="col" className="text-end">{t('reports.columns.hours')}</th>
                    <th scope="col" className="text-end">{t('reports.columns.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-muted">{t('reports.noDataForRange')}</td>
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
          <span className="fw-semibold">{t('reports.fairness.title')}</span>
          <select
            className="form-select form-select-sm w-auto"
            value={selectedScheduleId ?? ''}
            onChange={(e) =>
              setSelectedScheduleId(e.target.value ? Number(e.target.value) : null)
            }
            aria-label={t('reports.fairness.selectAriaLabel')}
          >
            <option value="">{t('reports.fairness.selectPlaceholder')}</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedScheduleId !== null && (
            <ExportCsvLink
              path={`/reports/fairness/${selectedScheduleId}/export`}
              label={t('reports.csv')}
              className="btn btn-outline-secondary btn-sm ms-auto"
              disabled={!fairness || fairness.perUser.length === 0}
            />
          )}
        </div>

        {selectedScheduleId === null ? (
          <div className="card-body text-muted">
            {t('reports.fairness.selectPrompt')}
          </div>
        ) : fairnessLoading ? (
          <div className="card-body text-muted">{t('common.loading')}</div>
        ) : fairnessError ? (
          <div className="card-body">
            <div className="alert alert-danger mb-0" role="alert">{fairnessError}</div>
          </div>
        ) : fairness && fairness.perUser.length === 0 ? (
          <div className="card-body text-muted">{t('reports.fairness.noAssignments')}</div>
        ) : fairness ? (
          <div className="card-body">
            <div className="row g-3 mb-3">
              {[
                { label: t('reports.fairness.stats.employees'), value: fairness.stats.count },
                { label: t('reports.fairness.stats.minHours'), value: fairness.stats.min.toFixed(1) },
                { label: t('reports.fairness.stats.maxHours'), value: fairness.stats.max.toFixed(1) },
                { label: t('reports.fairness.stats.meanHours'), value: fairness.stats.mean.toFixed(1) },
                { label: t('reports.fairness.stats.stdDev'), value: fairness.stats.stddev.toFixed(2) },
              ].map(({ label, value }) => (
                <div key={label} className="col-auto">
                  <div className="border rounded p-2 text-center" style={{ minWidth: '90px' }}>
                    <div className="fw-semibold">{value}</div>
                    <small className="text-muted">{label}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-3">
              <BarChart
                caption={t('reports.fairness.chartCaption')}
                // The mean is drawn because fairness is read as distance from
                // it: a list of hours answers "how many", the line answers
                // "compared with whom", which is the actual question.
                reference={{
                  value: fairness.stats.mean,
                  label: t('reports.fairness.meanLabel', { hours: fairness.stats.mean.toFixed(1) }),
                }}
                data={[...fairness.perUser]
                  .sort((a, b) => b.hours - a.hours)
                  .map((row) => ({
                    label: row.fullName,
                    value: row.hours,
                    display: row.hours.toFixed(1),
                  }))}
              />
            </div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">{t('reports.columns.user')}</th>
                    <th scope="col" className="text-end">{t('reports.columns.hours')}</th>
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
