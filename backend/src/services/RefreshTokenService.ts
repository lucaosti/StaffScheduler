/**
 * Refresh-token service — issue, rotate, verify and revoke long-lived sessions.
 *
 * Why this exists: access tokens are now short-lived (minutes), so the client
 * needs a way to obtain a fresh access token without re-entering credentials.
 * The previous `/refresh` merely re-signed an access token while the old one
 * was still valid, which is not a session mechanism at all — a stolen access
 * token could be refreshed indefinitely and there was no server-side session
 * to revoke. This service implements the standard rotating-refresh-token model.
 *
 * Security design (see the migration for the schema rationale):
 * - The opaque token is 256 bits of CSPRNG randomness; only its SHA-256 hash
 *   is stored, so a DB leak yields nothing usable. Hashing (not bcrypt) is
 *   correct here because the token is already high-entropy — there is no weak
 *   secret to stretch, and lookup must stay a single indexed equality.
 * - Every refresh ROTATES: the presented token is revoked and a successor is
 *   issued in the same family. Replaying an already-rotated token is the
 *   signature of a stolen token, so the entire family is revoked — bounding a
 *   leak to one rotation window instead of the full 30-day lifetime.
 * - Verification is constant-work (hash + indexed lookup) and never reveals
 *   why a token failed, so it cannot be used as an oracle.
 *
 * Alternatives considered: (a) stateless refresh JWTs — rejected because they
 * cannot be revoked server-side, which defeats the point of a refresh layer;
 * (b) storing tokens in Redis — viable, but refresh tokens are durable session
 * state that must survive a cache flush and be auditable, so MySQL (the
 * system's durable store) is the right home, with Redis reserved for ephemeral
 * caches.
 */

import { createHash, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { config } from '../config';

interface RefreshTokenRow extends RowDataPacket {
  id: number;
  user_id: number;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/** The raw token the client holds plus the row id, returned when issuing/rotating. */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class RefreshTokenService {
  constructor(private pool: Pool) {}

  private ttlMs(): number {
    return config.jwt.refreshExpiresInMs;
  }

  /**
   * Issues a brand-new refresh token for a fresh login, starting a new family.
   * Returns the raw token (the only time it exists in plaintext) for the client
   * cookie.
   */
  async issue(userId: number): Promise<IssuedRefreshToken> {
    const familyId = randomUUID();
    return this.create(userId, familyId);
  }

  /** Inserts a token row for the given family and returns the raw token. */
  private async create(userId: number, familyId: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    await this.pool.execute(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [userId, familyId, hashToken(token), expiresAt]
    );
    return { token, expiresAt };
  }

  /**
   * Rotates a presented refresh token. Returns the userId and a fresh token on
   * success, or null when the token is unknown/expired/reused — the caller maps
   * null to a 401 and clears the cookie. Reuse of an already-rotated token
   * revokes the whole family as a side effect.
   */
  async rotate(presentedToken: string): Promise<{ userId: number; issued: IssuedRefreshToken } | null> {
    const [rows] = await this.pool.execute<RefreshTokenRow[]>(
      `SELECT id, user_id, family_id, expires_at, revoked_at
         FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
      [hashToken(presentedToken)]
    );
    const row = rows[0];
    if (!row) return null; // unknown token

    if (row.revoked_at !== null) {
      // Reuse of a spent token → a stolen copy is being replayed. Revoke the
      // entire family so neither the attacker's nor the victim's chain works.
      await this.revokeFamily(row.family_id);
      return null;
    }

    if (row.expires_at.getTime() <= Date.now()) {
      return null; // expired
    }

    // Valid: mark this token revoked, issue a successor in the same family, and
    // link them for auditability.
    const issued = await this.create(row.user_id, row.family_id);
    const [successor] = await this.pool.execute<RefreshTokenRow[]>(
      `SELECT id FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
      [hashToken(issued.token)]
    );
    await this.pool.execute(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP, replaced_by = ?
        WHERE id = ? AND revoked_at IS NULL`,
      [successor[0]?.id ?? null, row.id]
    );

    return { userId: row.user_id, issued };
  }

  /** Revokes a single token (e.g. on logout). Silent when the token is unknown. */
  async revoke(presentedToken: string): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = ? AND revoked_at IS NULL`,
      [hashToken(presentedToken)]
    );
  }

  /** Revokes every still-active token in a family (reuse response / global sign-out). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE family_id = ? AND revoked_at IS NULL`,
      [familyId]
    );
  }

  /** Revokes every active token for a user (e.g. "sign out everywhere"). */
  async revokeAllForUser(userId: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL`,
      [userId]
    );
  }

  /**
   * Deletes expired and long-revoked rows so the table does not grow without
   * bound. Kept simple (a single DELETE) and safe to run on a schedule; expired
   * tokens are already unusable, so removing them changes no behaviour.
   */
  async pruneExpired(): Promise<number> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM refresh_tokens
        WHERE expires_at < CURRENT_TIMESTAMP
           OR (revoked_at IS NOT NULL AND revoked_at < (CURRENT_TIMESTAMP - INTERVAL 7 DAY))`
    );
    return res.affectedRows;
  }
}
