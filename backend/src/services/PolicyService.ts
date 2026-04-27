/**
 * Policy CRUD + scoped lookup.
 *
 * Policies represent imposed rules. Each policy has an owner; exceptions to
 * a policy must be approved by that owner (or via the configured chain in
 * the approval matrix).
 *
 * `policy_value` is JSON so each `policy_key` can encode its parameters
 * (for example `min_rest_hours` -> `{ "hours": 11 }`).
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

type PolicyScope = 'global' | 'org_unit' | 'schedule' | 'shift_template';

export interface Policy {
  id: number;
  scopeType: PolicyScope;
  scopeId: number | null;
  policyKey: string;
  policyValue: unknown;
  description: string | null;
  imposedByUserId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreatePolicyInput {
  scopeType: PolicyScope;
  scopeId?: number | null;
  policyKey: string;
  policyValue: unknown;
  description?: string | null;
  imposedByUserId: number;
}

interface UpdatePolicyInput {
  scopeType?: PolicyScope;
  scopeId?: number | null;
  policyKey?: string;
  policyValue?: unknown;
  description?: string | null;
  isActive?: boolean;
}

const parseValue = (raw: unknown): unknown => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

const mapRow = (row: RowDataPacket): Policy => ({
  id: row.id as number,
  scopeType: row.scope_type as PolicyScope,
  scopeId: (row.scope_id as number | null) ?? null,
  policyKey: row.policy_key as string,
  policyValue: parseValue(row.policy_value),
  description: (row.description as string | null) ?? null,
  imposedByUserId: row.imposed_by_user_id as number,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class PolicyService {
  constructor(private pool: Pool) {}

  async list(activeOnly = false): Promise<Policy[]> {
    const where = activeOnly ? ' WHERE is_active = 1' : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM policies${where} ORDER BY scope_type ASC, policy_key ASC`
    );
    return rows.map(mapRow);
  }

  async getById(id: number): Promise<Policy | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM policies WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /**
   * Returns all active policies that may apply to a given target context.
   * A schedule-scoped policy only matches when scopeId equals the schedule id.
   */
  async listApplicable(ctx: {
    orgUnitId?: number | null;
    scheduleId?: number | null;
    shiftTemplateId?: number | null;
  }): Promise<Policy[]> {
    const all = await this.list(true);
    return all.filter((p) => {
      switch (p.scopeType) {
        case 'global':
          return true;
        case 'org_unit':
          return ctx.orgUnitId !== undefined && ctx.orgUnitId !== null && p.scopeId === ctx.orgUnitId;
        case 'schedule':
          return ctx.scheduleId !== undefined && ctx.scheduleId !== null && p.scopeId === ctx.scheduleId;
        case 'shift_template':
          return (
            ctx.shiftTemplateId !== undefined &&
            ctx.shiftTemplateId !== null &&
            p.scopeId === ctx.shiftTemplateId
          );
      }
    });
  }

  async create(input: CreatePolicyInput): Promise<Policy> {
    if (!input.policyKey?.trim()) throw new Error('policyKey is required');
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO policies
         (scope_type, scope_id, policy_key, policy_value, description, imposed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.scopeType,
        input.scopeId ?? null,
        input.policyKey.trim(),
        JSON.stringify(input.policyValue ?? null),
        input.description ?? null,
        input.imposedByUserId,
      ]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create policy');
    logger.info(`Policy created: id=${created.id} key=${created.policyKey}`);
    return created;
  }

  async update(id: number, patch: UpdatePolicyInput): Promise<Policy> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Policy not found');
    const merged: Policy = {
      ...existing,
      scopeType: patch.scopeType ?? existing.scopeType,
      scopeId: patch.scopeId !== undefined ? patch.scopeId : existing.scopeId,
      policyKey: patch.policyKey ?? existing.policyKey,
      policyValue: patch.policyValue !== undefined ? patch.policyValue : existing.policyValue,
      description: patch.description !== undefined ? patch.description : existing.description,
      isActive: patch.isActive ?? existing.isActive,
    };
    await this.pool.execute(
      `UPDATE policies
          SET scope_type = ?, scope_id = ?, policy_key = ?, policy_value = ?, description = ?, is_active = ?
        WHERE id = ?`,
      [
        merged.scopeType,
        merged.scopeId,
        merged.policyKey,
        JSON.stringify(merged.policyValue ?? null),
        merged.description,
        merged.isActive ? 1 : 0,
        id,
      ]
    );
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh policy');
    return refreshed;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Policy not found');
    await this.pool.execute(`DELETE FROM policies WHERE id = ?`, [id]);
  }
}
