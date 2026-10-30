/**
 * Smoke tests for Layout / Sidebar / Header / ProtectedRoute / ThemeToggle.
 *
 * The components rely on AuthContext + Router context, so we mount them in
 * MemoryRouter with a stub AuthProvider via mocked module.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import Layout from './Layout';
import Sidebar from './Sidebar';
import Header from './Header';
import ThemeToggle from '../ThemeToggle';
import ProtectedRoute from '../Auth/ProtectedRoute';
import { ThemeProvider } from '../../contexts/ThemeContext';
import * as notificationService from '../../services/notificationService';

jest.mock('../../services/notificationService');

const mockedAuth: {
  user: { id: number; role: string; email: string; permissions?: string[] } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: jest.Mock;
  logout: jest.Mock;
  refreshToken: jest.Mock;
} = {
  user: { id: 1, role: 'admin', email: 'admin@example.com', permissions: ['settings.manage', 'employee.read', 'schedule.read', 'report.read', 'org_unit.read', 'policy.read'] },
  isAuthenticated: true,
  isLoading: false,
  login: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
};

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockedAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const wrap = (ui: React.ReactNode, initial = ['/']) => (
  <ThemeProvider>
    <MemoryRouter initialEntries={initial}>{ui}</MemoryRouter>
  </ThemeProvider>
);

beforeEach(() => {
  mockedAuth.user = { id: 1, role: 'admin', email: 'admin@example.com', permissions: ['settings.manage', 'employee.read', 'schedule.read', 'report.read', 'org_unit.read', 'policy.read'] };
  mockedAuth.isAuthenticated = true;
  mockedAuth.isLoading = false;
  jest.clearAllMocks();
  localStorage.clear();
  (notificationService.getUnreadCount as jest.Mock).mockResolvedValue({
    success: true,
    data: { count: 0 },
  });
  (notificationService.listNotifications as jest.Mock).mockResolvedValue({
    success: true,
    data: [],
  });
  (notificationService.markNotificationRead as jest.Mock).mockResolvedValue({ success: true });
  (notificationService.markAllNotificationsRead as jest.Mock).mockResolvedValue({
    success: true,
    data: { updated: 0 },
  });
});

describe('Sidebar', () => {
  it('shows admin menu items + handles logout click', () => {
    render(
      wrap(
        <Routes>
          <Route path="*" element={<Sidebar collapsed={false} />} />
        </Routes>
      )
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    expect(mockedAuth.logout).toHaveBeenCalled();
  });

  it('hides settings when user lacks settings.manage permission', () => {
    // Provide an explicit permission set that excludes settings.manage
    mockedAuth.user = { id: 2, role: 'staff', email: 'e@x', permissions: ['schedule.read', 'policy.read'] };
    render(
      wrap(
        <Routes>
          <Route path="*" element={<Sidebar collapsed={true} />} />
        </Routes>
      )
    );
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});

describe('Header', () => {
  it('toggles sidebar via the button', async () => {
    const onToggle = jest.fn();
    render(wrap(<Header onToggleSidebar={onToggle} sidebarExpanded />));
    fireEvent.click(screen.getByLabelText(/toggle sidebar/i));
    expect(onToggle).toHaveBeenCalled();
    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
  });

  /**
   * The menu used to rely on Bootstrap's JavaScript (`data-bs-toggle`), which
   * the app never loads, so clicking the bell did nothing in a browser. jsdom
   * applies no stylesheet, which is why every test here could still click an
   * item of a menu no user could open. The menu is now mounted only while
   * open, so a test that skips opening it fails the way a user would.
   */
  it('opens the bell menu on click and closes it on Escape and outside clicks', async () => {
    render(wrap(<Header onToggleSidebar={jest.fn()} sidebarExpanded />));
    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
    const bell = screen.getByLabelText('Notifications');

    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No new notifications')).not.toBeInTheDocument();

    fireEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No new notifications')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('No new notifications')).not.toBeInTheDocument();

    fireEvent.click(bell);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('No new notifications')).not.toBeInTheDocument();
    expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no badge and the empty state when there are no notifications', async () => {
    render(wrap(<Header onToggleSidebar={jest.fn()} sidebarExpanded />));
    await waitFor(() =>
      expect(notificationService.getUnreadCount).toHaveBeenCalled()
    );
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('No new notifications')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('shows the unread badge and recent notifications, marking one read on click', async () => {
    (notificationService.getUnreadCount as jest.Mock).mockResolvedValue({
      success: true,
      data: { count: 2 },
    });
    (notificationService.listNotifications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        { id: 1, userId: 1, type: 'x', title: 'Shift assigned', body: null, link: null, isRead: false, createdAt: 'x', readAt: null },
      ],
    });

    render(wrap(<Header onToggleSidebar={jest.fn()} sidebarExpanded />));

    fireEvent.click(await screen.findByLabelText('Notifications (2 unread)'));
    const item = await screen.findByText('Shift assigned');
    fireEvent.click(item);

    await waitFor(() =>
      expect(notificationService.markNotificationRead).toHaveBeenCalledWith(1)
    );
  });

  it('marks all notifications read via the "Mark all read" action', async () => {
    (notificationService.getUnreadCount as jest.Mock).mockResolvedValue({
      success: true,
      data: { count: 1 },
    });
    (notificationService.listNotifications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        { id: 2, userId: 1, type: 'x', title: 'Time-off approved', body: null, link: null, isRead: false, createdAt: 'x', readAt: null },
      ],
    });

    render(wrap(<Header onToggleSidebar={jest.fn()} sidebarExpanded />));

    fireEvent.click(await screen.findByLabelText('Notifications (1 unread)'));
    // A role="menu" holds menuitems only: every <li> is role="none", so none
    // reads as a plain list item (#840 re-review).
    const markAll = await screen.findByRole('menuitem', { name: /mark all read/i });
    expect(within(screen.getByRole('menu')).queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(markAll);

    await waitFor(() =>
      expect(notificationService.markAllNotificationsRead).toHaveBeenCalled()
    );
    expect(screen.queryByRole('menuitem', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('degrades silently when the notifications API fails', async () => {
    (notificationService.getUnreadCount as jest.Mock).mockRejectedValue(new Error('network'));
    (notificationService.listNotifications as jest.Mock).mockRejectedValue(new Error('network'));

    render(wrap(<Header onToggleSidebar={jest.fn()} sidebarExpanded />));

    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('No new notifications')).toBeInTheDocument();
  });
});

