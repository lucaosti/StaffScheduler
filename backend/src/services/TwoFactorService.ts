/**
 * Two-factor authentication service (F15).
 *
 * Stores the TOTP secret on the `users` row. `enable` is gated by a fresh
 * code verification so users cannot lock themselves out. Recovery codes are
 * generated once at enablement and stored as a JSON array; presenting one
 * consumes it (the array shrinks).
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateSecret,
  verifyTotp,
} from '../utils/totp';
import { config } from '../config';
import { logger } from '../config/logger';

export interface TwoFactorSetupPayload {
  secret: string;
  otpauthUri: string;
}

export interface TwoFactorEnablePayload {
  recoveryCodes: string[];
}

export class TwoFactorService {
  constructor(private pool: Pool) {}

  /**
   * Step 1 of enablement: generate a fresh secret, persist it but leave
   * `totp_enabled` false until the user proves they can produce codes.
   */
  async beginSetup(userId: number, accountLabel: string): Promise<TwoFactorSetupPayload> {
    const secret = generateSecret();
    await this.pool.execute(
      `UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`,
      [secret, userId]
    );
    const otpauthUri = buildOtpauthUri({
      issuer: 'Staff Scheduler',
      account: accountLabel,
      secretBase32: secret,
    });
    logger.info(`2FA setup started for user ${userId}`);
    return { secret, otpauthUri };
  }

  /**
   * Step 2 of enablement: verify a code, then mark 2FA enabled and emit
   * recovery codes. Hashes the codes before storage so a DB leak cannot
   * be used to bypass 2FA without further work.
   */
  async confirmEnable(userId: number, code: string): Promise<TwoFactorEnablePayload> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT totp_secret, totp_enabled FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new Error('User not found');
    const secret = rows[0].totp_secret as string | null;
    if (!secret) throw new Error('2FA setup has not been started');
    if (rows[0].totp_enabled) throw new Error('2FA is already enabled');
    if (!verifyTotp(secret, code)) throw new Error('Invalid verification code');

    const codes = generateRecoveryCodes(10);
    const hashed = await Promise.all(
      codes.map((c) => bcrypt.hash(c, config.security.bcryptRounds))
    );
    await this.pool.execute(
      `UPDATE users SET totp_enabled = 1, totp_recovery_codes = ? WHERE id = ?`,
      [JSON.stringify(hashed), userId]
    );
    logger.info(`2FA enabled for user ${userId}`);
    return { recoveryCodes: codes };
  }

  async disable(userId: number): Promise<void> {
    await this.pool.execute(
      `UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery_codes = NULL WHERE id = ?`,
      [userId]
    );
    logger.info(`2FA disabled for user ${userId}`);
  }

  /** Returns true iff `code` is a current TOTP for the user. */
  async verifyCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT totp_secret, totp_enabled FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return false;
    const secret = rows[0].totp_secret as string | null;
    if (!secret || !rows[0].totp_enabled) return false;
    return verifyTotp(secret, code);
  }

  /**
   * Tries `code` against the stored hashed recovery codes; on match,
   * removes that code from the list (single-use) and returns true.
   */
  async consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT totp_recovery_codes FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return false;
    const stored = rows[0].totp_recovery_codes as string | null;
    if (!stored) return false;
    let codes: string[];
    try {
      codes = JSON.parse(stored) as string[];
    } catch {
      return false;
    }
    for (let i = 0; i < codes.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const matches = await bcrypt.compare(code, codes[i]);
      if (matches) {
        codes.splice(i, 1);
        await this.pool.execute(
          `UPDATE users SET totp_recovery_codes = ? WHERE id = ?`,
          [JSON.stringify(codes), userId]
        );
        return true;
      }
    }
    return false;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT totp_enabled FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].totp_enabled);
  }
}
