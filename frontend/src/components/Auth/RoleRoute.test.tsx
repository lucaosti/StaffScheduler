/**
 * RoleRoute unit tests.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import RoleRoute from './RoleRoute';

const mockedAuth: {
  user: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: jest.Mock;
  logout: jest.Mock;
  refreshToken: jest.Mock;
} = {
  user: null,
  isAuthenticated: true,
  isLoading: false,
  login: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
};

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockedAuth,
}));

const renderAt = (path: string, role: 'admin' | 'manager' | 'employee' | null) => {
  mockedAuth.user = role ? { id: 1, role, email: 'u@x' } : null;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RoleRoute allowedRoles={['admin']}>
              <div>ADMIN_PAGE</div>
            </RoleRoute>
          }
        />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('RoleRoute', () => {
  beforeEach(() => {
    mockedAuth.isLoading = false;
    mockedAuth.user = null;
  });

  it('renders children when role matches', () => {
    renderAt('/admin', 'admin');
    expect(screen.getByText('ADMIN_PAGE')).toBeInTheDocument();
  });

  it('redirects to dashboard when role does not match', () => {
    renderAt('/admin', 'employee');
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('redirects to dashboard when user is null', () => {
    renderAt('/admin', null);
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('shows a spinner while auth is loading', () => {
    mockedAuth.isLoading = true;
    renderAt('/admin', 'admin');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
