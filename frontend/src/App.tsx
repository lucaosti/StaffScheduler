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

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Layout Components
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';

// Page Components
import Login from './pages/Auth/Login';
import Dashboard from './pages/Dashboard/Dashboard';
import Employees from './pages/Employees/Employees';
import Shifts from './pages/Shifts/Shifts';
import Schedule from './pages/Schedule/Schedule';
import Reports from './pages/Reports/Reports';
import Settings from './pages/Settings/Settings';

// Contexts
import { AuthProvider } from './contexts/AuthContext';

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
    <AuthProvider>
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
          <Route path="employees" element={<Employees />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        
        {/* Catch-all route - Redirect unknown paths to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
