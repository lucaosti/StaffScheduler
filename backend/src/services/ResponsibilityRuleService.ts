/**
 * Responsibility Rule Service
 *
 * Manages the `responsibility_rules` table — the multidimensional matrix that
 * maps (subject group × permission code) → responsible org unit.
 *
 * A rule answers: "For users matching condition X (e.g. members of
 * department Y), who has responsibility for permission Z?"
 *
 * Subject types:
 *   'org_unit'   — all users whose primary org unit is subject_id
 *   'department' — all users in department subject_id
 *   'role'       — all users holding role subject_id
 *   'all'        — every active user in the system
 *
 * `responsible_org_unit_id` is the org unit that holds authority.
 * `delegated_to_role_id`:  when set, only members of the responsible org
 *   unit who also hold this role may exercise the authority; when null,
 *   all active members of the responsible org unit have authority.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  ResponsibilityRule,
  CreateResponsibilityRuleRequest,
  UpdateResponsibilityRuleRequest,
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';

interface ResolveContext {
  /** Primary org unit of the subject user. */
  orgUnitId?: number | null;
  /** Department id(s) the subject user belongs to. */
  departmentIds?: number[];
  /** Role ids the subject user holds. */
  roleIds?: number[];
  /** Permission code to look up. */
  permissionCode: string;
}

