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

import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardStats, AuditLogEntry } from '../../types';
import { getDashboardStats, getRecentActivity } from '../../services/dashboardService';
import { formatCurrency, formatPercentage as fmtPct } from '../../utils/format';

/**
 * Dashboard component that displays the main overview of the scheduling system
 * @returns JSX element containing dashboard statistics and navigation
 */
const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const permissionDenied = (location.state as { permissionDenied?: boolean } | null)?.permissionDenied === true;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  /**
   * Loads dashboard statistics and metrics from backend services
   * Integrates with multiple APIs to provide comprehensive dashboard data
   */
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [dashboardResponse, activity] = await Promise.all([
        getDashboardStats(),
        getRecentActivity(5),
      ]);

      if (dashboardResponse.success && dashboardResponse.data) {
        setStats(dashboardResponse.data);
      } else {
        throw new Error('Failed to load dashboard statistics');
      }
      setRecentActivity(activity);
    } catch (err) {
      setError('Failed to load dashboard data. Please ensure the backend is running and database is populated.');
      
      // Set empty stats on error
      setStats({
        totalEmployees: 0,
        activeSchedules: 0,
        todayShifts: 0,
        pendingApprovals: 0,
        monthlyHours: 0,
        monthlyCost: 0,
        coverageRate: 0,
        employeeSatisfaction: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const formatPct = (value: number) => fmtPct(value / 100);

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-fluid py-4">
        <div className="alert alert-danger" role="alert">
          <h4 className="alert-heading">Error</h4>
          <p>{error}</p>
          <button className="btn btn-outline-danger" onClick={loadDashboardData}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* Permission denied banner — shown when redirected from a guarded route */}
      {permissionDenied && (
        <div className="alert alert-warning alert-dismissible fade show mb-4" role="alert">
          <i className="bi bi-shield-exclamation me-2"></i>
          <strong>Access denied.</strong> You do not have permission to view that page.
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="alert"
            aria-label="Close"
          ></button>
        </div>
      )}

      {/* Header */}
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">Dashboard</h1>
              <p className="text-muted mb-0">
                Welcome back, {user?.email}! Here's what's happening today.
              </p>
            </div>
            <div className="text-end">
              <small className="text-muted">
                Last updated: {new Date().toLocaleTimeString()}
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
                      <i className="bi bi-people fs-4 text-primary"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">Total Employees</h6>
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
                      <i className="bi bi-calendar3 fs-4 text-success"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">Active Schedules</h6>
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
                      <i className="bi bi-clock fs-4 text-info"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">Today's Shifts</h6>
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
                      <i className="bi bi-exclamation-triangle fs-4 text-warning"></i>
                    </div>
                  </div>
                  <div className="flex-grow-1 ms-3">
                    <h6 className="card-title text-muted mb-1">Pending Approvals</h6>
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
                <h6 className="card-title text-muted mb-3">Monthly Hours</h6>
                <h2 className="text-primary mb-0">{stats.monthlyHours.toLocaleString()}</h2>
                <small className="text-muted">hours scheduled</small>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">Monthly Cost</h6>
                <h2 className="text-success mb-0">{formatCurrency(stats.monthlyCost)}</h2>
                <small className="text-muted">labor costs</small>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">Coverage Rate</h6>
                <h2 className="text-info mb-0">{formatPct(stats.coverageRate)}</h2>
                <small className="text-muted">shifts covered</small>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">Employee Satisfaction</h6>
                <h2 className="text-warning mb-0">{formatPct(stats.employeeSatisfaction)}</h2>
                <small className="text-muted">satisfaction rate</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="row g-4 mb-4">
        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-transparent border-bottom">
              <h5 className="card-title mb-0">Quick Actions</h5>
            </div>
            <div className="card-body">
              <div className="d-grid gap-3">
                <button className="btn btn-outline-primary text-start">
                  <i className="bi bi-plus-circle me-2"></i>
                  Create New Shift
                </button>
                <button className="btn btn-outline-success text-start">
                  <i className="bi bi-person-plus me-2"></i>
                  Add Employee
                </button>
                <button className="btn btn-outline-info text-start">
                  <i className="bi bi-calendar-plus me-2"></i>
                  Generate Schedule
                </button>
                <button className="btn btn-outline-warning text-start">
                  <i className="bi bi-graph-up me-2"></i>
                  View Reports
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-transparent border-bottom">
              <h5 className="card-title mb-0">Recent Activity</h5>
            </div>
            <div className="card-body p-0">
              {recentActivity.length === 0 ? (
                <div className="d-flex align-items-center justify-content-center text-center py-5 text-muted">
                  <div>
                    <i className="bi bi-clock-history fs-3 mb-2 d-block"></i>
                    <p className="mb-0">No recent activity.</p>
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
    </div>
  );
};

export default Dashboard;
