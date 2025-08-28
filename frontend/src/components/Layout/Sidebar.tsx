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

  const menuItems = [
    {
      path: '/dashboard',
      icon: 'bi-speedometer2',
      label: 'Dashboard',
      roles: ['admin', 'manager', 'employee'],
    },
    {
      path: '/employees',
      icon: 'bi-people',
      label: 'Employees',
      roles: ['admin', 'manager'],
    },
    {
      path: '/shifts',
      icon: 'bi-clock',
      label: 'Shifts',
      roles: ['admin', 'manager'],
    },
    {
      path: '/schedule',
      icon: 'bi-calendar3',
      label: 'Schedule',
      roles: ['admin', 'manager', 'employee'],
    },
    {
      path: '/reports',
      icon: 'bi-graph-up',
      label: 'Reports',
      roles: ['admin', 'manager'],
    },
    {
      path: '/settings',
      icon: 'bi-gear',
      label: 'Settings',
      roles: ['admin'],
    },
  ];

  const filteredMenuItems = menuItems.filter(item =>
    user?.role && item.roles.includes(user.role)
  );

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <i className="bi bi-calendar-check-fill me-2"></i>
        {!collapsed && 'Staff Scheduler'}
      </div>
      
      <ul className="sidebar-nav">
        {filteredMenuItems.map((item) => (
          <li key={item.path} className="sidebar-nav-item">
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <i className={item.icon}></i>
              {!collapsed && item.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto p-3">
        {user && (
          <div className="text-white mb-2">
            <small>
              {user.email}
              <br />
              <span className="text-muted">{user.role}</span>
            </small>
          </div>
        )}
        <button
          className="btn btn-outline-light btn-sm w-100"
          onClick={handleLogout}
        >
          <i className="bi bi-box-arrow-right me-1"></i>
          {!collapsed && 'Logout'}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
