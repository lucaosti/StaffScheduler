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
 * for. Each row is rendered by MethodRow; the enroll/disable state machine
 * (only one method can be enrolling or disabling at a time) lives in
 * useTwoFactorEnrollment.
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

import React from 'react';
import { useTwoFactorMethodsQuery } from '../../hooks/useTwoFactorMethods';
import { TwoFactorMethodType } from '../../services/twoFactorService';
import MethodRow from './MethodRow';
import { useTwoFactorEnrollment } from './useTwoFactorEnrollment';

// SMS (#589) has no provider registered on the backend yet — offering it
// here would be a button that always fails.
const AVAILABLE_METHODS: TwoFactorMethodType[] = ['totp', 'webauthn', 'email'];

const TwoFactorSection: React.FC = () => {
  const methodsQuery = useTwoFactorMethodsQuery();
  const methods = methodsQuery.data ?? null;
  const enrollment = useTwoFactorEnrollment();

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

      {enrollment.message && (
        <div className="alert alert-warning" role="alert">
          {enrollment.message}
        </div>
      )}

      {enrollment.recoveryCodes && (
        <div className="alert alert-info">
          <p>
            <strong>Save these recovery codes now.</strong> Each one signs you in once if you lose
            access to every enrolled method. They are shown only here and cannot be retrieved later.
          </p>
          <ul className="list-unstyled font-monospace mb-3">
            {enrollment.recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => enrollment.setRecoveryCodes(null)}>
            I have saved them
          </button>
        </div>
      )}

      {AVAILABLE_METHODS.map((methodType) => (
        <MethodRow
          key={methodType}
          methodType={methodType}
          isEnabled={methods.includes(methodType)}
          isEnrolling={enrollment.enrolling === methodType}
          isDisabling={enrollment.disabling === methodType}
          step={enrollment.step}
          disableChallengeRequested={enrollment.disableChallengeRequested}
          code={enrollment.code}
          busy={enrollment.busy}
          onStartEnrollment={(m) => void enrollment.startEnrollment(m)}
          onCancelEnrollment={enrollment.cancelEnrollment}
          onTotpOrEmailSubmit={enrollment.handleTotpOrEmailSubmit}
          onWebAuthnContinue={(data) => void enrollment.handleWebAuthnContinue(data)}
          onStartDisable={enrollment.startDisable}
          onCancelDisable={enrollment.cancelDisable}
          onRequestEmailDisableChallenge={() => void enrollment.requestEmailDisableChallenge()}
          onRunWebAuthnDisable={() => void enrollment.runWebAuthnDisable()}
          onConfirmDisable={enrollment.confirmDisable}
          onCodeChange={enrollment.setCode}
          onRequestDisableChallenge={() => enrollment.setDisableChallengeRequested(true)}
        />
      ))}
    </section>
  );
};

export default TwoFactorSection;
