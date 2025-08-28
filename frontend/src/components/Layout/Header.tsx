/**
 * Header Component for Staff Scheduler Layout
 * 
 * Provides the top navigation bar with sidebar toggle, branding,
 * and user actions for the application layout.
 * 
 * Features:
 * - Sidebar toggle button with hamburger icon
 * - Application branding and title
 * - User profile and logout functionality
 * - Responsive design with Bootstrap classes
 * - Bootstrap Icons integration
 * 
 * @author Luca Ostinelli
 */

import React from 'react';

/**
 * Props interface for Header component
 */
interface HeaderProps {
  /** Callback function to toggle sidebar visibility */
  onToggleSidebar: () => void;
}

/**
 * Header component providing top navigation and controls
 * @param onToggleSidebar - Function to toggle sidebar collapsed state
 * @returns JSX element containing the header navigation
 */
const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  return (
    <div className="header">
      <button
        className="btn btn-link text-dark p-0 me-3"
        onClick={onToggleSidebar}
        style={{ fontSize: '1.25rem' }}
      >
        <i className="bi bi-list"></i>
      </button>
      
      <h5 className="mb-0 text-dark">Staff Scheduler</h5>
      
      <div className="ms-auto d-flex align-items-center">
        <div className="dropdown">
          <button
            className="btn btn-link text-dark p-0"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i className="bi bi-bell" style={{ fontSize: '1.25rem' }}></i>
          </button>
          <ul className="dropdown-menu dropdown-menu-end">
            <li><h6 className="dropdown-header">Notifications</h6></li>
            <li><button className="dropdown-item" type="button">No new notifications</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Header;
