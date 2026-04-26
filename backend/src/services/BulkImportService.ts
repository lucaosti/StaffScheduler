/**
 * Bulk import (F16).
 *
 * Pure parsing functions plus a DB-aware importer. Today we accept CSV text
 * for two entity types:
 *   - employees: email,firstName,lastName,role,employeeId,phone
 *   - shifts:    scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff
 *
 * The parser is hand-rolled (no csv-parser dependency surface in the public
 * API) so the pure functions stay easy to unit test. The importer runs each
 * row in a single transaction; one bad row aborts the whole import so callers
 * never end up with partial state.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { config } from '../config';

export type ImportEntity = 'employees' | 'shifts';

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  inserted: number;
  errors: ImportRowError[];
}

export interface EmployeeRow {
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  phone?: string;
}

export interface ShiftRow {
  scheduleId: number;
  departmentId: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180-ish CSV parser. Supports double-quoted fields, escaped quotes
 * inside quotes (`""`), and CRLF or LF line endings. Returns rows as arrays
 * of cell strings; the caller maps to typed objects.
 */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      cell = '';
      row = [];
    } else if (ch === '\r') {
      // Handled at the next \n; ignore.
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
};

const headerIndex = (header: string[], name: string): number => {
  const idx = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  return idx;
};

export const mapEmployeeRows = (rows: string[][]): { rows: EmployeeRow[]; errors: ImportRowError[] } => {
  if (rows.length === 0) return { rows: [], errors: [{ row: 0, message: 'CSV is empty' }] };
  const header = rows[0];
  const emailIdx = headerIndex(header, 'email');
  const firstIdx = headerIndex(header, 'firstName');
  const lastIdx = headerIndex(header, 'lastName');
  const roleIdx = headerIndex(header, 'role');
  const employeeIdIdx = headerIndex(header, 'employeeId');
  const phoneIdx = headerIndex(header, 'phone');

  if (emailIdx < 0 || firstIdx < 0 || lastIdx < 0 || roleIdx < 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'Missing required columns: email, firstName, lastName, role' }],
    };
  }

  const errors: ImportRowError[] = [];
  const out: EmployeeRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const role = (r[roleIdx] || '').trim().toLowerCase();
    if (!['admin', 'manager', 'employee'].includes(role)) {
      errors.push({ row: i + 1, message: `Invalid role '${r[roleIdx]}'` });
      continue;
    }
    const email = (r[emailIdx] || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i + 1, message: `Invalid email '${email}'` });
      continue;
    }
    out.push({
      email,
      firstName: (r[firstIdx] || '').trim(),
      lastName: (r[lastIdx] || '').trim(),
      role: role as EmployeeRow['role'],
      employeeId: employeeIdIdx >= 0 ? (r[employeeIdIdx] || '').trim() || undefined : undefined,
      phone: phoneIdx >= 0 ? (r[phoneIdx] || '').trim() || undefined : undefined,
    });
  }
  return { rows: out, errors };
};

export const mapShiftRows = (rows: string[][]): { rows: ShiftRow[]; errors: ImportRowError[] } => {
  if (rows.length === 0) return { rows: [], errors: [{ row: 0, message: 'CSV is empty' }] };
  const header = rows[0];
  const required = ['scheduleId', 'departmentId', 'date', 'startTime', 'endTime', 'minStaff', 'maxStaff'];
  const idx: Record<string, number> = {};
  for (const name of required) idx[name] = headerIndex(header, name);
  const missing = required.filter((n) => idx[n] < 0);
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: 1, message: `Missing required columns: ${missing.join(', ')}` }] };
  }
  const errors: ImportRowError[] = [];
  const out: ShiftRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const scheduleId = Number(r[idx.scheduleId]);
    const departmentId = Number(r[idx.departmentId]);
    const minStaff = Number(r[idx.minStaff]);
    const maxStaff = Number(r[idx.maxStaff]);
    const date = (r[idx.date] || '').trim();
    const startTime = (r[idx.startTime] || '').trim();
    const endTime = (r[idx.endTime] || '').trim();
    if (
      !Number.isFinite(scheduleId) ||
      !Number.isFinite(departmentId) ||
      !Number.isFinite(minStaff) ||
      !Number.isFinite(maxStaff)
    ) {
      errors.push({ row: i + 1, message: 'Numeric column failed to parse' });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ row: i + 1, message: `Invalid date '${date}', expected YYYY-MM-DD` });
      continue;
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
      errors.push({ row: i + 1, message: 'Invalid HH:mm time' });
      continue;
    }
    out.push({ scheduleId, departmentId, date, startTime, endTime, minStaff, maxStaff });
  }
  return { rows: out, errors };
};

/* ------------------------------------------------------------------ */
/* Importer                                                            */
/* ------------------------------------------------------------------ */

export class BulkImportService {
  constructor(private pool: Pool) {}

  async importEmployees(csv: string, defaultPassword: string): Promise<ImportResult> {
    const parsed = parseCsv(csv);
    const { rows, errors } = mapEmployeeRows(parsed);
    if (errors.length > 0) return { inserted: 0, errors };

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const passwordHash = await bcrypt.hash(defaultPassword, config.security.bcryptRounds);
      let inserted = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const [existing] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM users WHERE email = ? LIMIT 1`,
          [r.email]
        );
        if (existing.length > 0) {
          await conn.rollback();
          return {
            inserted: 0,
            errors: [{ row: i + 2, message: `Email already exists: ${r.email}` }],
          };
        }
        await conn.execute<ResultSetHeader>(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, employee_id, phone, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            r.email,
            passwordHash,
            r.firstName,
            r.lastName,
            r.role,
            r.employeeId ?? null,
            r.phone ?? null,
          ]
        );
        inserted++;
      }
      await conn.commit();
      return { inserted, errors: [] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async importShifts(csv: string): Promise<ImportResult> {
    const parsed = parseCsv(csv);
    const { rows, errors } = mapShiftRows(parsed);
    if (errors.length > 0) return { inserted: 0, errors };

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      let inserted = 0;
      for (const r of rows) {
        await conn.execute<ResultSetHeader>(
          `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
          [r.scheduleId, r.departmentId, r.date, r.startTime, r.endTime, r.minStaff, r.maxStaff]
        );
        inserted++;
      }
      await conn.commit();
      return { inserted, errors: [] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
