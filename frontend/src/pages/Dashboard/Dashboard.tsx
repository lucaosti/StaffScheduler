/**
 * Dashboard Component for Staff Scheduler
 * 
 * Main overview page that displays key metrics, statistics, and quick actions
 * for staff scheduling management. Provides a comprehensive view of current
 * operational status and performance indicators.
 * 
 * Features:
 * - Real-time statistics display
 * - Employee metrics and analytics
 * - Schedule status overview
 * - Quick action buttons for common tasks
 * - Responsive grid layout for cards
 * - Error handling and loading states
 * 
 * Statistics Displayed:
 * - Total employees and active schedules
 * - Today's shifts and pending approvals
 * - Monthly hours and cost tracking
 * - Coverage rates and satisfaction metrics
 * 
 * @author Luca Ostinelli
 */

import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatPercentage as fmtPct, formatTime } from '../../utils/format';
import { useDashboardData, useAttentionItems } from '../../hooks/useDashboard';
import QueryState from '../../components/QueryState';

/**
 * Dashboard component that displays the main overview of the scheduling system
 * @returns JSX element containing dashboard statistics and navigation
 */
const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const permissionDenied = (location.state as { permissionDenied?: boolean } | null)?.permissionDenied === true;

  // Server state (stats + recent activity) is owned by TanStack Query; the retry
  // button calls refetch() directly instead of a hand-written reload.
  const dashboardQuery = useDashboardData();
  const stats = dashboardQuery.data?.stats ?? null;
  const recentActivity = dashboardQuery.data?.recentActivity ?? [];

  // Kept off the main loading/error gate above: a slow or failed attention-items
  // fetch should not block the stat cards, which is what one combined query would do.
  const attentionQuery = useAttentionItems();
  const attention = attentionQuery.data ?? null;

  const formatPct = (value: number) => fmtPct(value / 100);

  return (
    <div className="container-fluid py-4">
      {/* Permission denied banner — shown when redirected from a guarded route */}
      {permissionDenied && (
        <div className="alert alert-warning alert-dismissible fade show mb-4" role="alert">
          <i className="bi bi-shield-exclamation me-2" aria-hidden="true"></i>
          <strong>{t('dashboard.accessDeniedTitle')}</strong> {t('dashboard.accessDeniedBody')}
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="alert"
            aria-label={t('common.close')}
          ></button>
        </div>
      )}

      <QueryState
        isLoading={dashboardQuery.isLoading}
        isError={dashboardQuery.isError}
        error={dashboardQuery.isError ? t('dashboard.errorBody') : null}
        onRetry={() => dashboardQuery.refetch()}
        loadingMessage={t('dashboard.loading')}
      >
      {/* Header */}
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">{t('dashboard.title')}</h1>
              <p className="text-muted mb-0">
                {t('dashboard.welcome', { email: user?.email })}
              </p>
            </div>
            <div className="text-end">
              <small className="text-muted">
                {t('dashboard.lastUpdated', { time: new Date().toLocaleTimeString() })}
              </small>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="row g-4 mb-4">
          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <div className="bg-primary bg-opacity-10 rounded-3 p-3">
                      <i className="bi bi-people fs-4 text-primary" aria-hidden="true"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">{t('dashboard.stats.totalEmployees')}</h6>
                    <h3 className="mb-0">{stats.totalEmployees.toLocaleString()}</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <div className="bg-success bg-opacity-10 rounded-3 p-3">
                      <i className="bi bi-calendar3 fs-4 text-success" aria-hidden="true"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">{t('dashboard.stats.activeSchedules')}</h6>
                    <h3 className="mb-0">{stats.activeSchedules}</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <div className="bg-info bg-opacity-10 rounded-3 p-3">
                      <i className="bi bi-clock fs-4 text-info" aria-hidden="true"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">{t('dashboard.stats.todayShifts')}</h6>
                    <h3 className="mb-0">{stats.todayShifts}</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <div className="bg-warning bg-opacity-10 rounded-3 p-3">
                      <i className="bi bi-exclamation-triangle fs-4 text-warning" aria-hidden="true"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">{t('dashboard.stats.pendingApprovals')}</h6>
                    <h3 className="mb-0">{stats.pendingApprovals}</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Secondary Stats */}
      {stats && (
        <div className="row g-4 mb-4">
          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">{t('dashboard.stats.monthlyHours')}</h6>
                <h2 className="text-primary mb-0">{stats.monthlyHours.toLocaleString()}</h2>
                <small className="text-muted">{t('dashboard.stats.monthlyHoursUnit')}</small>
              </div>
            </div>
          </div>

          {/* Labor cost requires report.read; the backend sends null otherwise. */}
          {stats.monthlyCost !== null && (
            <div className="col-xl-3 col-md-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body text-center">
                  <h6 className="card-title text-muted mb-3">{t('dashboard.stats.monthlyCost')}</h6>
                  <h2 className="text-success mb-0">{formatCurrency(stats.monthlyCost)}</h2>
                  <small className="text-muted">{t('dashboard.stats.monthlyCostUnit')}</small>
                  {/* The admin-set target, when one has been configured for the
                      current period; absent (null) plans render nothing rather
                      than a misleading "0" target. */}
                  {stats.monthlyCostPlan !== null && stats.monthlyCostPlan > 0 && (
                    <div className="mt-2">
                      <small className="text-muted d-block">
                        {t('dashboard.stats.monthlyCostPlanTarget', {
                          amount: formatCurrency(stats.monthlyCostPlan),
                        })}
                      </small>
                      <small className={stats.monthlyCost > stats.monthlyCostPlan ? 'text-danger' : 'text-success'}>
                        {stats.monthlyCost > stats.monthlyCostPlan
                          ? t('dashboard.stats.monthlyCostPlanOverTarget', {
                              amount: formatCurrency(stats.monthlyCost - stats.monthlyCostPlan),
                            })
                          : t('dashboard.stats.monthlyCostPlanUnderTarget', {
                              amount: formatCurrency(stats.monthlyCostPlan - stats.monthlyCost),
                            })}
                      </small>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">{t('dashboard.stats.coverageRate')}</h6>
                <h2 className="text-info mb-0">{formatPct(stats.coverageRate)}</h2>
                <small className="text-muted">{t('dashboard.stats.coverageRateUnit')}</small>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">{t('dashboard.stats.employeeSatisfaction')}</h6>
                <h2 className="text-warning mb-0">{formatPct(stats.employeeSatisfaction)}</h2>
                <small className="text-muted">{t('dashboard.stats.employeeSatisfactionUnit')}</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attention items — a shortlist, not a report; see /api/reports and
          /shifts for the full picture behind each one. */}
      {attention && (attention.understaffedShifts.count > 0 || attention.pendingApprovalsAging.count > 0) && (
        <div className="row g-4 mb-4">
          {attention.understaffedShifts.count > 0 && (
            <div className="col-md-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header bg-transparent border-bottom d-flex justify-content-between align-items-center">
                  <h5 className="card-title mb-0">{t('dashboard.attention.understaffedShifts')}</h5>
                  <span className="badge bg-warning text-dark">{attention.understaffedShifts.count}</span>
                </div>
                <div className="card-body p-0">
                  <ul className="list-group list-group-flush">
                    {attention.understaffedShifts.items.map((s) => (
                      <li key={s.id} className="list-group-item px-3 py-2 d-flex justify-content-between">
                        <span>
                          {t('dashboard.attention.shiftSummary', {
                            date: s.date,
                            start: formatTime(s.startTime),
                            end: formatTime(s.endTime),
                            department: s.departmentName,
                          })}
                        </span>
                        <span className="text-danger text-nowrap ms-2">
                          {t('dashboard.attention.staffed', { assigned: s.assignedStaff, min: s.minStaff })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {attention.understaffedShifts.truncated && (
                    <p className="text-muted small px-3 py-2 mb-0">{t('dashboard.attention.moreThanShown')}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {attention.pendingApprovalsAging.count > 0 && (
            <div className="col-md-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header bg-transparent border-bottom d-flex justify-content-between align-items-center">
                  <h5 className="card-title mb-0">{t('dashboard.attention.pendingApprovalsAging')}</h5>
                  <span className="badge bg-warning text-dark">{attention.pendingApprovalsAging.count}</span>
                </div>
                <div className="card-body">
                  <div className="d-flex gap-3 mb-3 small text-muted">
                    <span>{t('dashboard.attention.overDay')} <strong className="text-body">{attention.pendingApprovalsAging.overDay}</strong></span>
                    <span>{t('dashboard.attention.overTwoDays')} <strong className="text-body">{attention.pendingApprovalsAging.overTwoDays}</strong></span>
                    <span>{t('dashboard.attention.overWeek')} <strong className="text-body">{attention.pendingApprovalsAging.overWeek}</strong></span>
                  </div>
                </div>
                <ul className="list-group list-group-flush">
                  {attention.pendingApprovalsAging.items.map((p) => (
                    <li key={p.id} className="list-group-item px-3 py-2 d-flex justify-content-between">
                      <span>{p.changeType}</span>
                      <span className="text-muted small text-nowrap ms-2">
                        {p.ageHours < 24
                          ? t('dashboard.attention.waitingHours', { count: p.ageHours })
                          : t('dashboard.attention.waitingDays', { count: Math.floor(p.ageHours / 24) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="row g-4 mb-4">
        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-transparent border-bottom">
              <h5 className="card-title mb-0">{t('dashboard.quickActions.title')}</h5>
            </div>
            <div className="card-body">
              <div className="d-grid gap-3">
                {user?.permissions?.includes('shift.manage') && (
                  <Link to="/shifts" className="btn btn-outline-primary text-start">
                    <i className="bi bi-plus-circle me-2" aria-hidden="true"></i>
                    {t('dashboard.quickActions.createShift')}
                  </Link>
                )}
                {user?.permissions?.includes('employee.read') && (
                  <Link to="/employees" className="btn btn-outline-success text-start">
                    <i className="bi bi-person-plus me-2" aria-hidden="true"></i>
                    {t('dashboard.quickActions.addEmployee')}
                  </Link>
                )}
                {user?.permissions?.includes('schedule.read') && (
                  <Link to="/schedule" className="btn btn-outline-info text-start">
                    <i className="bi bi-calendar-plus me-2" aria-hidden="true"></i>
                    {t('dashboard.quickActions.generateSchedule')}
                  </Link>
                )}
                {user?.permissions?.includes('report.read') && (
                  <Link to="/reports" className="btn btn-outline-warning text-start">
                    <i className="bi bi-graph-up me-2" aria-hidden="true"></i>
                    {t('dashboard.quickActions.viewReports')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-transparent border-bottom">
              <h5 className="card-title mb-0">{t('dashboard.recentActivity.title')}</h5>
            </div>
            <div className="card-body p-0">
              {recentActivity.length === 0 ? (
                <div className="d-flex align-items-center justify-content-center text-center py-5 text-muted">
                  <div>
                    <i className="bi bi-clock-history fs-3 mb-2 d-block" aria-hidden="true"></i>
                    <p className="mb-0">{t('dashboard.recentActivity.empty')}</p>
                  </div>
                </div>
              ) : (
                <ul className="list-group list-group-flush">
                  {recentActivity.map((entry) => (
                    <li key={entry.id} className="list-group-item px-3 py-2">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <span className="badge bg-secondary me-2">{entry.entityType}</span>
                          <small>{entry.description ?? entry.action}</small>
                        </div>
                        <small className="text-muted text-nowrap ms-2">
                          {new Date(entry.createdAt).toLocaleString()}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      </QueryState>
    </div>
  );
};

export default Dashboard;
