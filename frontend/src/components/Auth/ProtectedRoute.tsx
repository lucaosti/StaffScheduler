/**
 * Protected Route Component for Staff Scheduler
 * 
 * Provides route-level authentication protection by checking user
 * authentication status and redirecting unauthorized users to login.
 * 
 * Features:
 * - Authentication status verification
 * - Automatic redirection to login page
 * - Loading state handling during auth checks
 * - Location preservation for post-login redirect
 * - Bootstrap-styled loading spinner
 * 
 * @author Luca Ostinelli
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Props interface for ProtectedRoute component
 */
interface ProtectedRouteProps {
  /** Child components to render when user is authenticated */
  children: React.ReactNode;
}

/**
 * Protected route wrapper component that requires authentication
 * @param children - Components to render for authenticated users
 * @returns JSX element with protected content or login redirect
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page with return url
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
