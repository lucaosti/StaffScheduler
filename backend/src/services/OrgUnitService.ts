/**
 * Organizational unit hierarchy + membership.
 *
 * The org tree (`org_units`) is the backbone for policy scoping and
 * approvals. A user can belong to multiple units via `user_org_units` but
 * exactly one membership is `is_primary = TRUE` (enforced here).
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

interface OrgUnit {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  managerUserId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
}

interface UserOrgUnit {
  id: number;
  userId: number;
  orgUnitId: number;
  isPrimary: boolean;
  assignedAt: string;
}

interface CreateOrgUnitInput {
  name: string;
  description?: string;
  parentId?: number | null;
  managerUserId?: number | null;
}

interface UpdateOrgUnitInput {
  name?: string;
  description?: string | null;
  parentId?: number | null;
  managerUserId?: number | null;
  isActive?: boolean;
}

const mapUnit = (row: RowDataPacket): OrgUnit => ({
  id: row.id as number,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  parentId: (row.parent_id as number | null) ?? null,
  managerUserId: (row.manager_user_id as number | null) ?? null,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapMembership = (row: RowDataPacket): UserOrgUnit => ({
  id: row.id as number,
  userId: row.user_id as number,
  orgUnitId: row.org_unit_id as number,
  isPrimary: Boolean(row.is_primary),
  assignedAt: row.assigned_at as string,
});

export class OrgUnitService {
  constructor(private pool: Pool) {}

  async list(): Promise<OrgUnit[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM org_units ORDER BY parent_id IS NULL DESC, name ASC`
    );
    return rows.map(mapUnit);
  }

  async getById(id: number): Promise<OrgUnit | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM org_units WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapUnit(rows[0]);
  }

  /** Returns the org tree as a forest of nodes (multiple roots are allowed). */
  async tree(): Promise<OrgUnitNode[]> {
    const all = await this.list();
    const byId = new Map<number, OrgUnitNode>();
    all.forEach((u) => byId.set(u.id, { ...u, children: [] }));
    const roots: OrgUnitNode[] = [];
    byId.forEach((node) => {
      if (node.parentId !== null && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  async create(input: CreateOrgUnitInput): Promise<OrgUnit> {
    if (!input.name?.trim()) throw new Error('name is required');
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = await this.getById(input.parentId);
      if (!parent) throw new Error('parent org unit not found');
    }
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO org_units (name, description, parent_id, manager_user_id)
       VALUES (?, ?, ?, ?)`,
      [
        input.name.trim(),
        input.description ?? null,
        input.parentId ?? null,
        input.managerUserId ?? null,
      ]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create org unit');
    logger.info(`Org unit created: id=${created.id} name="${created.name}"`);
    return created;
  }

  async update(id: number, patch: UpdateOrgUnitInput): Promise<OrgUnit> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Org unit not found');
    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === id) throw new Error('parent_id cannot equal id');
      // Prevent simple cycles by walking up the proposed parent.
      let cur: number | null = patch.parentId;
      const seen = new Set<number>([id]);
      while (cur !== null) {
        const curId: number = cur;
        if (seen.has(curId)) throw new Error('cycle detected in parent chain');
        seen.add(curId);
        const result = await this.pool.execute<RowDataPacket[]>(
          `SELECT parent_id FROM org_units WHERE id = ? LIMIT 1`,
          [curId]
        );
        const parentRows: RowDataPacket[] = result[0];
        if (parentRows.length === 0) throw new Error('parent org unit not found');
        cur = (parentRows[0].parent_id as number | null) ?? null;
      }
    }
    const merged: OrgUnit = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description !== undefined ? patch.description : existing.description,
      parentId: patch.parentId !== undefined ? patch.parentId : existing.parentId,
      managerUserId:
        patch.managerUserId !== undefined ? patch.managerUserId : existing.managerUserId,
      isActive: patch.isActive ?? existing.isActive,
    };
    await this.pool.execute(
      `UPDATE org_units
          SET name = ?, description = ?, parent_id = ?, manager_user_id = ?, is_active = ?
        WHERE id = ?`,
      [
        merged.name,
        merged.description,
        merged.parentId,
        merged.managerUserId,
        merged.isActive ? 1 : 0,
        id,
      ]
    );
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh org unit');
    return refreshed;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Org unit not found');
    await this.pool.execute(`DELETE FROM org_units WHERE id = ?`, [id]);
  }

  // -------- Memberships --------

  async listMembers(orgUnitId: number): Promise<UserOrgUnit[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_org_units WHERE org_unit_id = ? ORDER BY is_primary DESC, user_id ASC`,
      [orgUnitId]
    );
    return rows.map(mapMembership);
  }

  async listForUser(userId: number): Promise<UserOrgUnit[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_org_units WHERE user_id = ? ORDER BY is_primary DESC`,
      [userId]
    );
    return rows.map(mapMembership);
  }

  async getPrimaryUnitForUser(userId: number): Promise<OrgUnit | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ou.*
         FROM org_units ou
         JOIN user_org_units uou ON uou.org_unit_id = ou.id
        WHERE uou.user_id = ? AND uou.is_primary = 1
        LIMIT 1`,
      [userId]
    );
    return rows.length === 0 ? null : mapUnit(rows[0]);
  }

  /** Adds a membership (idempotent on the unique key). */
  async addMember(
    userId: number,
    orgUnitId: number,
    isPrimary = false
  ): Promise<UserOrgUnit> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      if (isPrimary) {
        await conn.execute(
          `UPDATE user_org_units SET is_primary = 0 WHERE user_id = ?`,
          [userId]
        );
      }
      await conn.execute(
        `INSERT INTO user_org_units (user_id, org_unit_id, is_primary)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary)`,
        [userId, orgUnitId, isPrimary ? 1 : 0]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_org_units WHERE user_id = ? AND org_unit_id = ? LIMIT 1`,
      [userId, orgUnitId]
    );
    if (rows.length === 0) throw new Error('Membership not found after insert');
    return mapMembership(rows[0]);
  }

  async setPrimary(userId: number, orgUnitId: number): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE user_org_units SET is_primary = 0 WHERE user_id = ?`,
        [userId]
      );
      const [res] = await conn.execute<ResultSetHeader>(
        `UPDATE user_org_units SET is_primary = 1
          WHERE user_id = ? AND org_unit_id = ?`,
        [userId, orgUnitId]
      );
      if (res.affectedRows === 0) throw new Error('Membership not found');
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async removeMember(userId: number, orgUnitId: number): Promise<void> {
    await this.pool.execute(
      `DELETE FROM user_org_units WHERE user_id = ? AND org_unit_id = ?`,
      [userId, orgUnitId]
    );
  }
}
