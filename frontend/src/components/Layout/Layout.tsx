/**
 * Main Layout Component for Staff Scheduler
 * 
 * Provides the core application layout structure with responsive sidebar
 * and header navigation. Serves as the root container for all protected routes.
 * 
 * Features:
 * - Responsive sidebar with collapse/expand functionality
 * - Fixed header with navigation controls
 * - Main content area for nested routes
 * - Consistent spacing and responsive design
 * - State management for sidebar visibility
 * 
 * Layout Structure:
 * - Sidebar: Navigation menu with collapsible state
 * - Header: Top navigation bar with controls
 * - Content Area: Outlet for nested route components
 * 
 * @author Luca Ostinelli
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

/**
 * Main layout component that provides the application structure
 * @returns JSX element containing the complete layout with sidebar, header, and content area
 */
const Layout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  /**
   * Toggles the sidebar collapsed state
   */
  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="app-container">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className={`main-content ${sidebarCollapsed ? 'expanded' : ''}`}>
        <Header onToggleSidebar={toggleSidebar} />
        <div className="content-area">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;
