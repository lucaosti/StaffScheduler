/**
 * Role-based route guard.
 *
 * Wraps a route element and ensures the authenticated user has one of the
 * permitted roles. Unauthorized users are redirected to /dashboard. This is
 * a defence-in-depth layer on top of the backend's `requireRole` middleware:
 * the API still enforces RBAC, but we avoid showing pages the user cannot
 * use.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

type Role = 'admin' | 'manager' | 'employee';

interface RoleRouteProps {
  /** Roles that may render the children. */
  allowedRoles: Role[];
  /** Where to redirect unauthorized but authenticated users. */
  redirectTo?: string;
  children: React.ReactNode;
}

const RoleRoute: React.FC<RoleRouteProps> = ({
  allowedRoles,
  redirectTo = '/dashboard',
  children,
}) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: '50vh' }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user || !allowedRoles.includes(user.role as Role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};

export default RoleRoute;