const mapRule = (row: RowDataPacket): ResponsibilityRule => ({
  id: row.id as number,
  subjectType: row.subject_type as ResponsibilityRule['subjectType'],
  subjectId: (row.subject_id as number | null) ?? null,
  permissionCode: row.permission_code as string,
  responsibleOrgUnitId: row.responsible_org_unit_id as number,
  delegatedToRoleId: (row.delegated_to_role_id as number | null) ?? null,
  description: (row.description as string | null) ?? null,
  isActive: Boolean(row.is_active),
  createdBy: (row.created_by as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class ResponsibilityRuleService {
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async list(filters: {
    subjectType?: string;
    permissionCode?: string;
    responsibleOrgUnitId?: number;
    isActive?: boolean;
  } = {}): Promise<ResponsibilityRule[]> {
    const conditions: string[] = [];
    const params: Array<string | number | boolean> = [];

    if (filters.subjectType) {
      conditions.push('subject_type = ?');
      params.push(filters.subjectType);
    }
    if (filters.permissionCode) {
      conditions.push('permission_code = ?');
      params.push(filters.permissionCode);
    }
    if (filters.responsibleOrgUnitId !== undefined) {
      conditions.push('responsible_org_unit_id = ?');
      params.push(filters.responsibleOrgUnitId);
    }
    if (filters.isActive !== undefined) {
      conditions.push('is_active = ?');
      params.push(filters.isActive ? 1 : 0);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM responsibility_rules${where} ORDER BY permission_code ASC, subject_type ASC`,
      params
    );
    return rows.map(mapRule);
  }

  async getById(id: number): Promise<ResponsibilityRule | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM responsibility_rules WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length === 0 ? null : mapRule(rows[0]);
  }

  async create(input: CreateResponsibilityRuleRequest, actorId: number | null): Promise<ResponsibilityRule> {
    if (input.subjectType !== 'all' && (input.subjectId === undefined || input.subjectId === null)) {
      throw new Error('subject_id is required when subject_type is not "all"');
    }
    if (input.subjectType === 'all' && input.subjectId != null) {
      throw new Error('subject_id must be null when subject_type is "all"');
    }

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO responsibility_rules
         (subject_type, subject_id, permission_code, responsible_org_unit_id,
          delegated_to_role_id, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [
        input.subjectType,
        input.subjectId ?? null,
        input.permissionCode,
        input.responsibleOrgUnitId,
        input.delegatedToRoleId ?? null,
        input.description ?? null,
        actorId,
      ]
    );

    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to retrieve created responsibility rule');

    await this.audit.write({
      actorId,
      action: 'responsibility_rule.create',
      entityType: 'responsibility_rule',
      entityId: created.id,
      description: `Rule created: ${created.permissionCode} for ${created.subjectType}`,
      after: created as unknown as Record<string, unknown>,
    });

    logger.info(`Responsibility rule created: id=${created.id} permission=${created.permissionCode}`);
    return created;
  }

  async update(id: number, patch: UpdateResponsibilityRuleRequest, actorId: number | null): Promise<ResponsibilityRule> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Responsibility rule not found');

    const merged = { ...existing, ...patch };

    if (merged.subjectType !== 'all' && merged.subjectId == null) {
      throw new Error('subject_id is required when subject_type is not "all"');
    }
    if (merged.subjectType === 'all' && merged.subjectId != null) {
      throw new Error('subject_id must be null when subject_type is "all"');
    }

    await this.pool.execute(
      `UPDATE responsibility_rules
          SET subject_type = ?, subject_id = ?, permission_code = ?,
              responsible_org_unit_id = ?, delegated_to_role_id = ?,
              description = ?, is_active = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        merged.subjectType,
        merged.subjectId ?? null,
        merged.permissionCode,
        merged.responsibleOrgUnitId,
        merged.delegatedToRoleId ?? null,
        merged.description ?? null,
        merged.isActive ? 1 : 0,
        id,
      ]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated responsibility rule');

    await this.audit.write({
      actorId,
      action: 'responsibility_rule.update',
      entityType: 'responsibility_rule',
      entityId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async delete(id: number, actorId: number | null): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Responsibility rule not found');

    await this.pool.execute('DELETE FROM responsibility_rules WHERE id = ?', [id]);

    await this.audit.write({
      actorId,
      action: 'responsibility_rule.delete',
      entityType: 'responsibility_rule',
      entityId: id,
      description: `Rule deleted: ${existing.permissionCode} for ${existing.subjectType}`,
      before: existing as unknown as Record<string, unknown>,
    });

    logger.info(`Responsibility rule deleted: id=${id}`);
  }

  // --------------------------------------------------------------------------
  // Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolves the user IDs of everyone who holds responsibility for a given
   * permission over a specific subject user. Takes the subject's org unit,
   * department(s) and role(s) and returns all responsible users across all
   * matching rules — de-duplicated.
   *
   * Used by the approval engine to find the approver(s) when a rule uses
   * the `responsibility_rule` scope.
   */
  async resolveResponsibleUsers(ctx: ResolveContext): Promise<number[]> {
    // Build a WHERE clause covering all subject conditions that apply.
    const subjectConditions: string[] = ["rr.subject_type = 'all'"];
    const params: Array<string | number> = [ctx.permissionCode];

    if (ctx.orgUnitId != null) {
      subjectConditions.push("(rr.subject_type = 'org_unit' AND rr.subject_id = ?)");
      params.push(ctx.orgUnitId);
    }
    if (ctx.departmentIds && ctx.departmentIds.length > 0) {
      if (ctx.departmentIds.length > 100) throw new Error('Max 100 department IDs allowed');
      subjectConditions.push(
        `(rr.subject_type = 'department' AND rr.subject_id IN (${ctx.departmentIds.map(() => '?').join(',')}))`
      );
      params.push(...ctx.departmentIds);
    }
    if (ctx.roleIds && ctx.roleIds.length > 0) {
      if (ctx.roleIds.length > 100) throw new Error('Max 100 role IDs allowed');
      subjectConditions.push(
        `(rr.subject_type = 'role' AND rr.subject_id IN (${ctx.roleIds.map(() => '?').join(',')}))`
      );
      params.push(...ctx.roleIds);
    }

    const subjectClause = subjectConditions.join(' OR ');

    // Single query: join rules → responsible org unit members, filter by optional role.
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT uou.user_id
         FROM responsibility_rules rr
         JOIN user_org_units uou ON uou.org_unit_id = rr.responsible_org_unit_id
         JOIN users u ON u.id = uou.user_id AND u.is_active = TRUE
         LEFT JOIN user_roles ur
           ON ur.user_id = uou.user_id
          AND ur.role_id = rr.delegated_to_role_id
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        WHERE rr.is_active = TRUE
          AND rr.permission_code = ?
          AND (${subjectClause})
          AND (rr.delegated_to_role_id IS NULL OR ur.user_id IS NOT NULL)`,
      params
    );

    return rows.map((r: any) => r.user_id as number);
  }
}
