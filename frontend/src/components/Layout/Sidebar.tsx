/**
 * Sidebar Navigation Component for Staff Scheduler
 * 
 * Provides the main navigation menu with collapsible functionality,
 * user information display, and logout capability.
 * 
 * Features:
 * - Collapsible navigation with smooth transitions
 * - Active route highlighting with React Router
 * - User profile information display
 * - Logout functionality with redirect
 * - Bootstrap-styled menu items with icons
 * - Responsive design for different screen sizes
 * 
 * @author Luca Ostinelli
 */

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Props interface for Sidebar component
 */
interface SidebarProps {
  /** Whether the sidebar is in collapsed state */
  collapsed: boolean;
}

/**
 * Sidebar navigation component with collapsible menu
 * @param collapsed - Whether sidebar should be collapsed
 * @returns JSX element containing the navigation sidebar
 */
const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  /**
   * Handles user logout and redirects to login page
   */
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Each menu item declares the permission key required to see it.
  // Items with no requiredPermission are visible to all authenticated users.
  const menuItems = [
    {
      path: '/dashboard',
      icon: 'bi-speedometer2',
      label: 'Dashboard',
      requiredPermission: null,
    },
    {
      path: '/employees',
      icon: 'bi-people',
      label: 'Employees',
      requiredPermission: 'employee.read',
    },
    {
      path: '/shifts',
      icon: 'bi-clock',
      label: 'Shifts',
      requiredPermission: 'schedule.read',
    },
    {
      path: '/schedule',
      icon: 'bi-calendar3',
      label: 'Schedule',
      requiredPermission: 'schedule.read',
    },
    {
      path: '/reports',
      icon: 'bi-graph-up',
      label: 'Reports',
      requiredPermission: 'report.read',
    },
    {
      path: '/org',
      icon: 'bi-diagram-3',
      label: 'Organization',
      requiredPermission: 'org_unit.read',
    },
    {
      path: '/policies',
      icon: 'bi-shield-check',
      label: 'Policies',
      requiredPermission: 'policy.read',
    },
    {
      path: '/governance',
      icon: 'bi-diagram-3-fill',
      label: 'Governance',
      requiredPermission: 'responsibility.read',
    },
    {
      path: '/settings',
      icon: 'bi-gear',
      label: 'Settings',
      requiredPermission: 'settings.manage',
    },
    {
      path: '/admin/audit-logs',
      icon: 'bi-journal-text',
      label: 'Audit Log',
      requiredPermission: 'audit.read',
    },
  ];

  const hasPermission = (requiredPermission: string | null): boolean => {
    if (requiredPermission === null) return true; // no permission required
    if (user?.permissions) {
      return user.permissions.includes(requiredPermission);
    }
    return false; // fail-closed: hide items until permissions are confirmed
  };

  const filteredMenuItems = menuItems.filter(item =>
    user && hasPermission(item.requiredPermission)
  );

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <i className="bi bi-calendar-check-fill me-2" aria-hidden="true"></i>
        {!collapsed && 'Staff Scheduler'}
      </div>

      <nav aria-label="Main navigation">
        <ul className="sidebar-nav">
          {filteredMenuItems.map((item) => (
            <li key={item.path} className="sidebar-nav-item">
              <NavLink
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `sidebar-nav-link ${isActive ? 'active' : ''}`
                }
              >
                <i className={item.icon} aria-hidden="true"></i>
                <span className={collapsed ? 'visually-hidden' : ''}>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto p-3 border-top">
        {user && !collapsed && (
          <div className="text-body mb-2">
            <small>
              {user.email}
              <br />
              <span className="text-muted">{user.role}</span>
            </small>
          </div>
        )}
        <button
          className="btn btn-outline-secondary btn-sm w-100"
          type="button"
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          aria-label="Logout"
        >
          <i className="bi bi-box-arrow-right me-1" aria-hidden="true"></i>
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
