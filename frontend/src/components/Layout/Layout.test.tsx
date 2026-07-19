/**
 * Smoke tests for Layout / Sidebar / Header / ProtectedRoute / ThemeToggle.
 *
 * The components rely on AuthContext + Router context, so we mount them in
 * MemoryRouter with a stub AuthProvider via mocked module.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    render(wrap(<Header onToggleSidebar={onToggle} />));
    fireEvent.click(screen.getByLabelText(/toggle sidebar/i));
    expect(onToggle).toHaveBeenCalled();
    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
  });

  it('shows no badge and the empty state when there are no notifications', async () => {
    render(wrap(<Header onToggleSidebar={jest.fn()} />));
    await waitFor(() =>
      expect(notificationService.getUnreadCount).toHaveBeenCalled()
    );
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

    render(wrap(<Header onToggleSidebar={jest.fn()} />));

    expect(await screen.findByLabelText('Notifications (2 unread)')).toBeInTheDocument();
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

    render(wrap(<Header onToggleSidebar={jest.fn()} />));

    const markAll = await screen.findByRole('button', { name: /mark all read/i });
    fireEvent.click(markAll);

    await waitFor(() =>
      expect(notificationService.markAllNotificationsRead).toHaveBeenCalled()
    );
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('degrades silently when the notifications API fails', async () => {
    (notificationService.getUnreadCount as jest.Mock).mockRejectedValue(new Error('network'));
    (notificationService.listNotifications as jest.Mock).mockRejectedValue(new Error('network'));

    render(wrap(<Header onToggleSidebar={jest.fn()} />));

    await waitFor(() => expect(notificationService.getUnreadCount).toHaveBeenCalled());
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
