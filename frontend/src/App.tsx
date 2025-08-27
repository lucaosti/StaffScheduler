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

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        
        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="employees" element={<Employees />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        
        {/* Catch all route */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
