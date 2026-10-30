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
 * - Rotation CLAIMS the presented token before issuing anything (#820): one
 *   conditional UPDATE (`... WHERE revoked_at IS NULL`) inside a transaction,
 *   and a successor only when it affected exactly one row. Reading first and
 *   revoking afterwards let two concurrent requests with the same token both
 *   pass the read and both receive a live successor — a forked family that
 *   reuse detection never saw. The row lock the claim takes serialises the
 *   race: the loser's UPDATE waits for the winner's commit, then matches
 *   nothing.
 * - A token re-presented within CONCURRENT_REFRESH_GRACE_SECONDS of being
 *   rotated is answered `superseded`: no successor (so no fork) and no family
 *   revocation. Two tabs refreshing at once — opening several after the
 *   access token expired, a browser restoring a session — is the ordinary
 *   case, and treating its loser as reuse would sign the user out of every
 *   tab. A replay inside the window obtains nothing, and any replay after it
 *   still revokes the family. What the window does cost: a thief who rotates
 *   a stolen token FIRST leaves the victim with `superseded`, not with a
 *   reuse that kills the thief's chain. The client closes that gap — when its
 *   backed-off retries all come back superseded, the successor went
 *   somewhere else, so it calls logout, which revokes by family
 *   (frontend `authService.refreshToken`). A server-side rule ("reuse once
 *   the successor has itself been rotated") was rejected: a thief need not
 *   rotate again within the window, so it would not fire. Rejected alternatives:
 *   handing the loser the SAME successor (impossible without storing the
 *   plaintext successor, which defeats hash-only storage) and minting the
 *   loser a sibling token (exactly the fork this fixes).
 * - Logout, a password change and deactivation revoke server-side (#816,
 *   #818): logout the presented token's whole family, the other two every
 *   family the user has.
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
import { usingConnection } from '../utils/transaction';

type SqlExecutor = Pick<Pool, 'execute'>;

/**
 * How long after a rotation the rotated token is still recognised as a
 * concurrent refresh rather than reuse (see the header). Long enough to cover
 * parallel requests on a slow mobile link, short enough that a stolen copy
 * replayed any later still trips reuse detection.
 */
export const CONCURRENT_REFRESH_GRACE_SECONDS = 10;

/** The raw token the client holds plus the row id, returned when issuing/rotating. */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/**
 * - `rotated`: the token was valid and claimed by this call; `issued` is its successor.
 * - `superseded`: a concurrent (or just-finished) rotation claimed it first.
 *   Nothing was issued or revoked; the client should retry with the
 *   successor it now holds.
 * - `invalid`: unknown, expired, revoked or reused — the session is over.
 */
export type RotationResult =
  | { status: 'rotated'; userId: number; issued: IssuedRefreshToken }
  | { status: 'superseded' }
  | { status: 'invalid' };

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

  /** Inserts a token row for the given family and returns the raw token and its row id. */
  private async create(
    userId: number,
    familyId: string,
    executor: SqlExecutor = this.pool
  ): Promise<IssuedRefreshToken & { id: number }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const [res] = await executor.execute<ResultSetHeader>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [userId, familyId, hashToken(token), expiresAt]
    );
    return { token, expiresAt, id: res.insertId };
  }

  /**
   * Rotates a presented refresh token (see `RotationResult`). Reuse of a token
   * rotated outside the grace window revokes its whole family as a side effect.
   */
  async rotate(presentedToken: string): Promise<RotationResult> {
    const tokenHash = hashToken(presentedToken);
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        // Lock order: the owning users row BEFORE the token row. Issuing the
        // successor takes a shared lock on users.id (the foreign key), while a
        // password change or deactivation holds users X and then revokes the
        // tokens (UserService). Claiming first would hold the token row while
        // waiting on users — the reverse order, and a deadlock. Taking users
        // first makes both paths users → refresh_tokens; a rotation that
        // waits for a password change then finds its token revoked.
        const [owner] = await connection.execute<RowDataPacket[]>(
          'SELECT user_id FROM refresh_tokens WHERE token_hash = ?',
          [tokenHash]
        );
        if (owner[0]) {
          await connection.execute('SELECT id FROM users WHERE id = ? FOR SHARE', [owner[0].user_id]);
        }
        // The claim. Expiry is compared against a parameter, not the server
        // clock, because `expires_at` was written from this process's clock.
        const [claim] = await connection.execute<ResultSetHeader>(
          `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
            WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
          [tokenHash, new Date()]
        );
        // A locking read: it sees the winner's committed row even when this
        // transaction's claim waited for it, which a snapshot read need not.
        const [rows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, user_id, family_id,
                  revoked_at IS NOT NULL AS revoked,
                  replaced_by IS NOT NULL
                    AND revoked_at > CURRENT_TIMESTAMP - INTERVAL ? SECOND AS within_grace
             FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`,
          [CONCURRENT_REFRESH_GRACE_SECONDS, tokenHash]
        );
        const row = rows[0];

        let result: RotationResult;
        if (claim.affectedRows === 1) {
          const issued = await this.create(row.user_id, row.family_id, connection);
          // Link predecessor to successor: the chain stays auditable, and the
          // grace check needs to tell a rotation from a logout's revocation.
          await connection.execute('UPDATE refresh_tokens SET replaced_by = ? WHERE id = ?', [issued.id, row.id]);
          result = { status: 'rotated', userId: row.user_id, issued: { token: issued.token, expiresAt: issued.expiresAt } };
        } else if (!row || !Number(row.revoked)) {
          result = { status: 'invalid' }; // unknown, or expired before it was ever spent
        } else if (Number(row.within_grace)) {
          result = { status: 'superseded' };
        } else {
          // Reuse of a spent token → a stolen copy is being replayed. Revoke the
          // entire family so neither the attacker's nor the victim's chain works.
          await this.revokeFamily(row.family_id, connection);
          result = { status: 'invalid' };
        }
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  /**
   * Ends the session a presented token belongs to — its whole family, not just
   * the one token, so a successor already issued to another tab dies with it.
   * Silent when the token is unknown: logout must succeed regardless.
   */
  async revokeFamilyOf(presentedToken: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT family_id FROM refresh_tokens WHERE token_hash = ?',
      [hashToken(presentedToken)]
    );
    if (rows[0]) await this.revokeFamily(rows[0].family_id);
  }

  /** Revokes every still-active token in a family (reuse response / logout). */
  async revokeFamily(familyId: string, executor: SqlExecutor = this.pool): Promise<void> {
    await executor.execute<ResultSetHeader>(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE family_id = ? AND revoked_at IS NULL`,
      [familyId]
    );
  }

  /**
   * Revokes every active token for a user — on a password change and on
   * deactivation (#818). Pass the transaction `connection` as `executor` so
   * the revocation commits or rolls back with the change that warrants it.
   */
  async revokeAllForUser(userId: number, executor: SqlExecutor = this.pool): Promise<void> {
    await executor.execute<ResultSetHeader>(
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
