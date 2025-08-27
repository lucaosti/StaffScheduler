import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  collapsed: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
