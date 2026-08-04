/**
 * WebAuthn / passkey provider (#587, part of #331).
 *
 * The registry (`two_factor_methods`, UNIQUE on (user_id, method_type))
 * holds one row per user per method, so this supports one passkey per user
 * — enough for the 2FA use case this framework targets (a second factor,
 * not a full passwordless multi-device passkey manager). `secret_data`
 * carries the pending ceremony challenge (registration OR authentication,
 * whichever is in flight) alongside the persisted credential once enrolled:
 * `{ pendingChallenge, pendingChallengeExpiresAt, credentialId,
 * publicKeyBase64, counter, transports }`. `publicKey` is a raw byte buffer
 * the library returns as a `Uint8Array` — base64-encoded for JSON storage,
 * decoded back into a `Uint8Array` whenever a credential is reconstructed
 * for `verifyAuthenticationResponse`.
 *
 * `code` on `confirmEnable`/`verifyCode` is a JSON-stringified
 * `RegistrationResponseJSON`/`AuthenticationResponseJSON` — the interface's
 * `code: string` parameter is reused rather than widened, so no other layer
 * (TwoFactorService, routes, schemas) needs to know WebAuthn's payload is
 * richer than a 6-digit code.
 *
 * Unlike TOTP, a WebAuthn assertion cannot be produced without a FRESH
 * server-issued challenge, and unlike email, that challenge cannot be
 * delivered out of band — the browser needs it synchronously to run
 * `navigator.credentials.get()`. `requestChallenge` therefore RETURNS the
 * challenge (a `PublicKeyCredentialRequestOptionsJSON`) rather than sending
 * it anywhere.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { config } from '../config';
import { logger } from '../config/logger';
import { TwoFactorMethodProvider, TwoFactorSetupPayload } from './TwoFactorMethodProvider';

/** 5 minutes — a WebAuthn ceremony is a single synchronous browser interaction, not an inbox check. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const RP_NAME = 'Staff Scheduler';
/** The relying party ID is the bare hostname `CORS_ORIGIN` resolves to — WebAuthn requires no scheme/port. */
const RP_ID = new URL(config.cors.origin).hostname;

interface WebAuthnSecretData {
  pendingChallenge: string | null;
  pendingChallengeExpiresAt: string | null;
  credentialId: string | null;
  publicKeyBase64: string | null;
  counter: number | null;
  transports: AuthenticatorTransportFuture[] | null;
}

const EMPTY_SECRET_DATA: WebAuthnSecretData = {
  pendingChallenge: null,
  pendingChallengeExpiresAt: null,
  credentialId: null,
  publicKeyBase64: null,
  counter: null,
  transports: null,
};

const parseSecretData = (raw: unknown): WebAuthnSecretData | null => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed === 'object' && parsed !== null ? { ...EMPTY_SECRET_DATA, ...parsed } : null;
  } catch {
    return null;
  }
};

const challengeExpired = (data: WebAuthnSecretData): boolean =>
  !data.pendingChallenge || !data.pendingChallengeExpiresAt || new Date(data.pendingChallengeExpiresAt).getTime() < Date.now();

const toCredential = (data: WebAuthnSecretData): WebAuthnCredential => ({
  id: data.credentialId as string,
  publicKey: new Uint8Array(Buffer.from(data.publicKeyBase64 as string, 'base64')),
  counter: data.counter ?? 0,
  transports: data.transports ?? undefined,
});

export class WebAuthnProvider implements TwoFactorMethodProvider {
  readonly type = 'webauthn' as const;

  constructor(private pool: Pool) {}

  async beginSetup(userId: number, accountLabel: string): Promise<TwoFactorSetupPayload> {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: accountLabel,
      userID: new Uint8Array(Buffer.from(`user-${userId}`)),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    const secretData: WebAuthnSecretData = {
      ...EMPTY_SECRET_DATA,
      pendingChallenge: options.challenge,
      pendingChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    };
    await this.pool.execute(
      `INSERT INTO two_factor_methods (user_id, method_type, enabled, secret_data)
       VALUES (?, 'webauthn', 0, ?)
       ON DUPLICATE KEY UPDATE enabled = 0, secret_data = VALUES(secret_data)`,
      [userId, JSON.stringify(secretData)]
    );
    logger.info(`2FA (WebAuthn) setup started for user ${userId}`);
    return { ...options };
  }

