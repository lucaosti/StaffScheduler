/**
 * Staff Scheduler Frontend Application
 * 
 * Main React application component that defines the routing structure and provides
 * global context for authentication and state management.
 * 
 * Features:
 * - Protected routes with authentication
 * - Role-based access control
 * - Responsive layout with sidebar navigation
 * - Modern React Router v6 implementation
 * - Context-based authentication state management
 * 
 * Architecture:
 * - Uses React Router for client-side routing
 * - AuthProvider wraps entire app for authentication context
 * - Layout component provides consistent UI structure
 * - ProtectedRoute guards private pages
 * 
 * @author Luca Ostinelli
 */

import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

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

// Lazily loaded page components — split into separate chunks
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Employees = lazy(() => import('./pages/Employees/Employees'));
const Shifts = lazy(() => import('./pages/Shifts/Shifts'));
const Schedule = lazy(() => import('./pages/Schedule/Schedule'));
const Reports = lazy(() => import('./pages/Reports/Reports'));
const Settings = lazy(() => import('./pages/Settings/Settings'));
const OrgManagement = lazy(() => import('./pages/Org/OrgManagement'));
const Policies = lazy(() => import('./pages/Policies/Policies'));

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
    <ThemeProvider>
      <I18nProvider>
      <AuthProvider>
        <DemoBanner />
        <ErrorBoundary>
        <Suspense fallback={null}>
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
          <Route path="settings" element={
            <PermissionRoute permission="settings.manage">
              <Settings />
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
  );
};

export default App;
