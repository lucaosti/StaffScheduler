/**
 * Thin wrapper over `@simplewebauthn/browser` for the two WebAuthn 2FA
 * ceremonies (#594, part of #331).
 *
 * Both ceremonies can fail for reasons that have nothing to do with the
 * server (the user cancels the OS passkey prompt, the device has no
 * authenticator, the browser lacks WebAuthn support) — `startRegistration`/
 * `startAuthentication` throw a `DOMException`/`Error` in those cases, not
 * something the caller should render as a generic "request failed". These
 * wrappers translate the common cases into a message a person can act on.
 *
 * @author Luca Ostinelli
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

const friendlyMessage = (err: unknown): string => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError') return 'Passkey request was cancelled or timed out.';
  if (name === 'InvalidStateError') return 'This passkey is already registered.';
  if (typeof window !== 'undefined' && !window.PublicKeyCredential) {
    return 'This browser does not support passkeys.';
  }
  return err instanceof Error ? err.message : 'Passkey request failed.';
};

/** Runs the browser passkey CREATION ceremony and returns the JSON-stringified response `/auth/2fa/enable` expects as `code`. */
export const runWebAuthnRegistration = async (
  optionsJSON: PublicKeyCredentialCreationOptionsJSON
): Promise<string> => {
  try {
    const response = await startRegistration({ optionsJSON });
    return JSON.stringify(response);
  } catch (err) {
    throw new Error(friendlyMessage(err));
  }
};

/** Runs the browser passkey ASSERTION ceremony and returns the JSON-stringified response `/auth/2fa/verify` (or `/auth/login`) expects as `code`. */
export const runWebAuthnAuthentication = async (
  optionsJSON: PublicKeyCredentialRequestOptionsJSON
): Promise<string> => {
  try {
    const response = await startAuthentication({ optionsJSON });
    return JSON.stringify(response);
  } catch (err) {
    throw new Error(friendlyMessage(err));
  }
};
