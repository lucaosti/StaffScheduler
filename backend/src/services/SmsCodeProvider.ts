/**
 * SMS one-time-code provider.
 *
 * Structural mirror of `EmailCodeProvider`: a 6-digit code hashed and
 * stored in `secret_data` with an expiry, two-step enrollment (`beginSetup`
 * stores a disabled row, `confirmEnable` proves possession and flips
 * `enabled`), single-use verification via a compare-and-set on the stored
 * hash, and delivery gated by a config check (`isSmsConfigured()` here,
 * `isEmailConfigured()` there).
 *
 * Two differences from the email provider, both because no SMS vendor is
 * implemented (this is an interface-only change — see `SmsService.ts`):
 *
 * - There is no `sms_outbox` table and no outbox worker. Delivery goes
 *   through an injected `SmsProvider` directly rather than through a
 *   transactional queue — there is nothing to queue for until a vendor
 *   exists, and adding a table/worker pair for a delivery path nothing can
 *   use yet would be speculative infrastructure. `smsProvider` defaults to
 *   `undefined`: `TwoFactorService` constructs this provider with none today,
 *   which is fine, because `isSmsConfigured()` is always false, so every
 *   send-capable operation refuses before it would need one.
 * - Recipient number: `users.phone` is read the same way `EmailCodeProvider`
 *   reads `users.email` — via a lookup at send time, not accepted as
 *   `beginSetup` input. Unlike `email` the column is optional (`UserService`
 *   inserts it as `userData.phone || null`), so a missing number is a
 *   distinct, recoverable failure (`ConflictError`, "add a phone number
 *   first") rather than `NotFoundError`, which is reserved for "this user
 *   row does not exist." Reading the profile field rather than collecting a
 *   number mid-setup keeps this consistent with how the codebase already
 *   treats `phone`: a property of the user record, edited via the profile,
 *   not per-feature input.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createHash, randomInt } from 'crypto';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { isSmsConfigured, SmsProvider } from './SmsService';
import { logger } from '../config/logger';
import { TwoFactorMethodProvider, TwoFactorSetupPayload } from './TwoFactorMethodProvider';

/** 10 minutes — same TTL as the email code provider. */
const CODE_TTL_MS = 10 * 60 * 1000;

interface SmsCodeSecretData {
  /** SHA-256 hex of the current pending/active code — see EmailCodeProvider for why a fast hash is fine here. */
  codeHash: string;
  expiresAt: string;
}

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

const parseSecretData = (raw: unknown): SmsCodeSecretData | null => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed?.codeHash === 'string' && typeof parsed?.expiresAt === 'string'
      ? { codeHash: parsed.codeHash, expiresAt: parsed.expiresAt }
      : null;
  } catch {
    return null;
  }
};

export class SmsCodeProvider implements TwoFactorMethodProvider {
  readonly type = 'sms' as const;

  constructor(private pool: Pool, private smsProvider?: SmsProvider) {}

  private async sendCode(userId: number, code: string): Promise<void> {
    if (!isSmsConfigured()) {
      throw new ConflictError('SMS delivery is not configured — the SMS 2FA method is unavailable');
    }
    if (!this.smsProvider) {
      // isSmsConfigured() is always false in this PR, so this branch is
      // unreachable in practice — kept as a defensive check for the day
      // SMS is configured without also injecting a SmsProvider, which
      // should fail loudly here rather than silently drop the code.
      throw new Error('SMS 2FA is configured but no SmsProvider was injected into SmsCodeProvider');
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT phone FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const recipient = rows[0]?.phone as string | null | undefined;
    if (!recipient) throw new ConflictError('No phone number on file for this account');
    await this.smsProvider.send(recipient, `Your Staff Scheduler verification code is ${code}. It expires in 10 minutes.`);
  }

  async beginSetup(userId: number, _accountLabel: string): Promise<TwoFactorSetupPayload> {
    const code = generateCode();
    const secretData: SmsCodeSecretData = {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    };
    await this.sendCode(userId, code);
    await this.pool.execute(
      `INSERT INTO two_factor_methods (user_id, method_type, enabled, secret_data)
       VALUES (?, 'sms', 0, ?)
       ON DUPLICATE KEY UPDATE enabled = 0, secret_data = VALUES(secret_data)`,
      [userId, JSON.stringify(secretData)]
    );
    logger.info(`2FA (sms) setup started for user ${userId}`);
    return {};
  }

  async confirmEnable(userId: number, code: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'sms' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData) throw new ConflictError('2FA setup has not been started');
    if (rows[0].enabled) throw new ConflictError('2FA is already enabled');
    if (!this.matches(secretData, code)) throw new ValidationError('Invalid or expired verification code');

    await this.pool.execute(
      `UPDATE two_factor_methods SET enabled = 1, secret_data = NULL WHERE user_id = ? AND method_type = 'sms'`,
      [userId]
    );
    logger.info(`2FA (sms) enabled for user ${userId}`);
  }

  async disable(userId: number): Promise<void> {
    await this.pool.execute(
      `DELETE FROM two_factor_methods WHERE user_id = ? AND method_type = 'sms'`,
      [userId]
    );
    logger.info(`2FA (sms) disabled for user ${userId}`);
  }

  /** Generates and sends a fresh code for an already-enabled method — mirrors EmailCodeProvider.requestChallenge. */
  async requestChallenge(userId: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'sms' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) throw new ConflictError('SMS 2FA is not enabled for this account');

    const code = generateCode();
    const secretData: SmsCodeSecretData = {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    };
    await this.sendCode(userId, code);
    await this.pool.execute(
      `UPDATE two_factor_methods SET secret_data = ? WHERE user_id = ? AND method_type = 'sms'`,
      [JSON.stringify(secretData), userId]
    );
    logger.info(`2FA (sms) challenge code sent to user ${userId}`);
  }

  private matches(secretData: SmsCodeSecretData, code: string): boolean {
    if (new Date(secretData.expiresAt).getTime() < Date.now()) return false;
    return hashCode(code) === secretData.codeHash;
  }

  /**
   * Verifies a code requested via `requestChallenge`. Single-use: a matched
   * code is cleared via a compare-and-set on its own hash, so a concurrent
   * verification attempt (or replaying the same code twice) cannot both win.
   */
  async verifyCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'sms' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) return false;
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData || !this.matches(secretData, code)) return false;

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE two_factor_methods
          SET secret_data = NULL
        WHERE user_id = ? AND method_type = 'sms'
          AND JSON_EXTRACT(secret_data, '$.codeHash') = ?`,
      [userId, secretData.codeHash]
    );
    return result.affectedRows > 0;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'sms' LIMIT 1`,
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].enabled);
  }
}