describe('Layout', () => {
  it('renders sidebar + header + outlet, toggling sidebar', async () => {
    render(
      wrap(
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>OUTLET</div>} />
          </Route>
        </Routes>
      )
    );
    expect(screen.getByText('OUTLET')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/toggle sidebar/i));
    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
  });

  // Below the shell breakpoint the sidebar is off-canvas and only the `show`
  // class reveals it; the toggle used to flip `collapsed` instead, so on a
  // phone no other page could be reached (#890).
  describe('on a phone-width viewport', () => {
    const realMatchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        ...realMatchMedia(query),
        matches: query.includes('max-width'),
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = realMatchMedia;
    });

    const renderShell = () =>
      render(
        wrap(
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<div>OUTLET</div>} />
              <Route path="/employees" element={<div>EMPLOYEES</div>} />
            </Route>
          </Routes>
        )
      );
    const sidebar = (container: HTMLElement) => container.querySelector('.sidebar') as HTMLElement;

    it('opens the off-canvas sidebar from the menu button', () => {
      const { container } = renderShell();
      const toggle = screen.getByLabelText(/toggle sidebar/i);
      expect(sidebar(container)).not.toHaveClass('show');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggle);
      expect(sidebar(container)).toHaveClass('show');
      expect(sidebar(container)).not.toHaveClass('collapsed');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes on the backdrop, on Escape, and after navigating', () => {
      const { container } = renderShell();
      const toggle = screen.getByLabelText(/toggle sidebar/i);

      fireEvent.click(toggle);
      fireEvent.click(container.querySelector('.sidebar-backdrop') as HTMLElement);
      expect(sidebar(container)).not.toHaveClass('show');

      fireEvent.click(toggle);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(sidebar(container)).not.toHaveClass('show');

      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole('link', { name: /employees/i }));
      expect(screen.getByText('EMPLOYEES')).toBeInTheDocument();
      expect(sidebar(container)).not.toHaveClass('show');
    });
  });
});

describe('ThemeToggle', () => {
  it('cycles through choices on click', () => {
    render(wrap(<ThemeToggle />));
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/Theme/);
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
  });
});

describe('ProtectedRoute', () => {
  it('shows spinner while loading', () => {
    mockedAuth.isLoading = true;
    render(
      wrap(
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>SECRET</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      )
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    mockedAuth.isAuthenticated = false;
    render(
      wrap(
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>SECRET</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      )
    );
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    render(
      wrap(
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>SECRET</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      )
    );
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });
});
