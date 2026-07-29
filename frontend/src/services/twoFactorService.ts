/**
 * Two-factor service — wraps `/api/auth/2fa`.
 *
 * ENROLMENT IS TWO STEPS ON PURPOSE, and the service keeps them separate so a
 * caller cannot collapse them. `setup` generates a secret and stores it with
 * the account still UNPROTECTED; `enable` turns 2FA on only once the person
 * has produced a code from it. Doing it in one step would lock people out of
 * their own accounts whenever the secret failed to reach their authenticator.
 *
 * The recovery codes come back exactly once, from `enable`. They are not
 * fetchable afterwards — that is what makes them a fallback rather than a
 * second copy of the secret — so the UI has one chance to show them.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { apiClient } from '../api/client';

export interface TwoFactorSetup {
  secret: string;
  /** `otpauth://` URI an authenticator app scans or accepts pasted. */
  otpauthUri: string;
}

export interface TwoFactorEnabled {
  /** Shown once and never retrievable again. */
  recoveryCodes: string[];
}

export const beginTwoFactorSetup = (): Promise<ApiResponse<TwoFactorSetup>> =>
  apiClient.post<TwoFactorSetup, '/auth/2fa/setup'>('/auth/2fa/setup', undefined);

export const enableTwoFactor = (code: string): Promise<ApiResponse<TwoFactorEnabled>> =>
  apiClient.post<TwoFactorEnabled, '/auth/2fa/enable'>('/auth/2fa/enable', { code });

/**
 * Turning 2FA off demands the same proof of possession as signing in: a
 * current code, or an unused recovery code.
 */
export const disableTwoFactor = (code: string): Promise<ApiResponse<void>> =>
  apiClient.post<void, '/auth/2fa/disable'>('/auth/2fa/disable', { code });
