/**
 * TOTP provider (#586, part of #331) — the first implementation of
 * `TwoFactorMethodProvider`, refactored out of the pre-registry
 * `TwoFactorService` without changing its runtime behaviour.
 *
 * Enrollment data (`secret`, `lastCounter`) lives as JSON in
 * `two_factor_methods.secret_data` for the `('user_id', 'totp')` row,
 * instead of dedicated `users` columns — see the migration header for why.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { buildOtpauthUri, generateSecret, matchTotpCounter } from '../utils/totp';
import { logger } from '../config/logger';
import { TwoFactorMethodProvider, TwoFactorSetupPayload } from './TwoFactorMethodProvider';

interface TotpSecretData {
  secret: string;
  lastCounter: number | null;
}

const parseSecretData = (raw: unknown): TotpSecretData | null => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed?.secret === 'string' ? { secret: parsed.secret, lastCounter: parsed.lastCounter ?? null } : null;
  } catch {
    return null;
  }
};

export class TotpProvider implements TwoFactorMethodProvider {
  readonly type = 'totp' as const;

  constructor(private pool: Pool) {}

  async beginSetup(userId: number, accountLabel: string): Promise<TwoFactorSetupPayload> {
    const secret = generateSecret();
    const secretData: TotpSecretData = { secret, lastCounter: null };
    await this.pool.execute(
      `INSERT INTO two_factor_methods (user_id, method_type, enabled, secret_data)
       VALUES (?, 'totp', 0, ?)
       ON DUPLICATE KEY UPDATE enabled = 0, secret_data = VALUES(secret_data)`,
      [userId, JSON.stringify(secretData)]
    );
    const otpauthUri = buildOtpauthUri({
      issuer: 'Staff Scheduler',
      account: accountLabel,
      secretBase32: secret,
    });
    logger.info(`2FA (TOTP) setup started for user ${userId}`);
    return { secret, otpauthUri };
  }

  async confirmEnable(userId: number, code: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'totp' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) throw new NotFoundError('User not found');
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData) throw new ConflictError('2FA setup has not been started');
    if (rows[0].enabled) throw new ConflictError('2FA is already enabled');
    if (matchTotpCounter(secretData.secret, code) === null) throw new ValidationError('Invalid verification code');

    await this.pool.execute(
      `UPDATE two_factor_methods SET enabled = 1 WHERE user_id = ? AND method_type = 'totp'`,
      [userId]
    );
    logger.info(`2FA (TOTP) enabled for user ${userId}`);
  }

  async disable(userId: number): Promise<void> {
    await this.pool.execute(
      `DELETE FROM two_factor_methods WHERE user_id = ? AND method_type = 'totp'`,
      [userId]
    );
    logger.info(`2FA (TOTP) disabled for user ${userId}`);
  }

  /**
   * Returns true iff `code` is a current TOTP for the user AND has not been
   * used before. The matched time-step counter is persisted with a
   * compare-and-set guard, so a code accepted once cannot be replayed within
   * its validity window — not even by a concurrent login racing this one.
   */
  async verifyCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled, secret_data FROM two_factor_methods WHERE user_id = ? AND method_type = 'totp' LIMIT 1`,
      [userId]
    );
    if (rows.length === 0 || !rows[0].enabled) return false;
    const secretData = parseSecretData(rows[0].secret_data);
    if (!secretData) return false;

    const counter = matchTotpCounter(secretData.secret, code);
    if (counter === null) return false;

    if (secretData.lastCounter !== null && counter <= Number(secretData.lastCounter)) {
      logger.warn(`Replayed TOTP code rejected for user ${userId}`);
      return false;
    }

    // Compare-and-set via JSON_SET, scoped on the previous lastCounter value
    // (NULL-safe with <=>): only wins if no concurrent login recorded this
    // (or a later) step first. affectedRows = 0 means we lost the race.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE two_factor_methods
          SET secret_data = JSON_SET(secret_data, '$.lastCounter', ?)
        WHERE user_id = ? AND method_type = 'totp'
          AND JSON_EXTRACT(secret_data, '$.lastCounter') <=> ?`,
      [counter, userId, secretData.lastCounter]
    );
    return result.affectedRows > 0;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT enabled FROM two_factor_methods WHERE user_id = ? AND method_type = 'totp' LIMIT 1`,
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].enabled);
  }
}
