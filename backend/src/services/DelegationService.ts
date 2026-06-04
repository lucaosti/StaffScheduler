/**
 * Delegation Service
 *
 * Manages time-bounded, permission-subset delegations between users. A
 * delegator can grant a delegatee a subset of their own effective permissions
 * for a defined time window. Rules:
 *   - delegated codes must be a subset of the delegator's current permissions
 *   - chained sub-delegation is not allowed (delegatee cannot re-delegate)
 *   - expired or deactivated delegations are ignored at resolution time
 *   - every grant/revoke writes an audit log entry
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Delegation, CreateDelegationRequest } from '../types';
import { logger } from '../config/logger';

export class DelegationService {
  constructor(private pool: Pool) {}

  /**
   * Creates a new delegation. Throws if any requested permission code is not
   * held by the delegator, or if the delegatee is the same user.
   */
  async createDelegation(
    delegatorId: number,
    delegatorPermissions: string[],
    input: CreateDelegationRequest
  ): Promise<Delegation> {
    if (input.delegateeId === delegatorId) {
      throw new Error('Cannot delegate to yourself');
    }

    const invalid = input.permissionCodes.filter((c) => !delegatorPermissions.includes(c));
    if (invalid.length > 0) {
      throw new Error(`Delegation escalation: codes not held by delegator: ${invalid.join(', ')}`);
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO delegations
         (delegator_id, delegatee_id, permission_codes, scope_org_unit_id, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [
        delegatorId,
        input.delegateeId,
        JSON.stringify(input.permissionCodes),
        input.scopeOrgUnitId ?? null,
        input.expiresAt,
      ]
    );

    await this.writeAuditLog(delegatorId, 'delegation.grant', {
      delegationId: result.insertId,
      delegateeId: input.delegateeId,
      permissionCodes: input.permissionCodes,
    });

    const delegation = await this.getDelegationById(result.insertId);
    if (!delegation) throw new Error('Failed to retrieve created delegation');
    return delegation;
  }

  /** Revokes (deactivates) a delegation. Only the delegator may revoke. */
  async revokeDelegation(id: number, requestorId: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, delegator_id FROM delegations WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) throw new Error('Delegation not found');
    const row = rows[0] as any;
    if (row.delegator_id !== requestorId) {
      throw new Error('Only the delegator may revoke a delegation');
    }

    await this.pool.execute(
      'UPDATE delegations SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    await this.writeAuditLog(requestorId, 'delegation.revoke', { delegationId: id });

    logger.info(`Delegation ${id} revoked by user ${requestorId}`);
  }

  /** Lists delegations where the user is either delegator or delegatee. */
  async listForUser(userId: number): Promise<Delegation[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, delegator_id, delegatee_id, permission_codes, scope_org_unit_id,
              starts_at, expires_at, is_active, created_at, updated_at
         FROM delegations
        WHERE (delegator_id = ? OR delegatee_id = ?)
        ORDER BY created_at DESC`,
      [userId, userId]
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  /**
   * Returns permission codes actively delegated TO userId that have not
   * expired. Called by RbacService when building effective permissions.
   */
  async getActiveDelegatedPermissions(userId: number): Promise<string[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT permission_codes
         FROM delegations
        WHERE delegatee_id = ?
          AND is_active = TRUE
          AND starts_at <= NOW()
          AND expires_at > NOW()`,
      [userId]
    );

    const codes = new Set<string>();
    for (const row of rows as any[]) {
      const parsed: string[] = JSON.parse(row.permission_codes as string);
      parsed.forEach((c) => codes.add(c));
    }
    return [...codes];
  }

  async getDelegationById(id: number): Promise<Delegation | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, delegator_id, delegatee_id, permission_codes, scope_org_unit_id,
              starts_at, expires_at, is_active, created_at, updated_at
         FROM delegations WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length ? this.mapRow(rows[0] as any) : null;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private mapRow(r: any): Delegation {
    return {
      id: r.id,
      delegatorId: r.delegator_id,
      delegateeId: r.delegatee_id,
      permissionCodes: JSON.parse(r.permission_codes as string) as string[],
      scopeOrgUnitId: r.scope_org_unit_id ?? null,
      startsAt: r.starts_at,
      expiresAt: r.expires_at,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private async writeAuditLog(
    userId: number,
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      const entityId = (details.delegationId as number | null | undefined) ?? null;
      await this.pool.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description)
         VALUES (?, ?, 'delegation', ?, ?)`,
        [userId, action, entityId, JSON.stringify(details)]
      );
    } catch (err) {
      logger.error('Failed to write delegation audit log:', err);
    }
  }
}
