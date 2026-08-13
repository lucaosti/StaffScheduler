/**
 * Approval Workflow Service
 *
 * CRUD for `approval_workflows`/`approval_steps`: each change type
 * (Loan.Request, TimeOff.Request, etc.) maps to an ordered list of steps
 * that `ApproverResolutionService` and `ApprovalDecisionService` walk at
 * request time. Split out of the former `ApprovalEngineService` — this is
 * the one piece of that class that is pure configuration management, with
 * no resolution or decision logic of its own.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { usingConnection } from '../utils/transaction';
import { ConflictError, NotFoundError } from '../errors';
import { ApprovalWorkflow, ApprovalStep, ApproverScope, CreateApprovalWorkflowRequest } from '../types';

export class ApprovalWorkflowService {
  constructor(private pool: Pool) {}

  async listWorkflows(): Promise<ApprovalWorkflow[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
         w.id, w.change_type, w.require_all, w.description, w.created_at, w.updated_at,
         s.id AS step_id, s.workflow_id AS step_workflow_id, s.step_order,
         s.approver_scope, s.approver_role_id, s.approver_user_id, s.approver_permission_code,
         s.auto_approve_for_owner, s.escalate_after_hours
       FROM approval_workflows w
       LEFT JOIN approval_steps s ON s.workflow_id = w.id
       ORDER BY w.change_type ASC, s.step_order ASC`
    );
    const workflowMap = new Map<number, ApprovalWorkflow>();
    for (const row of rows as any[]) {
      if (!workflowMap.has(row.id)) {
        workflowMap.set(row.id, {
          id: row.id,
          changeType: row.change_type,
          requireAll: Boolean(row.require_all),
          description: row.description ?? null,
          steps: [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
      if (row.step_id !== null) {
        workflowMap.get(row.id)!.steps.push({
          id: row.step_id,
          workflowId: row.step_workflow_id,
          stepOrder: row.step_order,
          approverScope: row.approver_scope as ApproverScope,
          approverRoleId: row.approver_role_id ?? null,
          approverUserId: row.approver_user_id ?? null,
          approverPermissionCode: row.approver_permission_code ?? null,
          autoApproveForOwner: Boolean(row.auto_approve_for_owner),
          escalateAfterHours: row.escalate_after_hours ?? null,
        });
      }
    }
    return Array.from(workflowMap.values());
  }

  async getWorkflowByChangeType(changeType: string): Promise<ApprovalWorkflow | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, change_type, require_all, description, created_at, updated_at
         FROM approval_workflows WHERE change_type = ? LIMIT 1`,
      [changeType]
    );
    if (rows.length === 0) return null;
    return this.hydrateWorkflow(rows[0] as any);
  }

  async getWorkflowById(id: number): Promise<ApprovalWorkflow | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, change_type, require_all, description, created_at, updated_at
         FROM approval_workflows WHERE id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    return this.hydrateWorkflow(rows[0] as any);
  }

  async createWorkflow(input: CreateApprovalWorkflowRequest): Promise<ApprovalWorkflow> {
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        const [res] = await connection.execute<ResultSetHeader>(
          `INSERT INTO approval_workflows (change_type, require_all, description) VALUES (?, ?, ?)`,
          [input.changeType, input.requireAll ?? false, input.description ?? null]
        );
        const workflowId = res.insertId;
        for (const s of input.steps) {
          await connection.execute(
            `INSERT INTO approval_steps
               (workflow_id, step_order, approver_scope, approver_role_id, approver_user_id,
                approver_permission_code, auto_approve_for_owner, escalate_after_hours)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              workflowId,
              s.stepOrder,
              s.approverScope,
              s.approverRoleId ?? null,
              s.approverUserId ?? null,
              s.approverPermissionCode ?? null,
              s.autoApproveForOwner ?? true,
              s.escalateAfterHours ?? null,
            ]
          );
        }
        await connection.commit();
        const workflow = await this.getWorkflowById(workflowId);
        if (!workflow) throw new Error('Failed to retrieve created workflow');
        return workflow;
      } catch (error) {
        await connection.rollback();
        // change_type is unique: a duplicate INSERT surfaces as ER_DUP_ENTRY.
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictError('Workflow for this change type already exists');
        }
        throw error;
      }
    });
  }

  async updateWorkflow(
    id: number,
    patch: { requireAll?: boolean; description?: string; steps?: CreateApprovalWorkflowRequest['steps'] }
  ): Promise<ApprovalWorkflow> {
    return usingConnection(this.pool, async (connection) => {
      try {
        await connection.beginTransaction();
        const updates: string[] = [];
        const vals: any[] = [];
        if (patch.requireAll !== undefined) { updates.push('require_all = ?'); vals.push(patch.requireAll); }
        if (patch.description !== undefined) { updates.push('description = ?'); vals.push(patch.description); }
        if (updates.length > 0) {
          vals.push(id);
          await connection.execute(
            `UPDATE approval_workflows SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            vals
          );
        }
        if (patch.steps !== undefined) {
          await connection.execute('DELETE FROM approval_steps WHERE workflow_id = ?', [id]);
          for (const s of patch.steps) {
            await connection.execute(
              `INSERT INTO approval_steps
                 (workflow_id, step_order, approver_scope, approver_role_id, approver_user_id,
                  approver_permission_code, auto_approve_for_owner, escalate_after_hours)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, s.stepOrder, s.approverScope, s.approverRoleId ?? null, s.approverUserId ?? null,
               s.approverPermissionCode ?? null, s.autoApproveForOwner ?? true, s.escalateAfterHours ?? null]
            );
          }
        }
        await connection.commit();
        const workflow = await this.getWorkflowById(id);
        if (!workflow) throw new NotFoundError('Workflow not found');
        return workflow;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async deleteWorkflow(id: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM approval_workflows WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Workflow not found');
    await this.pool.execute('DELETE FROM approval_workflows WHERE id = ?', [id]);
  }

  private async hydrateWorkflow(w: any): Promise<ApprovalWorkflow> {
    const [stepRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, workflow_id, step_order, approver_scope, approver_role_id,
              approver_user_id, approver_permission_code, auto_approve_for_owner, escalate_after_hours
         FROM approval_steps WHERE workflow_id = ? ORDER BY step_order ASC`,
      [w.id]
    );
    const steps: ApprovalStep[] = (stepRows as any[]).map((s) => ({
      id: s.id,
      workflowId: s.workflow_id,
      stepOrder: s.step_order,
      approverScope: s.approver_scope as ApproverScope,
      approverRoleId: s.approver_role_id ?? null,
      approverUserId: s.approver_user_id ?? null,
      approverPermissionCode: s.approver_permission_code ?? null,
      autoApproveForOwner: Boolean(s.auto_approve_for_owner),
      escalateAfterHours: s.escalate_after_hours ?? null,
    }));
    return {
      id: w.id,
      changeType: w.change_type,
      requireAll: Boolean(w.require_all),
      description: w.description ?? null,
      steps,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    };
  }
}
