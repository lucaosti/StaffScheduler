/**
 * Permission-Gated Route Component for Staff Scheduler
 *
 * Extends authentication protection with per-permission route guards.
 * Authenticated users who lack the required permission are redirected
 * to the dashboard instead of seeing the page.
 *
 * Fail-open policy: if user.permissions is undefined or empty the guard
 * treats the user as having access, preserving backward compatibility with
 * accounts that pre-date the RBAC system.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import ProtectedRoute from './ProtectedRoute';

/**
 * Props interface for PermissionRoute component
 */
interface PermissionRouteProps {
  /** Child components to render when the user holds the required permission */
  children: React.ReactNode;
  /** Permission code that must be present in user.permissions */
  permission: string;
}

/**
 * Returns true when the user holds the given permission or when the
 * permissions array is absent / empty (fail-open for backward compat).
 */
function hasPermission(
  permissions: string[] | undefined,
  permission: string
): boolean {
  if (!permissions || permissions.length === 0) {
    return true;
  }
  return permissions.includes(permission);
}

/**
 * Route wrapper that requires both authentication and a specific permission.
 * Authentication is delegated to ProtectedRoute; this component only adds
 * the permission check on top.
 *
 * @param children   - Components to render when access is granted
 * @param permission - Permission code to check against user.permissions
 */
const PermissionRoute: React.FC<PermissionRouteProps> = ({
  children,
  permission,
}) => {
  const { user } = useAuth();
  const location = useLocation();

  return (
    <ProtectedRoute>
      {hasPermission(user?.permissions, permission) ? (
        <>{children}</>
      ) : (
        <Navigate
          to="/dashboard"
          state={{ permissionDenied: true, from: location }}
          replace
        />
      )}
    </ProtectedRoute>
  );
};

export default PermissionRoute;
