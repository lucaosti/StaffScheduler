/**
 * Smoke tests for Layout / Sidebar / Header / ProtectedRoute / ThemeToggle.
 *
 * The components rely on AuthContext + Router context, so we mount them in
 * MemoryRouter with a stub AuthProvider via mocked module.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import Layout from './Layout';
import Sidebar from './Sidebar';
import Header from './Header';
import ThemeToggle from '../ThemeToggle';
import ProtectedRoute from '../Auth/ProtectedRoute';
import { ThemeProvider } from '../../contexts/ThemeContext';

const mockedAuth: {
  user: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: jest.Mock;
  logout: jest.Mock;
  refreshToken: jest.Mock;
} = {
  user: { id: 1, role: 'admin', email: 'admin@example.com' },
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
  mockedAuth.user = { id: 1, role: 'admin', email: 'admin@example.com' };
  mockedAuth.isAuthenticated = true;
  mockedAuth.isLoading = false;
  jest.clearAllMocks();
  localStorage.clear();
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

  it('hides admin-only items for employees', () => {
    mockedAuth.user = { id: 2, role: 'employee', email: 'e@x' };
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
  it('toggles sidebar via the button', () => {
    const onToggle = jest.fn();
    render(wrap(<Header onToggleSidebar={onToggle} />));
    fireEvent.click(screen.getByLabelText(/toggle sidebar/i));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('Layout', () => {
  it('renders sidebar + header + outlet, toggling sidebar', () => {
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
