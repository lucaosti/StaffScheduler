/**
 * RBAC Service
 *
 * Owns the configurable role/permission model that replaced the former
 * hardcoded `role` ENUM. Authorization is permission-based: application code
 * checks permission CODES (e.g. `schedule.manage`), while roles are editable
 * data that bundle permissions and are granted to users — optionally scoped to
 * an org unit and optionally time-bound.
 *
 * Responsibilities:
 *   - resolve a user's effective permissions and role assignments
 *   - CRUD for roles, role-permission membership and user-role grants
 *   - list the permission catalog
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { usingConnection } from '../utils/transaction';
import { ConflictError, NotFoundError } from '../errors';
import {
  Permission,
  Role,
  UserRoleAssignment,
  CreateRoleRequest,
  UpdateRoleRequest,
  SqlParam,
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { ValidationUtils } from '../utils';

export class RbacService {
  private audit: AuditLogService;
  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
  }

  /**
   * Returns the de-duplicated set of permission codes a user effectively holds,
   * merging both role-based permissions and any active delegations received.
   *
   * Delegated permissions are capped to what the delegator currently holds at
   * resolution time. If a delegator has had a permission revoked after the
   * delegation was created, the delegatee no longer benefits from that code.
   */
  async getEffectivePermissions(userId: number): Promise<string[]> {
    const fromRoles = await this.getRolePermissions(userId);

    // Merge active delegations received by this user, capped to what the
    // delegator currently holds to prevent privilege retention after revocation.
    const [delegRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT d.delegator_id, d.permission_codes
         FROM delegations d
        WHERE d.delegatee_id = ?
          AND d.is_active = TRUE
          AND d.starts_at <= NOW()
          AND d.expires_at > NOW()`,
      [userId]
    );

    const fromDelegations: string[] = [];
    const delegatorIds = (delegRows as any[]).map((r) => r.delegator_id as number);

    if (delegatorIds.length > 0) {
      // Batch-fetch all delegators' current permissions, chunked to avoid
      // unbounded IN(...) placeholders on large delegation sets.
      const CHUNK_SIZE = 500;
      const allBatchRows: RowDataPacket[] = [];
      for (let i = 0; i < delegatorIds.length; i += CHUNK_SIZE) {
        const chunk = delegatorIds.slice(i, i + CHUNK_SIZE);
        const [chunkRows] = await this.pool.execute<RowDataPacket[]>(
          `SELECT DISTINCT ur.user_id, p.code
             FROM user_roles ur
             JOIN role_permissions rp ON rp.role_id = ur.role_id
             JOIN permissions p       ON p.id = rp.permission_id
            WHERE ur.user_id IN (${chunk.map(() => '?').join(',')})
              AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
          chunk
        );
        allBatchRows.push(...(chunkRows as RowDataPacket[]));
      }
      const batchRows = allBatchRows;

      // Build a per-delegator permission set from the batch result.
      const delegatorPerms = new Map<number, Set<string>>();
      for (const br of batchRows as any[]) {
        const uid = br.user_id as number;
        if (!delegatorPerms.has(uid)) delegatorPerms.set(uid, new Set());
        delegatorPerms.get(uid)!.add(br.code as string);
      }

      // For each active delegation, cap the granted codes to what the delegator still holds.
      for (const row of delegRows as any[]) {
        const delegatedCodes = ValidationUtils.parseStringArray(row.permission_codes);
        const allowedCodes = delegatedCodes.filter(
          (c) => (delegatorPerms.get(row.delegator_id) ?? new Set()).has(c)
        );
        allowedCodes.forEach((c) => fromDelegations.push(c));
      }
    }

    return [...new Set([...fromRoles, ...fromDelegations])];
  }

  /**
   * Returns the user's role assignments (with scope), excluding expired grants.
   */
  async getUserRoles(userId: number): Promise<UserRoleAssignment[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ur.role_id, r.name AS role_name, ur.scope_org_unit_id, ur.expires_at
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY r.name ASC`,
      [userId]
    );
    return rows.map((r: any) => ({
      roleId: r.role_id,
      roleName: r.role_name,
      scopeOrgUnitId: r.scope_org_unit_id ?? null,
      expiresAt: r.expires_at ?? null,
    }));
  }

  /** Convenience: does the user hold the given permission code? */
  async userHasPermission(userId: number, code: string): Promise<boolean> {
    const perms = await this.getEffectivePermissions(userId);
    return perms.includes(code);
  }

  // --------------------------------------------------------------------------
  // Permission catalog
  // --------------------------------------------------------------------------

  async listPermissions(): Promise<Permission[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, code, resource, action, description FROM permissions ORDER BY resource, action`
    );
    return rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      resource: r.resource,
      action: r.action,
      description: r.description ?? undefined,
    }));
  }

  // --------------------------------------------------------------------------
  // Roles
  // --------------------------------------------------------------------------

  async listRoles(): Promise<Role[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at,
              GROUP_CONCAT(p.code) AS perm_codes
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.id
        ORDER BY r.name ASC`
    );
    return rows.map((r: any) => this.mapRole(r));
  }

  async getRoleById(id: number): Promise<Role | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at,
              GROUP_CONCAT(p.code) AS perm_codes
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.id = ?
        GROUP BY r.id`,
      [id]
    );
    return rows.length ? this.mapRole(rows[0]) : null;
  }

  async createRole(input: CreateRoleRequest): Promise<Role> {
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        const [existing] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM roles WHERE name = ? LIMIT 1',
          [input.name]
        );
        if (existing.length > 0) throw new ConflictError('Role name already exists');

        const [res] = await connection.execute<ResultSetHeader>(
          'INSERT INTO roles (name, description, is_system) VALUES (?, ?, FALSE)',
          [input.name, input.description || null]
        );
        const roleId = res.insertId;
        await this.replacePermissionsTx(connection, roleId, input.permissionCodes || []);
        await connection.commit();
        logger.info(`Role created: ${roleId} (${input.name})`);
        const role = await this.getRoleById(roleId);
        if (!role) throw new Error('Failed to retrieve created role');
        return role;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async updateRole(id: number, input: UpdateRoleRequest): Promise<Role> {
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        const updates: string[] = [];
        const values: SqlParam[] = [];
        if (input.name !== undefined) {
          updates.push('name = ?');
          values.push(input.name);
        }
        if (input.description !== undefined) {
          updates.push('description = ?');
          values.push(input.description);
        }
        if (updates.length > 0) {
          values.push(id);
          await connection.execute(
            `UPDATE roles SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            values
          );
        }
        if (input.permissionCodes !== undefined) {
          await this.replacePermissionsTx(connection, id, input.permissionCodes);
        }
        await connection.commit();
        logger.info(`Role updated: ${id}`);
        const role = await this.getRoleById(id);
        if (!role) throw new NotFoundError('Role not found');
        return role;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async deleteRole(id: number): Promise<void> {
    const role = await this.getRoleById(id);
    if (!role) throw new NotFoundError('Role not found');
    if (role.isSystem) throw new ConflictError('System roles cannot be deleted');
    await this.pool.execute('DELETE FROM roles WHERE id = ?', [id]);
    logger.info(`Role deleted: ${id}`);
  }

  // --------------------------------------------------------------------------
  // User-role grants
  // --------------------------------------------------------------------------

  /** Replaces the user's unscoped role grants with the provided role ids. */
  async setUserRoles(userId: number, roleIds: number[]): Promise<void> {
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        await connection.execute(
          'DELETE FROM user_roles WHERE user_id = ? AND scope_org_unit_id IS NULL',
          [userId]
        );
        if (roleIds.length > 0) {
          const placeholders = roleIds.map(() => '(?, ?, NULL)').join(', ');
          await connection.execute(
            `INSERT IGNORE INTO user_roles (user_id, role_id, scope_org_unit_id) VALUES ${placeholders}`,
            roleIds.flatMap(roleId => [userId, roleId])
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async assignRole(
    userId: number,
    roleId: number,
    scopeOrgUnitId: number | null = null,
    expiresAt: string | null = null,
    actorId?: number | null,
    justification?: string | null
  ): Promise<void> {
    await this.pool.execute(
      `INSERT INTO user_roles (user_id, role_id, scope_org_unit_id, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
      [userId, roleId, scopeOrgUnitId, expiresAt]
    );
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'role.grant',
      entityType: 'user',
      entityId: userId,
      description: `Role ${roleId} granted to user ${userId}`,
      justification: justification ?? null,
      after: { userId, roleId, scopeOrgUnitId, expiresAt },
    });
  }

  async bulkAssignRole(
    userIds: number[],
    roleId: number,
    scopeOrgUnitId: number | null = null,
    expiresAt: string | null = null,
    actorId?: number | null,
    justification?: string | null
  ): Promise<{ assigned: number }> {
    if (userIds.length === 0) return { assigned: 0 };

    await usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        for (const userId of userIds) {
          await connection.execute(
            `INSERT INTO user_roles (user_id, role_id, scope_org_unit_id, expires_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
            [userId, roleId, scopeOrgUnitId, expiresAt]
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    // Audit writes are append-only; run after commit so a write failure
    // does not roll back the role grants.
    for (const userId of userIds) {
      await this.audit.write({
        actorId: actorId ?? null,
        action: 'role.grant',
        entityType: 'user',
        entityId: userId,
        description: `Role ${roleId} granted to user ${userId} (bulk)`,
        justification: justification ?? null,
        after: { userId, roleId, scopeOrgUnitId, expiresAt },
      });
    }

    return { assigned: userIds.length };
  }

  async removeRole(
    userId: number,
    roleId: number,
    scopeOrgUnitId: number | null = null,
    actorId?: number | null,
    justification?: string | null
  ): Promise<void> {
    if (scopeOrgUnitId === null) {
      await this.pool.execute(
        'DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND scope_org_unit_id IS NULL',
        [userId, roleId]
      );
    } else {
      await this.pool.execute(
        'DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND scope_org_unit_id = ?',
        [userId, roleId, scopeOrgUnitId]
      );
    }
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'role.revoke',
      entityType: 'user',
      entityId: userId,
      description: `Role ${roleId} revoked from user ${userId}`,
      justification: justification ?? null,
      before: { userId, roleId, scopeOrgUnitId },
    });
  }

  // --------------------------------------------------------------------------
  // Org-unit scoping
  // --------------------------------------------------------------------------

  /**
   * Returns the given org-unit ID plus all descendant org-unit IDs using a
   * single recursive CTE. O(tree depth) in DB round-trips (one query total).
   */
  async getDescendantOrgUnitIds(rootId: number): Promise<number[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `WITH RECURSIVE subtree (id) AS (
         SELECT id FROM org_units WHERE id = ?
         UNION ALL
         SELECT ou.id FROM org_units ou
         JOIN subtree s ON ou.parent_id = s.id
       )
       SELECT id FROM subtree`,
      [rootId]
    );
    return rows.map((r: any) => r.id as number);
  }

  /**
   * Computes the set of allowed org-unit IDs for a user based on their role
   * assignments. Returns `null` when the user has no scoped roles (full
   * access). Returns a de-duplicated array when at least one scoped role
   * exists (access restricted to those org-unit subtrees).
   */
  /**
   * The org units a person BELONGS to, with everything beneath them.
   *
   * Distinct from `computeAllowedOrgUnitIds`, which answers "what may this
   * person's roles reach" and is NULL — unrestricted — for anyone whose roles
   * carry no scope. That is the right answer for authority and the wrong one
   * for visibility: it would show the whole organization's movements to every
   * employee. This answers "where is this person", which is what a view of
   * one's own colleagues should be bounded by, and returns an empty list when
   * they belong nowhere rather than falling back to everything.
   */
  async getUserOrgUnitSubtreeIds(userId: number): Promise<number[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT org_unit_id FROM user_org_units WHERE user_id = ?',
      [userId]
    );
    const roots = rows.map((r) => r.org_unit_id as number);
    if (roots.length === 0) return [];
    const subtrees = await Promise.all(roots.map((id) => this.getDescendantOrgUnitIds(id)));
    return [...new Set(subtrees.flat())];
  }

  async computeAllowedOrgUnitIds(roles: UserRoleAssignment[]): Promise<number[] | null> {
    const scopedRoots = roles
      .map((r) => r.scopeOrgUnitId)
      .filter((id): id is number => id !== null && id !== undefined);

    if (scopedRoots.length === 0) return null;

    const subtrees = await Promise.all(scopedRoots.map((id) => this.getDescendantOrgUnitIds(id)));
    return [...new Set(subtrees.flat())];
  }

  /**
   * The org-unit scope of every code this user holds through an active
   * delegation — the per-permission override of `allowedOrgUnitIds` that
   * `AccessPolicy.scopeFor` reads (#814).
   *
   * WHY PER CODE, AND WHY MERGED WITH THE ROLE SCOPE. A delegation of
   * `schedule.manage` for ward A gives that code in ward A, not everywhere: the
   * old resolution merged delegated codes into the permission list and never
   * consulted the scope again, so it gave the code organization-wide. A code
   * the user ALSO holds through their roles reaches the union of both, which is
   * what "cover a colleague's ward while they are away" needs from a manager
   * who already runs another one.
   *
   * WHY CAPPED BY THE DELEGATOR'S CURRENT SCOPE. Like the codes themselves
   * (`getEffectivePermissions`), the reach is capped at resolution time: a
   * delegator whose own scope narrowed after delegating cannot keep handing out
   * the wider one, and a delegation that no longer intersects it reaches
   * nothing (an empty list, which matches no row).
   *
   * Returns an empty array — no overrides, no extra queries — when the user has
   * no active delegations, which is the common case.
   */
  async getEffectiveDelegationScopes(
    userId: number,
    roleScope: number[] | null
  ): Promise<Array<{ permissionCode: string; allowedOrgUnitIds: number[] | null }>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT d.delegator_id, d.permission_codes, d.scope_org_unit_id
         FROM delegations d
        WHERE d.delegatee_id = ? AND d.is_active = TRUE
          AND d.starts_at <= NOW() AND d.expires_at > NOW()`,
      [userId]
    );
    if (rows.length === 0) return [];

    // code → reach through delegations; null means unrestricted.
    const delegated = new Map<string, Set<number> | null>();
    for (const row of rows) {
      const delegatorId = row.delegator_id as number;
      const [delegatorCodes, delegatorScope] = await Promise.all([
        this.getRolePermissions(delegatorId),
        this.getUserRoles(delegatorId).then((roles) => this.computeAllowedOrgUnitIds(roles)),
      ]);
      const own = row.scope_org_unit_id == null ? null : await this.getDescendantOrgUnitIds(row.scope_org_unit_id as number);
      const reach = intersectScopes(own, delegatorScope);
      for (const code of ValidationUtils.parseStringArray(row.permission_codes)) {
        if (!delegatorCodes.includes(code)) continue;
        const current = delegated.get(code);
        if (current === null) continue;
        if (reach === null) delegated.set(code, null);
        else delegated.set(code, new Set([...(current ?? []), ...reach]));
      }
    }

    const roleCodes = new Set(await this.getRolePermissions(userId));
    return Array.from(delegated.entries()).map(([permissionCode, reach]) => {
      const viaRole = roleCodes.has(permissionCode);
      let allowed: number[] | null;
      if (reach === null || (viaRole && roleScope === null)) allowed = null;
      else allowed = [...new Set([...(viaRole ? roleScope ?? [] : []), ...reach])];
      return { permissionCode, allowedOrgUnitIds: allowed };
    });
  }

  /** Permission codes granted by the user's own (unexpired) roles — delegations excluded. */
  async getRolePermissions(userId: number): Promise<string[]> {
    const [roleRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [userId]
    );
    return roleRows.map((r) => r.code as string);
  }

  /** Resolves a role id from its (unique) name. Useful for seeding/import. */
  async getRoleIdByName(name: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM roles WHERE name = ? LIMIT 1',
      [name]
    );
    return rows.length ? (rows[0] as any).id : null;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async replacePermissionsTx(
    connection: any,
    roleId: number,
    permissionCodes: string[]
  ): Promise<void> {
    await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    if (permissionCodes.length === 0) return;
    const placeholders = permissionCodes.map(() => '?').join(', ');
    await connection.execute(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions WHERE code IN (${placeholders})`,
      [roleId, ...permissionCodes]
    );
  }

  private mapRole(r: any): Role {
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      isSystem: Boolean(r.is_system),
      permissions: r.perm_codes ? String(r.perm_codes).split(',') : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

/** Intersection of two scopes where `null` is unrestricted. */
const intersectScopes = (a: number[] | null, b: number[] | null): number[] | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a.filter((id) => b.includes(id));
};
