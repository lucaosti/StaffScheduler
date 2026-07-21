import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from './lib/queryClient';

// Layout Components
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import PermissionRoute from './components/Auth/PermissionRoute';
import ErrorBoundary from './components/ErrorBoundary';

// Eagerly loaded — these are tiny and always needed at first render
import Login from './pages/Auth/Login';

// Contexts
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { I18nProvider } from './i18n/I18nContext';

// Chrome
import DemoBanner from './components/DemoBanner';
import LoadingSpinner from './components/LoadingSpinner';

// Lazily loaded page components — split into separate chunks
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Employees = lazy(() => import('./pages/Employees/Employees'));
const Shifts = lazy(() => import('./pages/Shifts/Shifts'));
const Schedule = lazy(() => import('./pages/Schedule/Schedule'));
const Reports = lazy(() => import('./pages/Reports/Reports'));
const Settings = lazy(() => import('./pages/Settings/Settings'));
const OrgManagement = lazy(() => import('./pages/Org/OrgManagement'));
const Policies = lazy(() => import('./pages/Policies/Policies'));
const Governance = lazy(() => import('./pages/Governance/Governance'));
const OrgChart = lazy(() => import('./pages/OrgChart/OrgChart'));
const RaciMatrix = lazy(() => import('./pages/Governance/RaciMatrix'));
const PendingApprovals = lazy(() => import('./pages/Approvals/PendingApprovals'));
const ChangeRequests = lazy(() => import('./pages/ChangeRequests/ChangeRequests'));
const Delegations = lazy(() => import('./pages/Delegations/Delegations'));
const AuditLogs = lazy(() => import('./pages/Admin/AuditLogs'));
const ApprovalWorkflows = lazy(() => import('./pages/Admin/ApprovalWorkflows'));
const RbacManagement = lazy(() => import('./pages/Admin/RbacManagement'));
const Attendance = lazy(() => import('./pages/Attendance/Attendance'));

/**
 * Main Application Component
 * 
 * Defines the complete routing structure and provides authentication context.
 * Implements a nested routing pattern with protected routes.
 * 
 * Route Structure:
 * - /login: Public authentication page
 * - /: Protected layout with nested routes
 *   - /dashboard: Main overview and statistics
 *   - /employees: Employee management
 *   - /shifts: Shift templates and management
 *   - /schedule: Schedule generation and viewing
 *   - /reports: Analytics and reporting
 *   - /settings: Application configuration
 * 
 * @returns JSX element containing the complete application
 */
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
      <AuthProvider>
        <DemoBanner />
        <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
        <Routes>
        {/* Public Routes - Accessible without authentication */}
        <Route path="/login" element={<Login />} />
        
        {/* Protected Routes - Require authentication */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          {/* Default redirect to dashboard */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          
          {/* Main application pages */}
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="employees" element={
            <PermissionRoute permission="employee.read">
              <Employees />
            </PermissionRoute>
          } />
          <Route path="shifts" element={
            <PermissionRoute permission="shift.manage">
              <Shifts />
            </PermissionRoute>
          } />
          <Route path="schedule" element={
            <PermissionRoute permission="schedule.read">
              <Schedule />
            </PermissionRoute>
          } />
          <Route path="reports" element={
            <PermissionRoute permission="report.read">
              <Reports />
            </PermissionRoute>
          } />
          <Route path="org" element={
            <PermissionRoute permission="org_unit.read">
              <OrgManagement />
            </PermissionRoute>
          } />
          <Route path="policies" element={
            <PermissionRoute permission="policy.read">
              <Policies />
            </PermissionRoute>
          } />
          <Route path="governance" element={
            <PermissionRoute permission="responsibility.read">
              <Governance />
            </PermissionRoute>
          } />
          <Route path="admin/rbac" element={
            <PermissionRoute permission="role.manage">
              <RbacManagement />
            </PermissionRoute>
          } />
          <Route path="settings" element={
            <PermissionRoute permission="settings.manage">
              <Settings />
            </PermissionRoute>
          } />
          <Route path="org-chart" element={
            <PermissionRoute permission="org_unit.read">
              <OrgChart />
            </PermissionRoute>
          } />
          <Route path="governance/raci-matrix" element={
            <PermissionRoute permission="responsibility.read">
              <RaciMatrix />
            </PermissionRoute>
          } />
          <Route path="attendance" element={<Attendance />} />
          <Route path="approvals/pending" element={<PendingApprovals />} />
          <Route path="change-requests" element={<ChangeRequests />} />
          <Route path="delegations" element={
            <PermissionRoute permission="delegation.manage">
              <Delegations />
            </PermissionRoute>
          } />
          <Route path="admin/audit-logs" element={
            <PermissionRoute permission="audit.read">
              <AuditLogs />
            </PermissionRoute>
          } />
          <Route path="admin/approval-workflows" element={
            <PermissionRoute permission="approval.manage">
              <ApprovalWorkflows />
            </PermissionRoute>
          } />
        </Route>
        
          {/* Catch-all route - Redirect unknown paths to dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
