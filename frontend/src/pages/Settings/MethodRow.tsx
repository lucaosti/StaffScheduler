/**
 * MethodRow — one two-factor method's status row plus its enroll/disable
 * forms, when this row is the one active in useTwoFactorEnrollment's state
 * machine. See TwoFactorSection.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { TwoFactorMethodType, TwoFactorSetup } from '../../services/twoFactorService';
import type { EnrollmentStep } from './useTwoFactorEnrollment';

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

interface Props {
  methodType: TwoFactorMethodType;
  isEnabled: boolean;
  isEnrolling: boolean;
  isDisabling: boolean;
  step: EnrollmentStep;
  disableChallengeRequested: boolean;
  code: string;
  busy: boolean;
  onStartEnrollment: (methodType: TwoFactorMethodType) => void;
  onCancelEnrollment: () => void;
  onTotpOrEmailSubmit: (methodType: TwoFactorMethodType) => (e: React.FormEvent) => void;
  onWebAuthnContinue: (data: TwoFactorSetup) => void;
  onStartDisable: (methodType: TwoFactorMethodType) => void;
  onCancelDisable: () => void;
  onRequestEmailDisableChallenge: () => void;
  onRunWebAuthnDisable: () => void;
  onConfirmDisable: (methodType: TwoFactorMethodType) => (e: React.FormEvent) => void;
  onCodeChange: (value: string) => void;
  onRequestDisableChallenge: () => void;
}

const MethodRow: React.FC<Props> = ({
  methodType,
  isEnabled,
  isEnrolling,
  isDisabling,
  step,
  disableChallengeRequested,
  code,
  busy,
  onStartEnrollment,
  onCancelEnrollment,
  onTotpOrEmailSubmit,
  onWebAuthnContinue,
  onStartDisable,
  onCancelDisable,
  onRequestEmailDisableChallenge,
  onRunWebAuthnDisable,
  onConfirmDisable,
  onCodeChange,
  onRequestDisableChallenge,
}) => (
  <div className="border rounded p-3 mb-3">
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
          onClick={() => onStartDisable(methodType)}
        >
          Turn off
        </button>
      )}
      {!isEnabled && !isEnrolling && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => onStartEnrollment(methodType)}
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
          onClick={onRunWebAuthnDisable}
          disabled={busy}
        >
          Continue with passkey to turn off
        </button>
        <button type="button" className="btn btn-link" onClick={onRequestDisableChallenge}>
          Use a recovery code instead
        </button>
        <button type="button" className="btn btn-link" onClick={onCancelDisable}>
          Cancel
        </button>
      </div>
    )}

    {isDisabling && methodType === 'email' && !disableChallengeRequested && (
      <div className="mt-2">
        <button
          type="button"
          className="btn btn-outline-danger"
          onClick={onRequestEmailDisableChallenge}
          disabled={busy}
        >
          Send code to my email
        </button>
        <button type="button" className="btn btn-link" onClick={onCancelDisable}>
          Cancel
        </button>
      </div>
    )}

    {isDisabling && (methodType === 'totp' || disableChallengeRequested) && (
      <form className="row g-2 align-items-end mt-2" onSubmit={onConfirmDisable(methodType)}>
        <div className="col-auto">
          <label className="form-label" htmlFor={`twofa-off-code-${methodType}`}>
            Code from this method, or a recovery code
          </label>
          <input
            id={`twofa-off-code-${methodType}`}
            className="form-control"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="col-auto">
          <button type="submit" className="btn btn-outline-danger" disabled={busy}>
            Confirm turn off
          </button>
          <button type="button" className="btn btn-link" onClick={onCancelDisable}>
            Cancel
          </button>
        </div>
      </form>
    )}

    {isEnrolling && methodType === 'totp' && step.phase === 'setup' && (
      <form className="mt-2" onSubmit={onTotpOrEmailSubmit('totp')}>
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
              onChange={(e) => onCodeChange(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Enable
            </button>
            <button type="button" className="btn btn-link" onClick={onCancelEnrollment}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    )}

    {isEnrolling && methodType === 'email' && step.phase === 'setup' && (
      <form className="mt-2" onSubmit={onTotpOrEmailSubmit('email')}>
        <p className="mb-2">We sent a code to your account email. Enter it below.</p>
        <div className="row g-2 align-items-end">
          <div className="col-auto">
            <label className="form-label" htmlFor="twofa-email-code">Code from your email</label>
            <input
              id="twofa-email-code"
              className="form-control"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
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
            <button type="button" className="btn btn-link" onClick={onCancelEnrollment}>
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
          onClick={() => onWebAuthnContinue(step.data)}
          disabled={busy}
        >
          Continue with passkey
        </button>
        <button type="button" className="btn btn-link" onClick={onCancelEnrollment}>
          Cancel
        </button>
      </div>
    )}
  </div>
);

export default MethodRow;
