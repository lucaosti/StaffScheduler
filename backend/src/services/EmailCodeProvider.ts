/**
 * Email one-time-code provider (#588, part of #331).
 *
 * Enrollment needs no separate setup ceremony beyond proving the address is
 * reachable: `beginSetup` sends a code and stores its hash; `confirmEnable`
 * verifies it, same two-step shape as TOTP (so a delivery failure or typo'd
 * inbox during setup cannot leave the method half-enabled).
 *
 * Unlike TOTP, a login-time code cannot be computed from a stored secret —
 * it has to be generated and DELIVERED first. `requestChallenge` is that
 * extra step (declared optional on `TwoFactorMethodProvider` since TOTP has
 * no equivalent): it overwrites the pending code with a fresh one and queues
 * it as an `email_outbox` row directly (no `notifications` row — a one-time
 * code sitting in someone's in-app notification list is a code left lying
 * around, the opposite of what "single-use, time-limited" is for), so
 * delivery goes through the SAME transactional-outbox worker as every other
 * outbound email, with the same retry behaviour.
 *
 * `isEmailConfigured()` gates every operation that would need to send: this
 * provider genuinely cannot function without SMTP, so it fails loudly at
 * setup/challenge time rather than silently enrolling a method nothing can
 * ever deliver a code for.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createHash, randomInt } from 'crypto';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { isEmailConfigured } from './MailerService';
import { logger } from '../config/logger';
import { TwoFactorMethodProvider, TwoFactorSetupPayload } from './TwoFactorMethodProvider';

/** 10 minutes — long enough for an inbox check, short enough that a stale code isn't a standing risk. */
const CODE_TTL_MS = 10 * 60 * 1000;

interface EmailCodeSecretData {
  /** SHA-256 hex of the current pending/active code. A short numeric code is low-entropy, so bcrypt's per-hash cost buys nothing an expiry + single-use guard doesn't already provide; a fast hash keeps verifyCode cheap under a login-path rate limiter. */
  codeHash: string;
  expiresAt: string;
}

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

const parseSecretData = (raw: unknown): EmailCodeSecretData | null => {
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

export class EmailCodeProvider implements TwoFactorMethodProvider {
  readonly type = 'email' as const;

  constructor(private pool: Pool) {}

  private async sendCode(userId: number, code: string): Promise<void> {
    if (!isEmailConfigured()) {
      throw new ConflictError('Email delivery is not configured — the email 2FA method is unavailable');
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT email FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const recipient = rows[0]?.email as string | undefined;
    if (!recipient) throw new NotFoundError('User not found');
    await this.pool.execute(
      `INSERT INTO email_outbox (notification_id, recipient_email, subject, body)
       VALUES (NULL, ?, ?, ?)`,
      [recipient, 'Your verification code', `Your Staff Scheduler verification code is ${code}. It expires in 10 minutes.`]
    );
  }

  async beginSetup(userId: number, _accountLabel: string): Promise<TwoFactorSetupPayload> {
    const code = generateCode();
    const secretData: EmailCodeSecretData = {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    };
    await this.sendCode(userId, code);
    await this.pool.execute(
      `INSERT INTO two_factor_methods (user_id, method_type, enabled, secret_data)
       VALUES (?, 'email', 0, ?)
       ON DUPLICATE KEY UPDATE enabled = 0, secret_data = VALUES(secret_data)`,
      [userId, JSON.stringify(secretData)]
    );
    logger.info(`2FA (email) setup started for user ${userId}`);
    return {};
  }

  async confirmEnable(userId: number, code: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'email' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData) throw new ConflictError('2FA setup has not been started');
    if (rows[0].enabled) throw new ConflictError('2FA is already enabled');
    if (!this.matches(secretData, code)) throw new ValidationError('Invalid or expired verification code');

    await this.pool.execute(
      `UPDATE two_factor_methods SET enabled = 1, secret_data = NULL WHERE user_id = ? AND method_type = 'email'`,
      [userId]
    );
    logger.info(`2FA (email) enabled for user ${userId}`);
  }

  async disable(userId: number): Promise<void> {
    await this.pool.execute(
      `DELETE FROM two_factor_methods WHERE user_id = ? AND method_type = 'email'`,
      [userId]
    );
    logger.info(`2FA (email) disabled for user ${userId}`);
  }

  /** Generates and sends a fresh code for an already-enabled method — the step TOTP never needs, since its code is computed rather than delivered. */
  async requestChallenge(userId: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'email' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) throw new ConflictError('Email 2FA is not enabled for this account');

    const code = generateCode();
    const secretData: EmailCodeSecretData = {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    };
    await this.sendCode(userId, code);
    await this.pool.execute(
      `UPDATE two_factor_methods SET secret_data = ? WHERE user_id = ? AND method_type = 'email'`,
      [JSON.stringify(secretData), userId]
    );
    logger.info(`2FA (email) challenge code sent to user ${userId}`);
  }

  private matches(secretData: EmailCodeSecretData, code: string): boolean {
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
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'email' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) return false;
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData || !this.matches(secretData, code)) return false;

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE two_factor_methods
          SET secret_data = NULL
        WHERE user_id = ? AND method_type = 'email'
          AND JSON_EXTRACT(secret_data, '$.codeHash') = ?`,
      [userId, secretData.codeHash]
    );
    return result.affectedRows > 0;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'email' LIMIT 1`,
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].enabled);
  }
}
