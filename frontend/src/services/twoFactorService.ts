/**
 * Two-factor service — wraps `/api/auth/2fa` and the pre-session
 * `/api/auth/login/challenge` (#591, part of #331).
 *
 * ENROLMENT IS TWO STEPS ON PURPOSE, and the service keeps them separate so a
 * caller cannot collapse them. `setup` generates provider-specific setup data
 * and stores it with the method still UNPROTECTED; `enable` turns the method
 * on only once the person has produced a code/response from it. Doing it in
 * one step would lock people out whenever the setup data failed to reach
 * them (an email undelivered, a secret never scanned).
 *
 * The recovery codes come back exactly once, from `enable` — but only the
 * FIRST time any method is enabled for the account; a second method reuses
 * the existing set (see `TwoFactorService.confirmEnable` on the backend).
 * They are not fetchable afterwards, which is what makes them a fallback
 * rather than a second copy of a secret — so the UI has one chance to show
 * them.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { apiClient } from '../api/client';

export type TwoFactorMethodType = 'totp' | 'webauthn' | 'email' | 'sms';

/** Provider-specific setup data. TOTP: `{ secret, otpauthUri }`. WebAuthn: `PublicKeyCredentialCreationOptionsJSON`. Email: `{}` (nothing to show — it sends the code directly). */
export type TwoFactorSetup = Record<string, unknown>;

export interface TwoFactorEnabled {
  /** Non-empty only the first time ANY method is enabled for the account. */
  recoveryCodes: string[];
}

/** Provider-specific challenge payload. WebAuthn: `PublicKeyCredentialRequestOptionsJSON`. Email: `null` (delivered out of band). */
export type TwoFactorChallenge = Record<string, unknown> | null;

export const listTwoFactorMethods = (): Promise<ApiResponse<{ methods: TwoFactorMethodType[] }>> =>
  apiClient.get<{ methods: TwoFactorMethodType[] }, '/auth/2fa/methods'>('/auth/2fa/methods');

export const beginTwoFactorSetup = (
  methodType: TwoFactorMethodType = 'totp'
): Promise<ApiResponse<TwoFactorSetup>> =>
  apiClient.post<TwoFactorSetup, '/auth/2fa/setup'>('/auth/2fa/setup', { methodType });

export const enableTwoFactor = (
  code: string,
  methodType: TwoFactorMethodType = 'totp'
): Promise<ApiResponse<TwoFactorEnabled>> =>
  apiClient.post<TwoFactorEnabled, '/auth/2fa/enable'>('/auth/2fa/enable', { code, methodType });

/**
 * Turning a method off demands the same proof of possession as signing in
 * with it: a current code/response for THAT method, or an unused recovery
 * code (method-agnostic — it proves account ownership).
 */
export const disableTwoFactor = (
  code: string,
  methodType: TwoFactorMethodType = 'totp'
): Promise<ApiResponse<void>> =>
  apiClient.post<void, '/auth/2fa/disable'>('/auth/2fa/disable', { code, methodType });

/**
 * Requests a fresh challenge for an already-enabled method — needed before
 * a code/response can be produced for email (a code must be sent first) or
 * WebAuthn (the browser needs a fresh server challenge to call
 * `navigator.credentials.get()`). TOTP needs no challenge: its code is
 * computed from a secret the account already has.
 */
export const requestTwoFactorChallenge = (
  methodType: TwoFactorMethodType
): Promise<ApiResponse<TwoFactorChallenge>> =>
  apiClient.post<TwoFactorChallenge, '/auth/2fa/challenge'>('/auth/2fa/challenge', { methodType });

/**
 * The pre-session equivalent of `requestTwoFactorChallenge`, for use during
 * login before a session exists — re-verifies email+password server-side
 * (see `routes/auth.ts` for why: an unauthenticated caller must not be able
 * to trigger an email send, or learn a WebAuthn credential exists, for an
 * arbitrary address by guessing it).
 */
export const requestLoginChallenge = (
  email: string,
  password: string,
  methodType: TwoFactorMethodType
): Promise<ApiResponse<TwoFactorChallenge>> =>
  apiClient.post<TwoFactorChallenge, '/auth/login/challenge'>('/auth/login/challenge', {
    email,
    password,
    methodType,
  });
