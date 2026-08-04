/**
 * Two-factor authentication — enrolling in, and turning off, any of the
 * account's available methods (#594, part of #331): an authenticator app
 * (TOTP), a passkey (WebAuthn), or an emailed one-time code.
 *
 * WHY EACH METHOD IS ITS OWN ROW WITH ITS OWN STATE, NOT ONE SHARED FORM.
 * `user.twoFactorEnabled` is a single boolean ("does this account have 2FA
 * at all"), but enabling/disabling now targets ONE method at a time
 * (`GET /auth/2fa/methods` is the source of truth for which). Collapsing
 * them into one form would mean guessing which method a submitted code was
 * for.
 *
 * WHY THE RECOVERY CODES GET A DELIBERATE ACKNOWLEDGEMENT. They are returned
 * once by `enable` — and only the FIRST time any method is enabled, a
 * second method reuses the existing set — and are not fetchable afterwards.
 * A panel the user can navigate away from without noticing is how someone
 * enables 2FA and loses their account the first time they change phone. The
 * step will not close until they say they have kept them.
 *
 * WHY THE TOTP SECRET IS SHOWN AS TEXT AND NOT ONLY AS A QR CODE. A QR image
 * would mean a rendering dependency, and the `otpauth://` URI is what a QR
 * code encodes anyway — every authenticator accepts it pasted. Showing the
 * secret plainly also covers the case a QR cannot: enrolling on the same
 * device you are reading this on.
 *
 * WHY WEBAUTHN IS A SEPARATE BUTTON CLICK, NOT AUTOMATIC AFTER SETUP.
 * `navigator.credentials.create()`/`.get()` need a direct user gesture in
 * most browsers; chaining it onto the `beginTwoFactorSetup` fetch call (an
 * `await` boundary) risks the browser refusing the prompt silently. An
 * explicit "Continue with passkey" button is itself the gesture.
 *
 * WHY DISABLING ASKS FOR A CODE. The server demands one, and it is right to:
 * turning a method off weakens the account exactly as much as signing in
 * with it does, so it takes the same proof of possession (or a recovery
 * code, which proves ownership rather than possession of one method).
 *
 * @author Luca Ostinelli
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  listTwoFactorMethods,
  requestTwoFactorChallenge,
  TwoFactorMethodType,
  TwoFactorSetup,
} from '../../services/twoFactorService';
import { runWebAuthnAuthentication, runWebAuthnRegistration } from '../../services/webAuthnClient';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

const METHOD_LABELS: Record<TwoFactorMethodType, string> = {
  totp: 'Authenticator app',
  webauthn: 'Passkey',
  email: 'Email code',
  sms: 'SMS',
};

const METHOD_DESCRIPTIONS: Record<TwoFactorMethodType, string> = {
  totp: 'A time-based code from an authenticator app (Google Authenticator, 1Password, etc.).',
  webauthn: 'A passkey stored on this device or a security key.',
  email: 'A one-time code sent to your account email.',
  sms: 'A one-time code sent by text message.',
};

// SMS (#589) has no provider registered on the backend yet — offering it
// here would be a button that always fails.
const AVAILABLE_METHODS: TwoFactorMethodType[] = ['totp', 'webauthn', 'email'];

type EnrollmentStep =
  | { phase: 'idle' }
  | { phase: 'setup'; data: TwoFactorSetup }
  | { phase: 'webauthn-ready'; data: TwoFactorSetup };

const TwoFactorSection: React.FC = () => {
  const { refreshUser } = useAuth();
  const { message, setMessage, run: act } = useActionFeedback();

  const [methods, setMethods] = useState<TwoFactorMethodType[] | null>(null);
  const [enrolling, setEnrolling] = useState<TwoFactorMethodType | null>(null);
  const [step, setStep] = useState<EnrollmentStep>({ phase: 'idle' });
  const [disabling, setDisabling] = useState<TwoFactorMethodType | null>(null);
  const [disableChallengeRequested, setDisableChallengeRequested] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMethods = useCallback(async () => {
    const res = await listTwoFactorMethods();
    setMethods(res.data?.methods ?? []);
  }, []);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const startEnrollment = async (methodType: TwoFactorMethodType) => {
    setBusy(true);
    setEnrolling(methodType);
    setCode('');
    await act(
      beginTwoFactorSetup(methodType).then((res) => {
        const data = res.data ?? {};
        setStep(methodType === 'webauthn' ? { phase: 'webauthn-ready', data } : { phase: 'setup', data });
      })
    );
    setBusy(false);
  };

  const cancelEnrollment = () => {
    setEnrolling(null);
    setStep({ phase: 'idle' });
    setCode('');
    setMessage(null);
  };

  const confirmEnrollment = async (methodType: TwoFactorMethodType, confirmCode: string) => {
    setBusy(true);
    const ok = await act(
      enableTwoFactor(confirmCode, methodType).then((res) => {
        // Held in state rather than shown from the response and forgotten:
        // this may be the only time the server ever produces them.
        if (res.data?.recoveryCodes.length) setRecoveryCodes(res.data.recoveryCodes);
      })
    );
    if (ok) {
      setEnrolling(null);
      setStep({ phase: 'idle' });
      setCode('');
      await Promise.all([loadMethods(), refreshUser()]);
    }
    setBusy(false);
  };

  const handleTotpOrEmailSubmit = (methodType: TwoFactorMethodType) => (e: React.FormEvent) => {
    e.preventDefault();
    void confirmEnrollment(methodType, code);
  };

  const handleWebAuthnContinue = async (data: TwoFactorSetup) => {
    setBusy(true);
    const ok = await act(
      runWebAuthnRegistration(data as unknown as PublicKeyCredentialCreationOptionsJSON).then((response) =>
        confirmEnrollment('webauthn', response)
      )
    );
    if (!ok) setBusy(false);
  };

  const finishDisable = async (methodType: TwoFactorMethodType, disableCode: string) => {
    const ok = await act(disableTwoFactor(disableCode, methodType));
    if (ok) {
      setDisabling(null);
      setDisableChallengeRequested(false);
      setCode('');
      await Promise.all([loadMethods(), refreshUser()]);
    }
    return ok;
  };

  const startDisable = (methodType: TwoFactorMethodType) => {
    setDisabling(methodType);
    setDisableChallengeRequested(false);
    setCode('');
    setMessage(null);
  };

  /** For email: sends a fresh disable code and reveals the input for it. */
  const requestEmailDisableChallenge = async () => {
    setBusy(true);
    const ok = await act(requestTwoFactorChallenge('email'));
    if (ok) setDisableChallengeRequested(true);
    setBusy(false);
  };

  /** For WebAuthn: the passkey assertion IS the proof, so request the challenge and run the ceremony in one action — there is no code to type. */
  const runWebAuthnDisable = async () => {
    setBusy(true);
    await act(
      requestTwoFactorChallenge('webauthn').then((res) => {
        if (!res.data) throw new Error('No WebAuthn challenge was returned');
        return runWebAuthnAuthentication(res.data as unknown as PublicKeyCredentialRequestOptionsJSON).then(
          (response) => finishDisable('webauthn', response)
        );
      })
    );
    setBusy(false);
  };

  const confirmDisable = (methodType: TwoFactorMethodType) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await finishDisable(methodType, code);
    setBusy(false);
  };

  if (methods === null) {
    return (
      <section className="mb-4">
        <h2 className="h5">Two-factor authentication</h2>
        <p className="text-muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="mb-4">
      <h2 className="h5">Two-factor authentication</h2>
      <p className="text-muted">
        An extra proof of identity, in addition to your password. Enable as many methods as you like.
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {recoveryCodes && (
        <div className="alert alert-info">
          <p>
            <strong>Save these recovery codes now.</strong> Each one signs you in once if you lose
            access to every enrolled method. They are shown only here and cannot be retrieved later.
          </p>
          <ul className="list-unstyled font-monospace mb-3">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </button>
        </div>
      )}

      {AVAILABLE_METHODS.map((methodType) => {
        const isEnabled = methods.includes(methodType);
        const isEnrolling = enrolling === methodType;
        const isDisabling = disabling === methodType;

        return (
          <div key={methodType} className="border rounded p-3 mb-3">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h3 className="h6 mb-1">{METHOD_LABELS[methodType]}</h3>
                <p className="text-muted small mb-2">{METHOD_DESCRIPTIONS[methodType]}</p>
                <span className={`badge ${isEnabled ? 'bg-success' : 'bg-secondary'}`}>
                  {isEnabled ? 'Enabled' : 'Not enabled'}
                </span>
              </div>
              {isEnabled && !isDisabling && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => startDisable(methodType)}
                >
                  Turn off
                </button>
              )}
              {!isEnabled && !isEnrolling && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void startEnrollment(methodType)}
                  disabled={busy}
                >
                  Set up
                </button>
              )}
            </div>

            {isDisabling && methodType === 'webauthn' && !disableChallengeRequested && (
              <div className="mt-2">
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => void runWebAuthnDisable()}
                  disabled={busy}
                >
                  Continue with passkey to turn off
                </button>
                <button type="button" className="btn btn-link" onClick={() => setDisableChallengeRequested(true)}>
                  Use a recovery code instead
                </button>
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => {
                    setDisabling(null);
                    setMessage(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {isDisabling && methodType === 'email' && !disableChallengeRequested && (
              <div className="mt-2">
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => void requestEmailDisableChallenge()}
                  disabled={busy}
                >
                  Send code to my email
                </button>
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => {
                    setDisabling(null);
                    setMessage(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {isDisabling && (methodType === 'totp' || disableChallengeRequested) && (
              <form className="row g-2 align-items-end mt-2" onSubmit={confirmDisable(methodType)}>
                <div className="col-auto">
                  <label className="form-label" htmlFor={`twofa-off-code-${methodType}`}>
                    Code from this method, or a recovery code
                  </label>
                  <input
                    id={`twofa-off-code-${methodType}`}
                    className="form-control"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-outline-danger" disabled={busy}>
                    Confirm turn off
                  </button>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => {
                      setDisabling(null);
                      setDisableChallengeRequested(false);
                      setMessage(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {isEnrolling && methodType === 'totp' && step.phase === 'setup' && (
              <form className="mt-2" onSubmit={handleTotpOrEmailSubmit('totp')}>
                <p className="mb-1">
                  Add this to your authenticator app, then enter the code it shows.
                </p>
                <p className="font-monospace small">
                  <span className="d-block">{String(step.data.otpauthUri ?? '')}</span>
                  <span className="d-block text-muted">Secret: {String(step.data.secret ?? '')}</span>
                </p>
                <div className="row g-2 align-items-end">
                  <div className="col-auto">
                    <label className="form-label" htmlFor="twofa-totp-code">Code from your app</label>
                    <input
                      id="twofa-totp-code"
                      className="form-control"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="col-auto">
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      Enable
                    </button>
                    <button type="button" className="btn btn-link" onClick={cancelEnrollment}>
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}

            {isEnrolling && methodType === 'email' && step.phase === 'setup' && (
              <form className="mt-2" onSubmit={handleTotpOrEmailSubmit('email')}>
                <p className="mb-2">We sent a code to your account email. Enter it below.</p>
                <div className="row g-2 align-items-end">
                  <div className="col-auto">
                    <label className="form-label" htmlFor="twofa-email-code">Code from your email</label>
                    <input
                      id="twofa-email-code"
                      className="form-control"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="col-auto">
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      Enable
                    </button>
                    <button type="button" className="btn btn-link" onClick={cancelEnrollment}>
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}

            {isEnrolling && methodType === 'webauthn' && step.phase === 'webauthn-ready' && (
              <div className="mt-2">
                <p className="mb-2">
                  Your browser will ask you to create a passkey using this device or a security key.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleWebAuthnContinue(step.data)}
                  disabled={busy}
                >
                  Continue with passkey
                </button>
                <button type="button" className="btn btn-link" onClick={cancelEnrollment}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};

export default TwoFactorSection;
