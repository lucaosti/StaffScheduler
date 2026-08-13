/**
 * Department geofence CRUD, and the clock-in validation it exists for.
 *
 * A geofence's `polygon` is stored as JSON — an ordered list of `{lat, lng}`
 * vertices — and validated with `isPointInPolygon` (`utils/geo.ts`) in
 * application code rather than a MySQL spatial column, since the volume (a
 * handful of fences per department) never justifies a spatial index.
 *
 * `isCallerWithinAllowedGeofence` is the enforcement half, kept in this
 * service rather than `AttendanceService` because it needs to resolve which
 * departments a user belongs to and which of those have active fences —
 * department/geofence concerns `AttendanceService` otherwise has no reason to
 * know about.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ValidationUtils } from '../utils';
import { NotFoundError } from '../errors';
import { isPointInAnyPolygon, GeoPoint } from '../utils/geo';

export interface Geofence {
  id: number;
  departmentId: number;
  name: string;
  polygon: GeoPoint[];
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const rowToGeofence = (row: RowDataPacket): Geofence => ({
  id: row.id,
  departmentId: row.department_id,
  name: row.name,
  // An empty polygon contains no point, so a corrupted one fences nothing in
  // rather than failing the whole list — see `parseJsonColumn`.
  polygon: ValidationUtils.parseJsonColumn<GeoPoint[]>(row.polygon, [], 'geofences.polygon'),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class GeofenceService {
  constructor(private pool: Pool) {}

  async listForDepartment(departmentId: number): Promise<Geofence[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM department_geofences WHERE department_id = ? ORDER BY name ASC',
      [departmentId]
    );
    return rows.map(rowToGeofence);
  }

  async create(departmentId: number, data: { name: string; polygon: GeoPoint[]; isActive?: boolean }): Promise<Geofence> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO department_geofences (department_id, name, polygon, is_active) VALUES (?, ?, ?, ?)',
      [departmentId, data.name, JSON.stringify(data.polygon), data.isActive ?? true]
    );
    const created = await this.getById(result.insertId);
    if (!created) throw new Error('Failed to retrieve created geofence');
    return created;
  }

  async getById(id: number): Promise<Geofence | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM department_geofences WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length > 0 ? rowToGeofence(rows[0]) : null;
  }

  async update(
    id: number,
    data: { name?: string; polygon?: GeoPoint[]; isActive?: boolean }
  ): Promise<Geofence> {
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.polygon !== undefined) {
      updates.push('polygon = ?');
      values.push(JSON.stringify(data.polygon));
    }
    if (data.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(data.isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE department_geofences SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
      if (result.affectedRows === 0) throw new NotFoundError('Geofence not found');
    }

    const updated = await this.getById(id);
    if (!updated) throw new NotFoundError('Geofence not found');
    return updated;
  }

  async delete(id: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'DELETE FROM department_geofences WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) throw new NotFoundError('Geofence not found');
    return true;
  }

  /**
   * Whether `point` satisfies the geofence requirement for `userId`.
   *
   * "Requirement" is per-caller, not global: it resolves the departments the
   * user belongs to, gathers their active fences, and returns:
   *  - `{ required: false, allowed: true }` when none of the user's
   *    departments have an active fence — geofencing is simply off for them;
   *  - `{ required: true, allowed: <point inside any fence> }` otherwise.
   *
   * A caller in more than one department is allowed through any one of their
   * departments' fences — the multi-site case (a per-diem or float employee)
   * would otherwise be unable to clock in from a legitimate site because a
   * DIFFERENT department of theirs also has a fence configured.
   */
  async isCallerWithinAllowedGeofence(
    userId: number,
    point: GeoPoint | null
  ): Promise<{ required: boolean; allowed: boolean }> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT g.polygon
         FROM department_geofences g
         JOIN user_departments ud ON ud.department_id = g.department_id
        WHERE ud.user_id = ? AND g.is_active = 1`,
      [userId]
    );

    if (rows.length === 0) {
      return { required: false, allowed: true };
    }

    if (!point) {
      return { required: true, allowed: false };
    }

    // A corrupted polygon falls back to an empty one, which contains no point
    // — so this fence stops matching while the caller's OTHER fences still do.
    // Failing CLOSED is the deliberate direction: a geofence is a restriction,
    // and treating an unreadable one as "allow from anywhere" would turn a
    // data problem into a silent hole in the control. The previous behaviour
    // was worse than either — a bare SyntaxError became a 500, so one bad row
    // stopped clock-in for everyone sharing that department (#723).
    const polygons = rows.map((row) =>
      ValidationUtils.parseJsonColumn<GeoPoint[]>(row.polygon, [], 'geofences.polygon')
    );
    return { required: true, allowed: isPointInAnyPolygon(point, polygons) };
  }
}
