/**
 * Login Page Component for Staff Scheduler
 * 
 * Provides user authentication interface with form validation,
 * error handling, and post-login redirection functionality.
 * 
 * Features:
 * - Email/password authentication form
 * - Real-time form validation
 * - Loading states during authentication
 * - Error message display
 * - Automatic redirect after successful login
 * - Responsive design with Bootstrap styling
 * - Integration with AuthContext for state management
 * 
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Interface for location state with redirect information
 */
interface LocationState {
  from: {
    pathname: string;
  };
}

/**
 * Login page component providing user authentication
 * @returns JSX element containing the login form and interface
 */
const Login: React.FC = () => {
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as LocationState)?.from?.pathname || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await login(credentials);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCredentials(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const fillDemoCredentials = (email: string, password: string) => {
    setCredentials({ email, password });
  };

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-md-6 col-lg-4">
            <div className="card shadow">
              <div className="card-body p-4">
                <div className="text-center mb-4">
                  <i className="bi bi-calendar-check-fill text-primary" style={{ fontSize: '3rem' }}></i>
                  <h3 className="mt-2">Staff Scheduler</h3>
                  <p className="text-muted">Sign in to your account</p>
                </div>

                {error && (
                  <div className="alert alert-danger" role="alert">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label htmlFor="email" className="form-label">
                      Email
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      className="form-control"
                      value={credentials.email}
                      onChange={handleChange}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="mb-4">
                    <label htmlFor="password" className="form-label">
                      Password
                    </label>
                    <input
                      type="password"
                      id="password"
                      name="password"
                      className="form-control"
                      value={credentials.password}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary w-100"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </button>
                </form>

                <div className="mt-4 text-center">
                  <small className="text-muted mb-2 d-block">Quick Demo Access:</small>
                  <div className="d-grid gap-1">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => fillDemoCredentials('admin@staffscheduler.com', 'Admin123!')}
                    >
                      <i className="bi bi-shield-check me-1"></i>
                      Admin Demo
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => fillDemoCredentials('manager@staffscheduler.com', 'Manager123!')}
                    >
                      <i className="bi bi-person-badge me-1"></i>
                      Manager Demo
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-info btn-sm"
                      onClick={() => fillDemoCredentials('employee@staffscheduler.com', 'Employee123!')}
                    >
                      <i className="bi bi-person me-1"></i>
                      Employee Demo
                    </button>
                  </div>
                </div>

                <div className="mt-3 text-center">
                  <small className="text-muted">
                    Demo Credentials:<br />
                    Admin: admin@staffscheduler.com / Admin123!<br />
                    Manager: manager@staffscheduler.com / Manager123!<br />
                    Employee: employee@staffscheduler.com / Employee123!
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
