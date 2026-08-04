/**
 * Kiosk device credentials — shared-tablet clock-in/out (#309).
 *
 * A kiosk is not a user session: the tablet holds one long-lived device
 * token (configured once by an admin), and every punch identifies a
 * DIFFERENT person by their employee id. This is the opposite trust shape
 * from a normal login, which is why it is its own table and its own
 * middleware (`middleware/kioskAuth.ts`) rather than a JWT — a JWT encodes
 * one subject's identity for its lifetime, and a kiosk's identity (which
 * device) is deliberately separate from whoever is currently punching.
 *
 * Token storage mirrors `RefreshTokenService`: only the SHA-256 hash is
 * stored, the raw token exists in plaintext only at issuance, and lookup is
 * a single indexed equality — no weak secret to stretch, since the token is
 * 32 random bytes already.
 *
 * @author Luca Ostinelli
 */

import { createHash, randomBytes } from 'crypto';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { NotFoundError } from '../errors';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface KioskDevice {
  id: number;
  name: string;
  departmentId: number;
  isActive: boolean;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
}

const rowToDevice = (row: RowDataPacket): KioskDevice => ({
  id: row.id,
  name: row.name,
  departmentId: row.department_id,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export class KioskService {
  constructor(private pool: Pool) {}

  async listForDepartment(departmentId: number): Promise<KioskDevice[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM kiosk_devices WHERE department_id = ? ORDER BY name ASC',
      [departmentId]
    );
    return rows.map(rowToDevice);
  }

  /** Returns the device plus the RAW token — the only time it exists in plaintext. */
  async create(departmentId: number, name: string, createdBy: number | null): Promise<{ device: KioskDevice; token: string }> {
    const token = randomBytes(32).toString('hex');
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO kiosk_devices (name, department_id, token_hash, created_by) VALUES (?, ?, ?, ?)',
      [name, departmentId, hashToken(token), createdBy]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM kiosk_devices WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    return { device: rowToDevice(rows[0]), token };
  }

  async revoke(id: number): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE kiosk_devices SET is_active = 0 WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) throw new NotFoundError('Kiosk device not found');
  }

  /**
   * Resolves a presented raw token to the active device it belongs to, or
   * null for anything unknown, revoked, or malformed — the caller (the
   * `authenticateKiosk` middleware) maps null to a 401. Updates
   * `last_used_at` on success so a stale/forgotten kiosk is visible in the
   * admin list rather than indistinguishable from one in daily use.
   */
  /**
   * Resolves a scanned/typed employee id to a user, scoped to the kiosk's own
   * department — a tablet in one department cannot be used to punch someone
   * who has never belonged to it, which is what "restricted-permission
   * tablet" means in practice. Returns null rather than throwing so the
   * route can render one generic "employee not found" response regardless of
   * whether the id is wrong or the person is in a different department; a
   * kiosk should not leak which case it was.
   */
  async resolveEmployee(employeeId: string, departmentId: number): Promise<{ id: number; name: string } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.first_name, u.last_name
         FROM users u
         JOIN user_departments ud ON ud.user_id = u.id
        WHERE u.employee_id = ? AND u.is_active = 1 AND ud.department_id = ?
        LIMIT 1`,
      [employeeId, departmentId]
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id, name: `${rows[0].first_name} ${rows[0].last_name}` };
  }

  async authenticate(rawToken: string): Promise<KioskDevice | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM kiosk_devices WHERE token_hash = ? AND is_active = 1 LIMIT 1',
      [hashToken(rawToken)]
    );
    if (rows.length === 0) return null;
    await this.pool.execute('UPDATE kiosk_devices SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [rows[0].id]);
    return rowToDevice(rows[0]);
  }
}
