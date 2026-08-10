/**
 * Login Page Component for Staff Scheduler
 *
 * Provides user authentication interface with form validation,
 * error handling, and post-login redirection functionality.
 *
 * Features:
 * - Email/password authentication form
 * - Method-aware two-factor step (#594, part of #331): when the account has
 *   more than one method enabled, the person picks which to use; a method
 *   that needs a server-generated challenge (email, WebAuthn) requests one
 *   via `POST /auth/login/challenge` before a code can be produced — TOTP
 *   needs none, since its code is computed from a secret the account
 *   already has.
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
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../services/apiUtils';
import { internalPathOr } from '../../utils/internalPath';
import { TwoFactorMethodType, requestLoginChallenge } from '../../services/twoFactorService';
import { runWebAuthnAuthentication } from '../../services/webAuthnClient';
import ErrorAlert from '../../components/ErrorAlert';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

/**
 * Interface for location state with redirect information
 */
interface LocationState {
  from: {
    pathname: string;
  };
}

const METHOD_LABEL_KEYS: Record<TwoFactorMethodType, string> = {
  totp: 'auth.methods.totp',
  webauthn: 'auth.methods.webauthn',
  email: 'auth.methods.email',
  sms: 'auth.methods.sms',
};

/** Methods whose code must be requested from the server before it can be entered/produced. TOTP computes its own. */
const NEEDS_CHALLENGE: Partial<Record<TwoFactorMethodType, boolean>> = { email: true, webauthn: true };

/**
 * Login page component providing user authentication
 * @returns JSX element containing the login form and interface
 */
const Login: React.FC = () => {
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
    code: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableMethods, setAvailableMethods] = useState<TwoFactorMethodType[] | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<TwoFactorMethodType | null>(null);
  const [challengeRequested, setChallengeRequested] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // The path the visitor originally asked for, which reached router state
  // from the URL — so it is input, not code. Validated before it is navigated
  // to: react-router's open-redirect advisory turns `/\evil.com` into a path
  // the router accepts and the browser reads as a host.
  const from = internalPathOr((location.state as LocationState)?.from?.pathname);

  const submitLogin = async (code?: string, methodType?: TwoFactorMethodType) => {
    setIsLoading(true);
    setError('');
    try {
      await login({
        email: credentials.email,
        password: credentials.password,
        ...(code ? { code, methodType: methodType ?? 'totp' } : {}),
      });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED') {
        // Credentials are valid but the account has 2FA enabled: reveal the
        // method picker (or go straight to the code field for a single
        // TOTP-only account) instead of surfacing an error.
        const methods = (err.data as { methods?: TwoFactorMethodType[] } | undefined)?.methods ?? ['totp'];
        setAvailableMethods(methods);
        setSelectedMethod(methods.includes('totp') ? 'totp' : methods[0]);
      } else {
        setError(err instanceof Error ? err.message : t('auth.loginFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!availableMethods) {
      await submitLogin();
    } else if (selectedMethod && (!NEEDS_CHALLENGE[selectedMethod] || (selectedMethod === 'email' && challengeRequested))) {
      // TOTP needs no challenge; email reaches here only once its code has
      // been requested and typed in. WebAuthn submits from its own button
      // (the ceremony itself produces the code — see requestChallenge).
      await submitLogin(credentials.code, selectedMethod);
    }
  };

  const requestChallenge = async (methodType: TwoFactorMethodType) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await requestLoginChallenge(credentials.email, credentials.password, methodType);
      if (methodType === 'webauthn' && res.data) {
        const responseCode = await runWebAuthnAuthentication(
          res.data as unknown as PublicKeyCredentialRequestOptionsJSON
        );
        await submitLogin(responseCode, 'webauthn');
        return;
      }
      // Email: the server just sent the code. Reveal the input.
      setChallengeRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.challengeFailed'));
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

  const handleSelectMethod = (methodType: TwoFactorMethodType) => {
    setSelectedMethod(methodType);
    setChallengeRequested(false);
    setCredentials((prev) => ({ ...prev, code: '' }));
    setError('');
  };

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-body-tertiary">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-md-6 col-lg-4">
            <div className="card shadow">
              <div className="card-body p-4">
                <div className="text-center mb-4">
                  <i className="bi bi-calendar-check-fill text-primary" style={{ fontSize: '3rem' }}></i>
                  <h3 className="mt-2">{t('app.title')}</h3>
                  <p className="text-muted">{t('auth.subtitle')}</p>
                </div>

                {error && <ErrorAlert message={error} />}

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label htmlFor="email" className="form-label">
                      {t('auth.email')}
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
                      disabled={Boolean(availableMethods)}
                    />
                  </div>

                  <div className="mb-4">
                    <label htmlFor="password" className="form-label">
                      {t('auth.password')}
                    </label>
                    <input
                      type="password"
                      id="password"
                      name="password"
                      className="form-control"
                      value={credentials.password}
                      onChange={handleChange}
                      required
                      disabled={Boolean(availableMethods)}
                    />
                  </div>

                  {availableMethods && availableMethods.length > 1 && (
                    <div className="mb-3">
                      <label className="form-label">{t('auth.twoFactorMethod')}</label>
                      <div className="btn-group w-100" role="group">
                        {availableMethods.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`btn btn-sm ${selectedMethod === m ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => handleSelectMethod(m)}
                          >
                            {t(METHOD_LABEL_KEYS[m])}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {availableMethods && selectedMethod && !NEEDS_CHALLENGE[selectedMethod] && (
                    <div className="mb-4">
                      <label htmlFor="code" className="form-label">
                        {t('auth.twoFactorCode')}
                      </label>
                      <input
                        type="text"
                        id="code"
                        name="code"
                        className="form-control"
                        value={credentials.code}
                        onChange={handleChange}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        required
                        autoFocus
                      />
                      <div className="form-text">
                        {t('auth.twoFactorCodeHelp')}
                      </div>
                    </div>
                  )}

                  {availableMethods && selectedMethod === 'email' && !challengeRequested && (
                    <div className="mb-4">
                      <button
                        type="button"
                        className="btn btn-outline-primary w-100"
                        onClick={() => void requestChallenge('email')}
                        disabled={isLoading}
                      >
                        {t('auth.sendEmailCode')}
                      </button>
                    </div>
                  )}

                  {availableMethods && selectedMethod === 'email' && challengeRequested && (
                    <div className="mb-4">
                      <label htmlFor="code" className="form-label">
                        {t('auth.emailCode')}
                      </label>
                      <input
                        type="text"
                        id="code"
                        name="code"
                        className="form-control"
                        value={credentials.code}
                        onChange={handleChange}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        required
                        autoFocus
                      />
                    </div>
                  )}

                  {availableMethods && selectedMethod === 'webauthn' && (
                    <div className="mb-4">
                      <button
                        type="button"
                        className="btn btn-outline-primary w-100"
                        onClick={() => void requestChallenge('webauthn')}
                        disabled={isLoading}
                      >
                        {t('auth.continueWithPasskey')}
                      </button>
                    </div>
                  )}

                  {(!availableMethods ||
                    (selectedMethod && !NEEDS_CHALLENGE[selectedMethod]) ||
                    (selectedMethod === 'email' && challengeRequested)) && (
                    <button
                      type="submit"
                      className="btn btn-primary w-100"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          {t('auth.signingIn')}
                        </>
                      ) : (
                        t('auth.signIn')
                      )}
                    </button>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
