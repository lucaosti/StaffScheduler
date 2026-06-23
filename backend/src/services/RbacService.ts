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
import {
  Permission,
  Role,
  UserRoleAssignment,
  CreateRoleRequest,
  UpdateRoleRequest,
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';

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
    const [roleRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [userId]
    );
    const fromRoles = roleRows.map((r: any) => r.code as string);

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
        const delegatedCodes: string[] = JSON.parse(row.permission_codes as string);
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
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM roles WHERE name = ? LIMIT 1',
        [input.name]
      );
      if (existing.length > 0) throw new Error('Role name already exists');

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
    } finally {
      connection.release();
    }
  }

  async updateRole(id: number, input: UpdateRoleRequest): Promise<Role> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const updates: string[] = [];
      const values: any[] = [];
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
      if (!role) throw new Error('Role not found');
      return role;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteRole(id: number): Promise<void> {
    const role = await this.getRoleById(id);
    if (!role) throw new Error('Role not found');
    if (role.isSystem) throw new Error('System roles cannot be deleted');
    await this.pool.execute('DELETE FROM roles WHERE id = ?', [id]);
    logger.info(`Role deleted: ${id}`);
  }

  // --------------------------------------------------------------------------
  // User-role grants
  // --------------------------------------------------------------------------

  /** Replaces the user's unscoped role grants with the provided role ids. */
  async setUserRoles(userId: number, roleIds: number[]): Promise<void> {
    const connection = await this.pool.getConnection();
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
    } finally {
      connection.release();
    }
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
  async computeAllowedOrgUnitIds(roles: UserRoleAssignment[]): Promise<number[] | null> {
    const scopedRoots = roles
      .map((r) => r.scopeOrgUnitId)
      .filter((id): id is number => id !== null && id !== undefined);

    if (scopedRoots.length === 0) return null;

    const subtrees = await Promise.all(scopedRoots.map((id) => this.getDescendantOrgUnitIds(id)));
    return [...new Set(subtrees.flat())];
  }

  /**
   * Returns the per-permission org-unit restrictions that apply to this user
   * through their active, scoped delegations. Entries are merged by permission
   * code so callers receive one entry per code with the union of allowed org
   * units across all matching delegations.
   *
   * Returns an empty array when the user has no scoped delegations.
   */
  async getEffectiveDelegationScopes(
    userId: number
  ): Promise<Array<{ permissionCode: string; allowedOrgUnitIds: number[] }>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT d.permission_codes, d.scope_org_unit_id
         FROM delegations d
        WHERE d.delegatee_id = ? AND d.is_active = TRUE
          AND d.starts_at <= NOW() AND d.expires_at > NOW()
          AND d.scope_org_unit_id IS NOT NULL`,
      [userId]
    );
    if ((rows as any[]).length === 0) return [];

    // Build { permissionCode → Set<orgUnitId> } by expanding each delegation's
    // scope_org_unit_id to include all descendants.
    const merged = new Map<string, Set<number>>();
    for (const row of rows as any[]) {
      const codes: string[] = JSON.parse(row.permission_codes as string);
      const scopeId: number = row.scope_org_unit_id as number;
      const allowed = await this.getDescendantOrgUnitIds(scopeId);
      for (const code of codes) {
        if (!merged.has(code)) merged.set(code, new Set());
        for (const id of allowed) merged.get(code)!.add(id);
      }
    }

    return Array.from(merged.entries()).map(([permissionCode, ids]) => ({
      permissionCode,
      allowedOrgUnitIds: Array.from(ids),
    }));
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
