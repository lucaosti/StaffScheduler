/**
 * Main Layout Component for Staff Scheduler
 *
 * Provides the core application layout structure with responsive sidebar
 * and header navigation. Serves as the root container for all protected routes.
 *
 * Layout Structure:
 * - Sidebar: Navigation menu with collapsible state
 * - Header: Top navigation bar with controls
 * - Content Area: Outlet for nested route components
 *
 * WHY TWO SIDEBAR STATES. On a wide screen the sidebar is docked and the menu
 * button collapses it to give the content more room. Below the shell
 * breakpoint the sidebar is an off-canvas drawer (index.css hides it and only
 * `.sidebar.show` reveals it), so the same button must open and close the
 * drawer instead. A single `collapsed` flag served both and never set `show`,
 * so on a phone no page but the current one could be reached (#890). The
 * drawer closes on its backdrop, on Escape and after navigating, which is what
 * a modal navigation surface is expected to do.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport';

/** Must match the `max-width` of the responsive block in index.css. */
const DRAWER_BREAKPOINT_PX = 768;

/**
 * Main layout component that provides the application structure
 * @returns JSX element containing the complete layout with sidebar, header, and content area
 */
const Layout: React.FC = () => {
  const isNarrow = useIsNarrowViewport(DRAWER_BREAKPOINT_PX);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { pathname } = useLocation();

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, isNarrow]);

  React.useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const toggleSidebar = () => {
    if (isNarrow) setDrawerOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  };

  const collapsed = !isNarrow && sidebarCollapsed;

  return (
    <div className="app-container">
      <Sidebar collapsed={collapsed} drawerOpen={isNarrow && drawerOpen} />
      {isNarrow && drawerOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      )}
      <div className={`main-content ${collapsed ? 'expanded' : ''}`}>
        <Header onToggleSidebar={toggleSidebar} sidebarExpanded={isNarrow ? drawerOpen : !collapsed} />
        <div className="content-area">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;
