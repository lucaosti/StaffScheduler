/**
 * Pairing rules: who may, or may not, share a shift with whom.
 *
 * WHY THIS SERVICE EXISTS. The `employee_pairings` table and both engines'
 * handling of it landed together, and the table could only be populated by
 * direct SQL. That is the shape the employment-contract work already rejected
 * once: a capability the system consumes but nobody can use without database
 * access. The constraint is genuinely enforced, so this is not an unwired
 * feature — it is an unreachable one.
 *
 * WHY THE VALIDATION LIVES HERE AND NOT IN THE SCHEMA. Two of the three rules
 * below are relational: they depend on what other rows already exist, which a
 * request schema cannot see. The third (a rule about one person and themself)
 * could be a schema refinement, and is here instead so the three failures a
 * caller can hit are stated in one place.
 *
 * THE CONTRADICTION THAT MATTERS. `requires` and `apart` between the SAME two
 * people cannot both hold: one says A may only work a shift B also works, the
 * other says A may never share a shift with B, and together they say A may
 * never be assigned at all. The migration's comment that the two kinds are not
 * contradictory is about DIFFERENT pairs (A may require B while B stays apart
 * from C) and remains true; this rejects only the same-pair case, in either
 * direction, because `apart` is symmetric.
 *
 * WHAT IS DELIBERATELY NOT REJECTED: a mutual `requires` (A requires B and B
 * requires A). It reads like a deadlock and is not one — the engines encode
 * `requires` as `a <= b`, so the pair of rules means `a == b`: both people on
 * the shift or neither. That is exactly what a symmetric pairing means, and the
 * migration already documents two rows as the way to express it. Rejecting it
 * would forbid the schema's own stated use.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../config/logger';

export type PairingKind = 'apart' | 'requires';

export interface EmployeePairing {
  id: number;
  userId: number;
  userName: string;
  otherUserId: number;
  otherUserName: string;
  kind: PairingKind;
  reason: string | null;
}

export interface CreatePairingInput {
  userId: number;
  otherUserId: number;
  kind: PairingKind;
  reason?: string | null;
}

const SELECT_PAIRING = `
  SELECT p.id, p.user_id, p.other_user_id, p.kind, p.reason,
         CONCAT(u.first_name, ' ', u.last_name)  AS user_name,
         CONCAT(o.first_name, ' ', o.last_name)  AS other_user_name
    FROM employee_pairings p
    JOIN users u ON u.id = p.user_id
    JOIN users o ON o.id = p.other_user_id`;

const mapPairing = (row: RowDataPacket): EmployeePairing => ({
  id: row.id as number,
  userId: row.user_id as number,
  userName: row.user_name as string,
  otherUserId: row.other_user_id as number,
  otherUserName: row.other_user_name as string,
  kind: row.kind as PairingKind,
  reason: (row.reason as string | null) ?? null,
});

export class EmployeePairingService {
  constructor(private pool: Pool) {}

  /**
   * All rules, or those involving one person in EITHER direction.
   *
   * Filtering on `user_id` alone would answer a question nobody asks: a rule
   * saying a trainee may only work with their supervisor is as much the
   * supervisor's rule as the trainee's, and someone reviewing either person's
   * constraints needs to see it.
   */
  async list(userId?: number): Promise<EmployeePairing[]> {
    const where = userId === undefined ? '' : ' WHERE p.user_id = ? OR p.other_user_id = ?';
    const params = userId === undefined ? [] : [userId, userId];
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${SELECT_PAIRING}${where} ORDER BY p.id`,
      params
    );
    return rows.map(mapPairing);
  }

  async getById(id: number): Promise<EmployeePairing> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${SELECT_PAIRING} WHERE p.id = ?`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Pairing rule not found');
    return mapPairing(rows[0]);
  }

  async create(input: CreatePairingInput): Promise<EmployeePairing> {
    const { userId, otherUserId, kind } = input;

    if (userId === otherUserId) {
      throw new ValidationError('A pairing rule must be between two different people');
    }

    await this.assertUsersExist(userId, otherUserId);

    // Every existing rule between these two people, in either direction. One
    // query rather than three because all the checks below read the same set,
    // and because `apart` is symmetric so the reverse row is as relevant as
    // the forward one.
    const [existing] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id, other_user_id, kind FROM employee_pairings
        WHERE (user_id = ? AND other_user_id = ?) OR (user_id = ? AND other_user_id = ?)`,
      [userId, otherUserId, otherUserId, userId]
    );

    for (const row of existing) {
      const sameDirection = row.user_id === userId;
      if (row.kind === kind) {
        // An exact duplicate, or — for `apart`, which means the same thing
        // read either way — the same rule already recorded in reverse.
        if (sameDirection || kind === 'apart') {
          throw new ConflictError('This pairing rule already exists');
        }
      } else {
        throw new ConflictError(
          'These two people already have the opposite pairing rule; ' +
            'requiring and separating the same pair would leave them unschedulable'
        );
      }
    }

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO employee_pairings (user_id, other_user_id, kind, reason)
       VALUES (?, ?, ?, ?)`,
      [userId, otherUserId, kind, input.reason ?? null]
    );
    logger.info(`Pairing rule created: ${userId} ${kind} ${otherUserId}`);
    return this.getById(res.insertId);
  }

  /** Only the reason is mutable; see the schema for why. */
  async updateReason(id: number, reason: string | null): Promise<EmployeePairing> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      'UPDATE employee_pairings SET reason = ? WHERE id = ?',
      [reason, id]
    );
    if (res.affectedRows === 0) throw new NotFoundError('Pairing rule not found');
    return this.getById(id);
  }

  async remove(id: number): Promise<void> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      'DELETE FROM employee_pairings WHERE id = ?',
      [id]
    );
    if (res.affectedRows === 0) throw new NotFoundError('Pairing rule not found');
    logger.info(`Pairing rule deleted: ${id}`);
  }

  /**
   * Both people must exist.
   *
   * The foreign keys would catch this, but as an `ER_NO_REFERENCED_ROW` that
   * reaches the error handler as an unclassified 500. A request naming someone
   * who is not there is the caller's mistake, and should read as one.
   */
  private async assertUsersExist(userId: number, otherUserId: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE id IN (?, ?)',
      [userId, otherUserId]
    );
    if (rows.length < 2) throw new ValidationError('One or both users do not exist');
  }
}