  async confirmEnable(userId: number, code: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'webauthn' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData?.pendingChallenge) throw new ConflictError('2FA setup has not been started');
    if (rows[0].enabled) throw new ConflictError('2FA is already enabled');
    if (challengeExpired(secretData)) throw new ValidationError('Registration challenge has expired — start setup again');

    let response: RegistrationResponseJSON;
    try {
      response = JSON.parse(code) as RegistrationResponseJSON;
    } catch {
      throw new ValidationError('Invalid registration response');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: secretData.pendingChallenge,
      expectedOrigin: config.cors.origin,
      expectedRPID: RP_ID,
    }).catch(() => null);
    if (!verification?.verified) throw new ValidationError('Invalid registration response');

    const { credential } = verification.registrationInfo;
    const enrolled: WebAuthnSecretData = {
      ...EMPTY_SECRET_DATA,
      credentialId: credential.id,
      publicKeyBase64: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: credential.transports ?? null,
    };
    await this.pool.execute(
      `UPDATE two_factor_methods SET enabled = 1, secret_data = ? WHERE user_id = ? AND method_type = 'webauthn'`,
      [JSON.stringify(enrolled), userId]
    );
    logger.info(`2FA (WebAuthn) enabled for user ${userId}`);
  }

  async disable(userId: number): Promise<void> {
    await this.pool.execute(
      `DELETE FROM two_factor_methods WHERE user_id = ? AND method_type = 'webauthn'`,
      [userId]
    );
    logger.info(`2FA (WebAuthn) disabled for user ${userId}`);
  }

  /** Issues a fresh authentication challenge for the user's enrolled passkey. Returns it — there is nowhere to deliver it TO, the browser needs it directly. */
  async requestChallenge(userId: number): Promise<Record<string, unknown>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'webauthn' LIMIT 1`,
      [userId]
    );
    const secretData = rows.length > 0 ? parseSecretData(rows[0].secret_data) : null;
    if (rows.length === 0 || !rows[0].enabled || !secretData?.credentialId) {
      throw new ConflictError('WebAuthn 2FA is not enabled for this account');
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: [{ id: secretData.credentialId, transports: secretData.transports ?? undefined }],
      userVerification: 'preferred',
    });

    const updated: WebAuthnSecretData = {
      ...secretData,
      pendingChallenge: options.challenge,
      pendingChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    };
    await this.pool.execute(
      `UPDATE two_factor_methods SET secret_data = ? WHERE user_id = ? AND method_type = 'webauthn'`,
      [JSON.stringify(updated), userId]
    );
    logger.info(`2FA (WebAuthn) challenge issued for user ${userId}`);
    return { ...options };
  }

  /**
   * Verifies an assertion produced against a challenge from `requestChallenge`.
   * Single-use via a compare-and-set on the pending challenge, same shape as
   * every other provider's replay guard.
   */
  async verifyCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'webauthn' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) return false;
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData?.credentialId || !secretData.pendingChallenge || challengeExpired(secretData)) return false;

    let response: AuthenticationResponseJSON;
    try {
      response = JSON.parse(code) as AuthenticationResponseJSON;
    } catch {
      return false;
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: secretData.pendingChallenge,
      expectedOrigin: config.cors.origin,
      expectedRPID: RP_ID,
      credential: toCredential(secretData),
    }).catch(() => null);
    if (!verification?.verified) return false;

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE two_factor_methods
          SET secret_data = JSON_SET(secret_data, '$.counter', ?, '$.pendingChallenge', NULL, '$.pendingChallengeExpiresAt', NULL)
        WHERE user_id = ? AND method_type = 'webauthn'
          AND JSON_EXTRACT(secret_data, '$.pendingChallenge') = ?`,
      [verification.authenticationInfo.newCounter, userId, secretData.pendingChallenge]
    );
    return result.affectedRows > 0;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'webauthn' LIMIT 1`,
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].enabled);
  }
}
