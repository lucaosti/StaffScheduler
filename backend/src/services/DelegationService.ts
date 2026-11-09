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
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { Delegation, CreateDelegationRequest, User } from '../types';
import { scopeFor, UNIT_SCOPED_PERMISSIONS } from './access/AccessPolicy';
import { RbacService } from './RbacService';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { ValidationUtils } from '../utils';

export class DelegationService {
  private audit: AuditLogService;
  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
  }

  /**
   * Creates a new delegation. Throws if any requested permission code is not
   * held by the delegator, if the delegatee is the same user, or if the
   * delegation's org-unit scope is wider than the delegator's own scope for
   * any delegated code.
   *
   * WHY THE SCOPE IS CHECKED HERE AS WELL AS AT RESOLUTION. Resolution caps a
   * delegation at the delegator's current scope (RbacService), so a wider one
   * could never act wider. Refusing it at creation is still right: a
   * delegation stored as "organization-wide" by a manager of one ward reads, in
   * every listing and audit entry, as authority that was never theirs to give
   * (#814). A scope is a subtree, so "inside the delegator's scope" is decided
   * by its root alone.
   */
  async createDelegation(
    delegator: Pick<User, 'id' | 'permissions' | 'allowedOrgUnitIds' | 'delegationScopes'>,
    input: CreateDelegationRequest,
    justification?: string | null
  ): Promise<Delegation> {
    const delegatorId = delegator.id;
    if (input.delegateeId === delegatorId) {
      throw new ConflictError('Cannot delegate to yourself');
    }

    const delegatorPermissions = delegator.permissions ?? [];
    const invalid = input.permissionCodes.filter((c) => !delegatorPermissions.includes(c));
    if (invalid.length > 0) {
      throw new ConflictError(`Delegation escalation: codes not held by delegator: ${invalid.join(', ')}`);
    }

    const requested = input.scopeOrgUnitId ?? null;
    // A unit cannot bound a code whose operations are organization-wide: a
    // `role.manage` delegated "for ward A" still assigns any role to anyone, so
    // the scope on it would be decoration over an organization-wide grant. The
    // codes a unit can bound are derived from the authorization matrix
    // (AccessPolicy.UNIT_SCOPED_PERMISSIONS); the others delegate unscoped or
    // not at all. Rejected: making every org-wide route honour a delegation's
    // scope — those routes have no unit to compare it with.
    if (requested !== null) {
      const unbounded = input.permissionCodes.filter((c) => !UNIT_SCOPED_PERMISSIONS.has(c));
      if (unbounded.length > 0) {
        throw new ConflictError(`Delegation escalation: ${unbounded.join(', ')} act organization-wide and cannot be delegated for one org unit`);
      }
    }
    for (const code of input.permissionCodes) {
      const own = scopeFor(delegator as User, code);
      if (own === null) continue;
      if (requested === null) {
        throw new ConflictError(`Delegation escalation: ${code} is held for part of the organization and cannot be delegated organization-wide`);
      }
      if (!own.includes(requested)) {
        throw new ConflictError(`Delegation escalation: org unit ${requested} is outside the delegator's scope for ${code}`);
      }
    }

    // Only one's own authority passes on. A code held through someone else's
    // delegation would be dropped at resolution anyway (RbacService caps each
    // delegation at the delegator's ROLE codes), so creating it would store a
    // grant that reads as real in every listing and does nothing.
    const ownCodes = new Set(await new RbacService(this.pool).getRolePermissions(delegatorId));
    const borrowed = input.permissionCodes.filter((c) => !ownCodes.has(c));
    if (borrowed.length > 0) {
      throw new ConflictError(`Delegation escalation: ${borrowed.join(', ')} held only through a delegation cannot be delegated again`);
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

    await this.audit.write({
      actorId: delegatorId,
      action: 'delegation.grant',
      entityType: 'delegation',
      entityId: result.insertId,
      description: `Delegation granted to user ${input.delegateeId}: ${input.permissionCodes.join(', ')}`,
      justification: justification ?? null,
      after: {
        delegationId: result.insertId,
        delegateeId: input.delegateeId,
        permissionCodes: input.permissionCodes,
        scopeOrgUnitId: input.scopeOrgUnitId ?? null,
        expiresAt: input.expiresAt,
      },
    });

    const delegation = await this.getDelegationById(result.insertId);
    if (!delegation) throw new Error('Failed to retrieve created delegation');
    return delegation;
  }

  /** Revokes (deactivates) a delegation. Only the delegator may revoke. */
  async revokeDelegation(id: number, requestorId: number, justification?: string | null): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, delegator_id FROM delegations WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Delegation not found');
    const row = rows[0] as any;
    if (row.delegator_id !== requestorId) {
      throw new ForbiddenError('Only the delegator may revoke a delegation');
    }

    await this.pool.execute(
      'UPDATE delegations SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    await this.audit.write({
      actorId: requestorId,
      action: 'delegation.revoke',
      entityType: 'delegation',
      entityId: id,
      description: `Delegation ${id} revoked`,
      justification: justification ?? null,
      before: { delegationId: id },
    });

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
      ValidationUtils.parseStringArray(row.permission_codes).forEach((c) => codes.add(c));
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
      permissionCodes: ValidationUtils.parseStringArray(r.permission_codes),
      scopeOrgUnitId: r.scope_org_unit_id ?? null,
      startsAt: r.starts_at,
      expiresAt: r.expires_at,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

}
