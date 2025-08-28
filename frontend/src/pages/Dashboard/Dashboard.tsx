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
import { useAuth } from '../../contexts/AuthContext';
import { DashboardStats } from '../../types';

/**
 * Dashboard component that displays the main overview of the scheduling system
 * @returns JSX element containing dashboard statistics and navigation
 */
const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  /**
   * Loads dashboard statistics and metrics
   * Currently uses mock data until backend endpoints are implemented
   */
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // For now, we'll use mock data since the backend dashboard endpoints aren't implemented yet
      const mockStats: DashboardStats = {
        totalEmployees: 142,
        activeSchedules: 8,
        todayShifts: 24,
        pendingApprovals: 6,
        monthlyHours: 3248,
        monthlyCost: 48720,
        coverageRate: 92.5,
        employeeSatisfaction: 87.2
      };
      
      setStats(mockStats);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

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
                <h2 className="text-info mb-0">{formatPercentage(stats.coverageRate)}</h2>
                <small className="text-muted">shifts covered</small>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body text-center">
                <h6 className="card-title text-muted mb-3">Employee Satisfaction</h6>
                <h2 className="text-warning mb-0">{formatPercentage(stats.employeeSatisfaction)}</h2>
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
            <div className="card-body">
              <div className="list-group list-group-flush">
                <div className="list-group-item px-0 border-0">
                  <div className="d-flex align-items-center">
                    <div className="bg-success bg-opacity-10 rounded-circle p-2 me-3">
                      <i className="bi bi-check-circle text-success"></i>
                    </div>
                    <div className="flex-grow-1">
                      <h6 className="mb-1">Schedule published</h6>
                      <small className="text-muted">Week of March 15-21</small>
                    </div>
                    <small className="text-muted">2h ago</small>
                  </div>
                </div>
                <div className="list-group-item px-0 border-0">
                  <div className="d-flex align-items-center">
                    <div className="bg-primary bg-opacity-10 rounded-circle p-2 me-3">
                      <i className="bi bi-person-plus text-primary"></i>
                    </div>
                    <div className="flex-grow-1">
                      <h6 className="mb-1">New employee added</h6>
                      <small className="text-muted">Sarah Johnson - Nurse</small>
                    </div>
                    <small className="text-muted">4h ago</small>
                  </div>
                </div>
                <div className="list-group-item px-0 border-0">
                  <div className="d-flex align-items-center">
                    <div className="bg-warning bg-opacity-10 rounded-circle p-2 me-3">
                      <i className="bi bi-exclamation-triangle text-warning"></i>
                    </div>
                    <div className="flex-grow-1">
                      <h6 className="mb-1">Shift needs approval</h6>
                      <small className="text-muted">Night shift - ICU</small>
                    </div>
                    <small className="text-muted">6h ago</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
