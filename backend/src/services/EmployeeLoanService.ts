/**
 * Employee loans (cross-unit temporary assignments).
 *
 * A target unit manager can borrow an employee from another unit for a
 * date range. The legacy `approval_matrix` (`ApprovalMatrixService`) is
 * still consulted at *creation* time only, to decide whether the request
 * auto-approves immediately (actor is already the resolved approver).
 * Otherwise the request is routed through the modern `approval_workflows`/
 * `pending_approvals` engine (see ApprovalEngineService) exactly like
 * time-off and shift-swap decisions — supporting structure-level assignment
 * and delegation, not just a single hardcoded approver.
 *
 * Querying for "is user X eligible in unit Y on date D" is done via
 * `isOnLoan()`, used by schedule validation.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { ApprovalMatrixService } from './ApprovalMatrixService';
import { ApprovalEngineService } from './ApprovalEngineService';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';

type LoanStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'ended';

interface EmployeeLoan {
  id: number;
  userId: number;
  fromOrgUnitId: number;
  toOrgUnitId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LoanStatus;
  requestedBy: number;
  approverUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateLoanInput {
  userId: number;
  fromOrgUnitId: number;
  toOrgUnitId: number;
  startDate: string;
  endDate: string;
  reason?: string;
  requestedBy: number;
}

interface ListLoanFilters {
  userId?: number;
  toOrgUnitId?: number;
  fromOrgUnitId?: number;
  status?: LoanStatus;
}

const mapRow = (row: RowDataPacket): EmployeeLoan => ({
  id: row.id as number,
  userId: row.user_id as number,
  fromOrgUnitId: row.from_org_unit_id as number,
  toOrgUnitId: row.to_org_unit_id as number,
  startDate:
    typeof row.start_date === 'string' ? row.start_date : DateUtils.fromMySQLDate(row.start_date),
  endDate:
    typeof row.end_date === 'string' ? row.end_date : DateUtils.fromMySQLDate(row.end_date),
  reason: (row.reason as string | null) ?? null,
  status: row.status as LoanStatus,
  requestedBy: row.requested_by as number,
  approverUserId: (row.approver_user_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class EmployeeLoanService {
  private approvals: ApprovalMatrixService;
  private engine: ApprovalEngineService;
  private notifications: NotificationService;
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.approvals = new ApprovalMatrixService(pool);
    this.engine = new ApprovalEngineService(pool);
    this.notifications = new NotificationService(pool);
    this.audit = new AuditLogService(pool);
  }

  /**
   * Creates a loan request. If the actor is the resolved approver and the
   * matrix allows auto-approval, the loan is created already approved.
   */
  async create(input: CreateLoanInput): Promise<EmployeeLoan> {
    if (!input.startDate || !input.endDate) throw new ConflictError('startDate/endDate required');
    if (input.endDate < input.startDate) throw new ConflictError('endDate must be on or after startDate');
    if (input.fromOrgUnitId === input.toOrgUnitId) {
      throw new ConflictError('source and target unit must differ');
    }

    const resolved = await this.approvals.resolve('Loan.Request', {
      orgUnitId: input.toOrgUnitId,
      actorUserId: input.requestedBy,
    });

    const status: LoanStatus = resolved.autoApprove ? 'approved' : 'pending';
    const approverId = resolved.approverUserId;
    const reviewedAt = resolved.autoApprove ? new Date() : null;

    // Resolve the approval gate BEFORE inserting the loan: a pending loan
    // whose configured workflow cannot attach an approver (e.g. the target
    // unit has no manager for a unit-scoped step) would otherwise be
    // inserted with no pending_approvals row — permanently undecidable by
    // anyone. Fail loudly instead.
    const workflow = resolved.autoApprove ? null : await this.engine.getWorkflowByChangeType('Loan.Request');
    const workflowCtx = { actorUserId: input.requestedBy, orgUnitId: input.toOrgUnitId };
    if (workflow && workflow.steps.length > 0) {
      if (!(await this.engine.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
        throw new ConflictError(
          'No approver could be resolved for this loan request — the target organizational unit has no manager who can decide it. Ask an administrator to fix the assignment.'
        );
      }
    }

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO employee_loans
         (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date, reason,
          status, requested_by, approver_user_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.fromOrgUnitId,
        input.toOrgUnitId,
        input.startDate,
        input.endDate,
        input.reason ?? null,
        status,
        input.requestedBy,
        approverId,
        reviewedAt,
        resolved.autoApprove ? 'auto-approved (actor is configured approver)' : null,
      ]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create loan');
    logger.info(
      `Loan created: id=${created.id} user=${input.userId} from=${input.fromOrgUnitId} to=${input.toOrgUnitId} status=${status}`
    );
    await this.audit.write({
      actorId: input.requestedBy,
      action: 'loan.create',
      entityType: 'employee_loan',
      entityId: created.id,
      description: `Employee loan requested: user ${input.userId} from unit ${input.fromOrgUnitId} to ${input.toOrgUnitId}`,
      justification: input.reason ?? null,
      after: { id: created.id, status, fromOrgUnitId: input.fromOrgUnitId, toOrgUnitId: input.toOrgUnitId },
    });

    await this.fanOutNotifications(created);

    if (workflow && workflow.steps.length > 0) {
      const pa = await this.engine.createPendingApprovalForStep(
        workflow.id,
        workflow.steps[0],
        { employeeLoanId: created.id },
        workflowCtx
      );
      if (!pa) {
        // The pre-insert check passed but resolution changed underneath us
        // (e.g. the target unit's manager was concurrently removed). Never
        // leave a stranded, undecidable request behind.
        await this.pool.execute(`DELETE FROM employee_loans WHERE id = ?`, [created.id]);
        throw new ConflictError('No approver could be resolved for this loan request — approver resolution changed during creation. Please retry.');
      }
    }

    return created;
  }

  async getById(id: number): Promise<EmployeeLoan | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM employee_loans WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(filters: ListLoanFilters = {}): Promise<EmployeeLoan[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.toOrgUnitId !== undefined) {
      conditions.push('to_org_unit_id = ?');
      params.push(filters.toOrgUnitId);
    }
    if (filters.fromOrgUnitId !== undefined) {
      conditions.push('from_org_unit_id = ?');
      params.push(filters.fromOrgUnitId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM employee_loans${where} ORDER BY start_date DESC LIMIT 500`,
      params
    );
    return rows.map(mapRow);
  }

  /** True when an active approved loan covers the given (user, unit, date). */
  async isOnLoan(userId: number, orgUnitId: number, date: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
         FROM employee_loans
        WHERE user_id = ?
          AND to_org_unit_id = ?
          AND status = 'approved'
          AND start_date <= ?
          AND end_date >= ?`,
      [userId, orgUnitId, date, date]
    );
    return ((rows[0] as { c: number }).c) > 0;
  }

  private async findPendingApprovalId(employeeLoanId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM pending_approvals WHERE employee_loan_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [employeeLoanId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).id as number);
  }

  async approve(id: number, reviewerId: number, notes: string | null = null): Promise<EmployeeLoan> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Loan not found');
    if (existing.status !== 'pending') {
      throw new ConflictError(`Cannot approve loan in status '${existing.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this loan');
    const decision = await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'approved',
      notes,
      async () => ({ actorUserId: reviewerId, orgUnitId: existing.toOrgUnitId })
    );
    if (!decision.isFinalStep) {
      const refreshed = await this.getById(id);
      if (!refreshed) throw new Error('Failed to refresh loan');
      return refreshed;
    }
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE employee_loans
          SET status = 'approved',
              approver_user_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new ConflictError(`Cannot approve loan in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh loan');
    logger.info(`Loan approved: id=${id} reviewer=${reviewerId}`);
    await this.audit.write({
      actorId: reviewerId,
      action: 'loan.approve',
      entityType: 'employee_loan',
      entityId: id,
      description: `Employee loan approved`,
      justification: notes ?? null,
      after: { status: 'approved', reviewerId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.userId,
      type: 'loan.approved',
      title: 'Loan approved',
      body: `Your cross-unit assignment from ${refreshed.startDate} to ${refreshed.endDate} has been approved.`,
    });
    return refreshed;
  }

  async reject(id: number, reviewerId: number, notes: string | null = null): Promise<EmployeeLoan> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Loan not found');
    if (existing.status !== 'pending') {
      throw new ConflictError(`Cannot reject loan in status '${existing.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this loan');
    await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => ({ actorUserId: reviewerId, orgUnitId: existing.toOrgUnitId })
    );
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE employee_loans
          SET status = 'rejected',
              approver_user_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new ConflictError(`Cannot reject loan in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh loan');
    logger.info(`Loan rejected: id=${id} reviewer=${reviewerId}`);
    await this.audit.write({
      actorId: reviewerId,
      action: 'loan.reject',
      entityType: 'employee_loan',
      entityId: id,
      description: `Employee loan rejected`,
      justification: notes ?? null,
      after: { status: 'rejected', reviewerId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.requestedBy,
      type: 'loan.rejected',
      title: 'Loan rejected',
      body: notes ?? 'Your loan request was rejected.',
    });
    return refreshed;
  }

  async cancel(id: number, requesterId: number): Promise<EmployeeLoan> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE employee_loans
          SET status = 'cancelled'
        WHERE id = ? AND requested_by = ? AND status IN ('pending', 'approved')`,
      [id, requesterId]
    );
    if (res.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Loan not found');
      if (existing.requestedBy !== requesterId) throw new ForbiddenError('Forbidden');
      throw new ConflictError(`Cannot cancel loan in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh loan');
    await this.audit.write({
      actorId: requesterId,
      action: 'loan.cancel',
      entityType: 'employee_loan',
      entityId: id,
      description: `Employee loan cancelled`,
      after: { status: 'cancelled' },
    });
    return refreshed;
  }

  /** Notify both unit managers and (when needed) the approver. */
  private async fanOutNotifications(loan: EmployeeLoan): Promise<void> {
    const [units] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, manager_user_id FROM org_units WHERE id IN (?, ?)`,
      [loan.fromOrgUnitId, loan.toOrgUnitId]
    );
    const targets = new Set<number>();
    for (const u of units) {
      const mgr = u.manager_user_id as number | null;
      if (mgr) targets.add(mgr);
    }
    if (loan.approverUserId && loan.status === 'pending') targets.add(loan.approverUserId);

    for (const userId of targets) {
      this.notifications.notifyAsync({
        userId,
        type: loan.status === 'approved' ? 'loan.created.auto-approved' : 'loan.created',
        title:
          loan.status === 'approved'
            ? 'Loan auto-approved'
            : 'New loan request',
        body: `User ${loan.userId} for ${loan.startDate} to ${loan.endDate}.`,
      });
    }
  }
}
