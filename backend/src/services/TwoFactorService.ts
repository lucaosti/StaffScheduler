/**
 * Two-factor authentication service (F15) — method-registry dispatcher (#586, part of #331).
 *
 * Delegates enrollment/verification to a `TwoFactorMethodProvider` keyed by
 * `TwoFactorMethodType` (TOTP #586, email #588, and WebAuthn #587 are
 * registered so far — SMS #589 adds its own provider to the same map, with
 * no change needed here or in the routes). Recovery codes stay here,
 * centrally, one set per user regardless of how many methods are enrolled —
 * they prove account ownership, not possession of a specific method.
 *
 * Every public method defaults `methodType` to `'totp'`, so this refactor is
 * a no-op from every existing call site's perspective (routes/auth.ts,
 * routes/twoFactor.ts) until a second provider is registered and a caller
 * explicitly asks for it.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError } from '../errors';
import bcrypt from 'bcrypt';
import { generateRecoveryCodes } from '../utils/totp';
import { config } from '../config';
import { logger } from '../config/logger';
import { TwoFactorMethodProvider, TwoFactorMethodType, TwoFactorSetupPayload } from './TwoFactorMethodProvider';
import { TotpProvider } from './TotpProvider';
import { EmailCodeProvider } from './EmailCodeProvider';
import { WebAuthnProvider } from './WebAuthnProvider';

interface TwoFactorEnablePayload {
  /** Only non-empty the FIRST time any method is enabled for the user — a second method reuses the existing recovery codes. */
  recoveryCodes: string[];
}

export class TwoFactorService {
  private readonly providers: Partial<Record<TwoFactorMethodType, TwoFactorMethodProvider>>;

  constructor(private pool: Pool) {
    // Partial: SMS doesn't have a provider registered yet (#589) —
    // resolveProvider throws a clear error for it rather than a Record
    // forcing a placeholder entry into existence.
    this.providers = {
      totp: new TotpProvider(pool),
      email: new EmailCodeProvider(pool),
      webauthn: new WebAuthnProvider(pool),
    };
  }

  private resolveProvider(methodType: TwoFactorMethodType): TwoFactorMethodProvider {
    const provider = this.providers[methodType];
    if (!provider) throw new ConflictError(`Two-factor method '${methodType}' is not available`);
    return provider;
  }

  /**
   * Requests a fresh challenge for an already-enabled method (email #588,
   * SMS #589 send it out of band and return nothing; WebAuthn #587 has no
   * delivery channel — the challenge itself is what the caller returns to
   * the client). Throws for a method whose provider doesn't implement this,
   * same as an unregistered method type.
   */
  async requestChallenge(userId: number, methodType: TwoFactorMethodType): Promise<Record<string, unknown> | void> {
    const provider = this.resolveProvider(methodType);
    if (!provider.requestChallenge) {
      throw new ConflictError(`Two-factor method '${methodType}' does not use a requested challenge`);
    }
    return provider.requestChallenge(userId);
  }

  async beginSetup(userId: number, accountLabel: string, methodType: TwoFactorMethodType = 'totp'): Promise<TwoFactorSetupPayload> {
    return this.resolveProvider(methodType).beginSetup(userId, accountLabel);
  }

  /**
   * Step 2 of enrollment. Recovery codes are generated once — the first time
   * ANY method is enabled for the user — and reused across further methods,
   * since they authenticate the account, not the method.
   */
  async confirmEnable(userId: number, code: string, methodType: TwoFactorMethodType = 'totp'): Promise<TwoFactorEnablePayload> {
    await this.resolveProvider(methodType).confirmEnable(userId, code);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT two_factor_recovery_codes FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length > 0 && rows[0].two_factor_recovery_codes) {
      logger.info(`2FA method '${methodType}' enabled for user ${userId} (existing recovery codes kept)`);
      return { recoveryCodes: [] };
    }

    const codes = generateRecoveryCodes(10);
    const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, config.security.bcryptRounds)));
    await this.pool.execute(
      `UPDATE users SET two_factor_recovery_codes = ? WHERE id = ?`,
      [JSON.stringify(hashed), userId]
    );
    logger.info(`2FA method '${methodType}' enabled for user ${userId} (recovery codes issued)`);
    return { recoveryCodes: codes };
  }

  /**
   * Removes one method's enrollment. When that was the user's last enabled
   * method, recovery codes are cleared too — they authenticate "you have a
   * working second factor," which is no longer true once none remain.
   */
  async disable(userId: number, methodType: TwoFactorMethodType = 'totp'): Promise<void> {
    await this.resolveProvider(methodType).disable(userId);

    const stillEnabled = await this.hasAnyEnabled(userId);
    if (!stillEnabled) {
      await this.pool.execute(`UPDATE users SET two_factor_recovery_codes = NULL WHERE id = ?`, [userId]);
    }
    logger.info(`2FA method '${methodType}' disabled for user ${userId}`);
  }

  async verifyCode(userId: number, code: string, methodType: TwoFactorMethodType = 'totp'): Promise<boolean> {
    return this.resolveProvider(methodType).verifyCode(userId, code);
  }

  async isEnabled(userId: number, methodType: TwoFactorMethodType = 'totp'): Promise<boolean> {
    return this.resolveProvider(methodType).isEnabled(userId);
  }

  /** True iff the user has at least one enrolled, enabled method of any type. */
  async hasAnyEnabled(userId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM two_factor_methods WHERE user_id = ? AND enabled = 1 LIMIT 1`,
      [userId]
    );
    return rows.length > 0;
  }

  /**
   * Tries `code` against the stored hashed recovery codes; on match,
   * removes that code from the list (single-use) and returns true.
   */
  async consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT two_factor_recovery_codes FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return false;
    const stored = rows[0].two_factor_recovery_codes as string | null;
    if (!stored) return false;
    let codes: string[];
    try {
      codes = JSON.parse(stored) as string[];
    } catch {
      return false;
    }
    for (let i = 0; i < codes.length; i++) {
      const matches = await bcrypt.compare(code, codes[i]);
      if (matches) {
        const remaining = [...codes.slice(0, i), ...codes.slice(i + 1)];
        // Compare-and-set on the previous value: if a concurrent login
        // consumed a code in the meantime the stored JSON no longer matches,
        // affectedRows is 0 and this attempt is rejected instead of silently
        // resurrecting the concurrently-consumed code.
        const [result] = await this.pool.execute<ResultSetHeader>(
          `UPDATE users SET two_factor_recovery_codes = ?
            WHERE id = ? AND two_factor_recovery_codes = ?`,
          [JSON.stringify(remaining), userId, stored]
        );
        return result.affectedRows > 0;
      }
    }
    return false;
  }
}
