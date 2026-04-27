/**
 * Login page RTL test (T020).
 *
 * Mocks the AuthContext and react-router so the page renders standalone,
 * then drives the form via userEvent and asserts on the login() mock.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisting-safe mocks: jest.mock factories can only reference variables
// whose names start with 'mock'. Define them before importing the unit
// under test so the mocks are in place.
const mockNavigate = jest.fn();
const mockLogin = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/login' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

import Login from './Login';

describe('<Login />', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogin.mockReset();
  });

  it('renders the email + password fields', () => {
    render(<Login />);
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    // Bootstrap renders password as type="password"; query by label.
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('submits the form and navigates to /dashboard on success', async () => {
    mockLogin.mockResolvedValue(undefined);
    render(<Login />);
    await userEvent.type(
      screen.getByRole('textbox', { name: /email/i }),
      'a@x.com'
    );
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in|login|submit/i }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalled());
    expect(mockLogin).toHaveBeenCalledWith({ email: 'a@x.com', password: 'pw' });
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('shows the error message when login throws', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid email or password'));
    render(<Login />);
    await userEvent.type(
      screen.getByRole('textbox', { name: /email/i }),
      'a@x.com'
    );
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in|login|submit/i }));
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
