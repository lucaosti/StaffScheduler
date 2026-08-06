/**
 * Payroll export jobs: builds the batch a provider sends, and owns the
 * `payroll_export_jobs` queue rows `PayrollExportWorker` delivers.
 *
 * WHY THE BATCH IS REBUILT, NOT STORED ON THE JOB ROW. The source data
 * (`shift_assignments`, `users.hourly_rate`) already exists and stays
 * authoritative if it changes before the job runs — storing a snapshot would
 * mean deciding whether a late correction should retroactively change an
 * already-queued export, a question this design avoids by never asking it.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { SHIFT_HOURS_SQL } from '../utils/sql';
import type { PayrollBatch, PayrollLineItem } from './PayrollProvider';

type PayrollExportStatus = 'pending' | 'sent' | 'failed';

export interface PayrollExportJob {
  id: number;
  provider: string;
  rangeStart: string;
  rangeEnd: string;
  status: PayrollExportStatus;
  attempts: number;
  providerReference: string | null;
  lastError: string | null;
  createdBy: number;
  createdAt: string;
  processedAt: string | null;
}

const mapRow = (row: RowDataPacket): PayrollExportJob => ({
  id: row.id as number,
  provider: row.provider as string,
  rangeStart: row.range_start as string,
  rangeEnd: row.range_end as string,
  status: row.status as PayrollExportStatus,
  attempts: row.attempts as number,
  providerReference: (row.provider_reference as string | null) ?? null,
  lastError: (row.last_error as string | null) ?? null,
  createdBy: row.created_by as number,
  createdAt: row.created_at as string,
  processedAt: (row.processed_at as string | null) ?? null,
});

export class PayrollExportService {
  constructor(private pool: Pool) {}

  /**
   * Hours and gross pay per employee over the range, from confirmed/completed
   * assignments and `users.hourly_rate` — the same source and the same
   * overnight-safe hours expression `ReportsService`/`AttendanceService` use.
   * Employees with zero hours in the range are omitted rather than sent as a
   * zero-pay line.
   */
  async buildBatch(rangeStart: string, rangeEnd: string): Promise<PayrollBatch> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id AS user_id,
              CONCAT(u.first_name, ' ', u.last_name) AS full_name,
              u.email,
              COALESCE(SUM(${SHIFT_HOURS_SQL}), 0) AS hours,
              COALESCE(SUM(${SHIFT_HOURS_SQL} * COALESCE(u.hourly_rate, 0)), 0) AS gross_pay
         FROM users u
         JOIN shift_assignments sa ON sa.user_id = u.id
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.status IN ('pending', 'confirmed', 'completed')
          AND s.date BETWEEN ? AND ?
        GROUP BY u.id, full_name, u.email
       HAVING hours > 0
        ORDER BY full_name`,
      [rangeStart, rangeEnd]
    );
    const lines: PayrollLineItem[] = rows.map((r: any) => ({
      userId: r.user_id,
      fullName: r.full_name,
      email: r.email,
      hours: Number(r.hours) || 0,
      grossPay: Number(r.gross_pay) || 0,
    }));
    return { rangeStart, rangeEnd, lines };
  }

  async createJob(
    provider: string,
    rangeStart: string,
    rangeEnd: string,
    createdBy: number
  ): Promise<PayrollExportJob> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO payroll_export_jobs (provider, range_start, range_end, created_by)
       VALUES (?, ?, ?, ?)`,
      [provider, rangeStart, rangeEnd, createdBy]
    );
    const job = await this.getById(res.insertId);
    if (!job) throw new Error('Failed to create payroll export job');
    return job;
  }

  async getById(id: number): Promise<PayrollExportJob | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM payroll_export_jobs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(): Promise<PayrollExportJob[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM payroll_export_jobs ORDER BY created_at DESC LIMIT 200`
    );
    return rows.map(mapRow);
  }
}
