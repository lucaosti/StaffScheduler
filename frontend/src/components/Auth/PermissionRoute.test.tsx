/**
 * Unit tests for PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import PermissionRoute from './PermissionRoute';

const mockUseAuth = jest.fn();

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const wrap = (ui: React.ReactElement, initialPath = '/protected') => (
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/protected" element={ui} />
      <Route path="/dashboard" element={<p>dashboard</p>} />
      <Route path="/login" element={<p>login</p>} />
    </Routes>
  </MemoryRouter>
);

describe('<PermissionRoute />', () => {
  it('renders children when user is authenticated and holds the permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, permissions: ['schedule.manage'] },
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>protected content</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('redirects to /dashboard when user lacks the required permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, permissions: ['report.read'] },
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>protected content</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('allows access when permissions array is empty (fail-open)', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, permissions: [] },
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>open content</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByText('open content')).toBeInTheDocument();
  });

  it('allows access when user.permissions is undefined (fail-open)', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1 },
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>fallback open</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByText('fallback open')).toBeInTheDocument();
  });

  it('redirects to /login when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>protected content</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('shows the loading spinner while auth is resolving', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });

    render(
      wrap(
        <PermissionRoute permission="schedule.manage">
          <p>protected content</p>
        </PermissionRoute>
      )
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});
