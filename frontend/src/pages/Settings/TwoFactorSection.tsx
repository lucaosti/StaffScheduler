/**
 * Two-factor authentication — enrolling, and turning it off.
 *
 * WHY THE RECOVERY CODES GET A DELIBERATE ACKNOWLEDGEMENT. They are returned
 * once by `enable` and are not fetchable afterwards — that is what makes them
 * a fallback rather than a second copy of the secret. A panel the user can
 * navigate away from without noticing is how someone enables 2FA and loses
 * their account the first time they change phone. The step will not close
 * until they say they have kept them.
 *
 * WHY THE SECRET IS SHOWN AS TEXT AND NOT ONLY AS A QR CODE. A QR image would
 * mean a rendering dependency, and the `otpauth://` URI is what a QR code
 * encodes anyway — every authenticator accepts it pasted. Showing the secret
 * plainly also covers the case a QR cannot: someone enrolling on the same
 * device they are reading this on.
 *
 * WHY DISABLING ASKS FOR A CODE. The server demands one, and it is right to:
 * turning 2FA off weakens the account exactly as much as signing in to it
 * does, so it takes the same proof of possession.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  TwoFactorSetup,
} from '../../services/twoFactorService';

const TwoFactorSection: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { message, run: act } = useActionFeedback();

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = Boolean(user?.twoFactorEnabled);

  const start = async () => {
    setBusy(true);
    await act(
      beginTwoFactorSetup().then((res) => {
        if (res.data) setSetup(res.data);
      })
    );
    setBusy(false);
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(
      enableTwoFactor(code).then((res) => {
        // Held in state rather than shown from the response and forgotten:
        // this is the only time the server will ever produce them.
        setRecoveryCodes(res.data?.recoveryCodes ?? []);
      })
    );
    if (ok) {
      setCode('');
      setSetup(null);
      await refreshUser();
    }
    setBusy(false);
  };

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(disableTwoFactor(code));
    if (ok) {
      setCode('');
      await refreshUser();
    }
    setBusy(false);
  };

  return (
    <section className="mb-4">
      <h2 className="h5">Two-factor authentication</h2>
      <p className="text-muted">
        A code from your authenticator app, in addition to your password.
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
            your authenticator. They are shown only here and cannot be retrieved later.
          </p>
          <ul className="list-unstyled font-monospace mb-3">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setRecoveryCodes(null)}
          >
            I have saved them
          </button>
        </div>
      )}

      {enabled && !recoveryCodes && (
        <form className="row g-2 align-items-end" onSubmit={turnOff}>
          <div className="col-auto">
            <p className="mb-2">
              <span className="badge bg-success">Enabled</span>
            </p>
            <label className="form-label" htmlFor="twofa-off-code">
              Code from your app, or a recovery code
            </label>
            <input
              id="twofa-off-code"
              className="form-control"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-outline-danger" disabled={busy}>
              Turn off
            </button>
          </div>
        </form>
      )}

      {!enabled && !setup && !recoveryCodes && (
        <>
          <p>
            <span className="badge bg-secondary">Not enabled</span>
          </p>
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            Set up
          </button>
        </>
      )}

      {!enabled && setup && (
        <form onSubmit={confirm}>
          <p>
            Add this to your authenticator app, then enter the code it shows. The account is not
            protected until you do.
          </p>
          <p className="font-monospace">
            <span className="d-block">{setup.otpauthUri}</span>
            <span className="d-block text-muted">Secret: {setup.secret}</span>
          </p>
          <div className="row g-2 align-items-end">
            <div className="col-auto">
              <label className="form-label" htmlFor="twofa-code">Code from your app</label>
              <input
                id="twofa-code"
                className="form-control"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Enable
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
};

export default TwoFactorSection;
