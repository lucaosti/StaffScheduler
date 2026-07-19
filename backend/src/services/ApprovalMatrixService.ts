/**
 * Approval matrix resolver.
 *
 * Single source of truth for "who must approve a given change". Other services
 * call `resolve(changeType, context)` to figure out the approver_user_id (if
 * any) and whether the actor is allowed to auto-approve.
 *
 * The matrix itself is configured in the `approval_matrix` table; defaults are
 * seeded by the schema migrations.
 *
 * Approver scopes:
 *   - `policy_owner`        owner of the policy at hand
 *   - `unit_manager`        manager of the involved org_unit
 *   - `unit_manager_chain`  walks up parent units until a manager is found
 *   - `company_role`        any active user holding the configured role id
 *   - `company_user`        the explicit user stored in the matrix row
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

type ApproverScope =
  | 'policy_owner'
  | 'unit_manager'
  | 'unit_manager_chain'
  | 'company_role'
  | 'company_user';

interface ApprovalMatrixRow {
  id: number;
  changeType: string;
  approverScope: ApproverScope;
  approverRoleId: number | null;
  approverUserId: number | null;
  autoApproveForOwner: boolean;
  description: string | null;
}

interface ResolveContext {
  /** Org unit involved (for unit_manager / unit_manager_chain). */
  orgUnitId?: number;
  /** Policy involved (for policy_owner). */
  policyOwnerId?: number;
  /** The user performing the change. */
  actorUserId: number;
}

interface ResolvedApprover {
  /** Resolved approver user id, or null when no approver is required/findable. */
  approverUserId: number | null;
  /** True when the actor is the resolved approver and auto-approve is enabled. */
  autoApprove: boolean;
  /** The matrix row that produced the answer (helpful for audit logs). */
  matrix: ApprovalMatrixRow;
}

const mapRow = (row: RowDataPacket): ApprovalMatrixRow => ({
  id: row.id as number,
  changeType: row.change_type as string,
  approverScope: row.approver_scope as ApproverScope,
  approverRoleId: (row.approver_role_id as number | null) ?? null,
  approverUserId: (row.approver_user_id as number | null) ?? null,
  autoApproveForOwner: Boolean(row.auto_approve_for_owner),
  description: (row.description as string | null) ?? null,
});

export class ApprovalMatrixService {
  constructor(private pool: Pool) {}

  async list(): Promise<ApprovalMatrixRow[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM approval_matrix ORDER BY change_type ASC LIMIT 200`
    );
    return rows.map(mapRow);
  }

  async getByChangeType(changeType: string): Promise<ApprovalMatrixRow | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM approval_matrix WHERE change_type = ? LIMIT 1`,
      [changeType]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /**
   * Updates an existing row identified by change_type. Missing rows raise.
   */
  async update(
    changeType: string,
    patch: Partial<Omit<ApprovalMatrixRow, 'id' | 'changeType'>>
  ): Promise<ApprovalMatrixRow> {
    const existing = await this.getByChangeType(changeType);
    if (!existing) throw new Error(`Approval matrix entry not found: ${changeType}`);
    const merged: ApprovalMatrixRow = { ...existing, ...patch };
    await this.pool.execute(
      `UPDATE approval_matrix
          SET approver_scope = ?,
              approver_role_id = ?,
              approver_user_id = ?,
              auto_approve_for_owner = ?,
              description = ?
        WHERE change_type = ?`,
      [
        merged.approverScope,
        merged.approverRoleId,
        merged.approverUserId,
        merged.autoApproveForOwner ? 1 : 0,
        merged.description,
        changeType,
      ]
    );
    const refreshed = await this.getByChangeType(changeType);
    if (!refreshed) throw new Error('Failed to refresh approval matrix entry');
    return refreshed;
  }

  /**
   * Resolves the approver for a change type given a runtime context.
   * Returns `approverUserId = null` when no approver can be determined; the
   * caller decides whether to fall back to a configured role or to fail loudly.
   */
  async resolve(changeType: string, ctx: ResolveContext): Promise<ResolvedApprover> {
    const matrix = await this.getByChangeType(changeType);
    if (!matrix) {
      throw new Error(`No approval matrix configured for change type '${changeType}'`);
    }

    let approverUserId: number | null = null;

    switch (matrix.approverScope) {
      case 'policy_owner':
        approverUserId = ctx.policyOwnerId ?? null;
        break;
      case 'unit_manager':
        approverUserId = ctx.orgUnitId
          ? await this.findUnitManager(ctx.orgUnitId)
          : null;
        break;
      case 'unit_manager_chain':
        approverUserId = ctx.orgUnitId
          ? await this.findUnitManagerChain(ctx.orgUnitId)
          : null;
        break;
      case 'company_role':
        approverUserId = matrix.approverRoleId
          ? await this.findFirstActiveByRoleId(matrix.approverRoleId)
          : null;
        break;
      case 'company_user':
        approverUserId = matrix.approverUserId;
        break;
    }

    const autoApprove =
      matrix.autoApproveForOwner &&
      approverUserId !== null &&
      approverUserId === ctx.actorUserId;

    return { approverUserId, autoApprove, matrix };
  }

  private async findUnitManager(orgUnitId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT manager_user_id FROM org_units WHERE id = ? LIMIT 1`,
      [orgUnitId]
    );
    return rows.length === 0
      ? null
      : ((rows[0].manager_user_id as number | null) ?? null);
  }

  private async findUnitManagerChain(orgUnitId: number): Promise<number | null> {
    let current: number | null = orgUnitId;
    const visited = new Set<number>();
    while (current !== null && !visited.has(current)) {
      const cur: number = current;
      visited.add(cur);
      const result = await this.pool.execute<RowDataPacket[]>(
        `SELECT manager_user_id, parent_id FROM org_units WHERE id = ? LIMIT 1`,
        [cur]
      );
      const chainRows: RowDataPacket[] = result[0];
      if (chainRows.length === 0) return null;
      const managerId = chainRows[0].manager_user_id as number | null;
      if (managerId !== null && managerId !== undefined) return managerId;
      current = (chainRows[0].parent_id as number | null) ?? null;
    }
    return null;
  }

  private async findFirstActiveByRoleId(roleId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id = ? AND u.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY u.id ASC LIMIT 1`,
      [roleId]
    );
    return rows.length === 0 ? null : (rows[0].id as number);
  }
}
