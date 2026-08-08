/**
 * Cost plans: the fixed labor-cost target an administrator sets for one
 * department over one period.
 *
 * WHY A PLAIN CRUD CLASS AND NOT A ROUTE-INLINE QUERY. The actual-cost figure
 * this compares against is a single aggregate query and stays inline in
 * `routes/dashboard.ts`, following that file's own precedent. A cost plan is
 * a full admin-managed entity — create, update, list, delete, one row per
 * department per period, uniqueness enforced — which is more surface than a
 * single query, the same reasoning that gave `EmployeeFieldPolicyService` its
 * own class rather than living inline in its router.
 *
 * WHY UPSERT ON (departmentId, startDate, endDate). The table's unique key
 * makes a second row for the same department and period impossible; `set`
 * mirrors that at the service layer so "change the target" and "set the
 * target for the first time" are the same call, the same shape
 * `EmployeeFieldPolicyService.upsert` already uses for its own admin-set
 * configuration row.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { NotFoundError, ConflictError } from '../errors';

export interface CostPlan {
  id: number;
  departmentId: number;
  startDate: string;
  endDate: string;
  targetAmount: number;
  setByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface CostPlanInput {
  departmentId: number;
  startDate: string;
  endDate: string;
  targetAmount: number;
  setByUserId: number;
}

const mapRow = (row: RowDataPacket): CostPlan => ({
  id: row.id as number,
  departmentId: row.department_id as number,
  startDate: (row.start_date instanceof Date
    ? row.start_date.toISOString().slice(0, 10)
    : row.start_date) as string,
  endDate: (row.end_date instanceof Date
    ? row.end_date.toISOString().slice(0, 10)
    : row.end_date) as string,
  targetAmount: Number(row.target_amount),
  setByUserId: row.set_by_user_id as number,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export class CostPlanService {
  constructor(private readonly pool: Pool) {}

  async list(departmentId?: number): Promise<CostPlan[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      departmentId === undefined
        ? 'SELECT * FROM cost_plans ORDER BY start_date DESC, department_id ASC'
        : 'SELECT * FROM cost_plans WHERE department_id = ? ORDER BY start_date DESC',
      departmentId === undefined ? [] : [departmentId]
    );
    return rows.map(mapRow);
  }

  async getById(id: number): Promise<CostPlan> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT * FROM cost_plans WHERE id = ?',
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Cost plan not found');
    return mapRow(rows[0]);
  }

  /**
   * The plan covering this exact period for this department, if one exists —
   * what `/dashboard/stats` reads for the current month's comparison.
   */
  async findForPeriod(
    departmentId: number,
    startDate: string,
    endDate: string
  ): Promise<CostPlan | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT * FROM cost_plans WHERE department_id = ? AND start_date = ? AND end_date = ?',
      [departmentId, startDate, endDate]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /**
   * The total of every plan whose period overlaps the given window — the
   * dashboard's monthly window rarely lines up exactly with a plan's own
   * period, so "the target for this month" is the sum of whatever plans
   * apply to any part of it, across all departments (or one, when scoped).
   */
  async sumTargetForWindow(
    windowStart: string,
    windowEnd: string,
    departmentId?: number
  ): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(target_amount), 0) AS total
         FROM cost_plans
        WHERE start_date <= ? AND end_date >= ?
          ${departmentId === undefined ? '' : 'AND department_id = ?'}`,
      departmentId === undefined
        ? [windowEnd, windowStart]
        : [windowEnd, windowStart, departmentId]
    );
    return Number((rows[0] as RowDataPacket).total ?? 0);
  }

  async create(input: CostPlanInput): Promise<CostPlan> {
    if (input.endDate < input.startDate) {
      throw new ConflictError('endDate must not be before startDate');
    }
    try {
      const [result] = await this.pool.execute(
        `INSERT INTO cost_plans (department_id, start_date, end_date, target_amount, set_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [input.departmentId, input.startDate, input.endDate, input.targetAmount, input.setByUserId]
      );
      const insertId = (result as { insertId: number }).insertId;
      return this.getById(insertId);
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictError(
          'A cost plan already exists for this department and period; update it instead'
        );
      }
      throw err;
    }
  }

  async update(id: number, targetAmount: number): Promise<CostPlan> {
    const [result] = await this.pool.execute(
      'UPDATE cost_plans SET target_amount = ? WHERE id = ?',
      [targetAmount, id]
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new NotFoundError('Cost plan not found');
    }
    return this.getById(id);
  }

  async remove(id: number): Promise<void> {
    const [result] = await this.pool.execute('DELETE FROM cost_plans WHERE id = ?', [id]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new NotFoundError('Cost plan not found');
    }
  }
}
