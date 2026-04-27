/**
 * User directory service (F22).
 *
 * Two responsibilities:
 *   1. CRUD over the `user_custom_fields` table so admins can extend user
 *      profiles with arbitrary key/value pairs without schema changes.
 *   2. vCard import / export so the directory plays nicely with phone
 *      address books.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { buildVcfFile, parseVcf, VCard } from '../utils/vcard';

export interface CustomField {
  key: string;
  value: string;
  isPublic: boolean;
}

export interface DirectoryProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  employeeId: string | null;
  phone: string | null;
  position: string | null;
  fields: CustomField[];
}

const mapField = (row: RowDataPacket): CustomField => ({
  key: row.field_key as string,
  value: (row.field_value as string) ?? '',
  isPublic: Boolean(row.is_public),
});

export class UserDirectoryService {
  constructor(private pool: Pool) {}

  async getProfile(userId: number): Promise<DirectoryProfile | null> {
    const [userRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name, role, employee_id, phone, position
         FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (userRows.length === 0) return null;
    const u = userRows[0];

    const [fieldRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT field_key, field_value, is_public
         FROM user_custom_fields
        WHERE user_id = ?
        ORDER BY field_key`,
      [userId]
    );

    return {
      id: u.id as number,
      email: u.email as string,
      firstName: u.first_name as string,
      lastName: u.last_name as string,
      role: u.role as string,
      employeeId: (u.employee_id as string | null) ?? null,
      phone: (u.phone as string | null) ?? null,
      position: (u.position as string | null) ?? null,
      fields: fieldRows.map(mapField),
    };
  }

  /** Bulk upserts fields for a user. Replaces values for keys that match. */
  async setFields(
    userId: number,
    fields: Array<{ key: string; value: string; isPublic?: boolean }>
  ): Promise<void> {
    if (fields.length === 0) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const f of fields) {
        if (!/^[A-Za-z0-9_\-]{1,64}$/.test(f.key)) {
          throw new Error(`Invalid field key '${f.key}'`);
        }
        await conn.execute<ResultSetHeader>(
          `INSERT INTO user_custom_fields (user_id, field_key, field_value, is_public)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             field_value = VALUES(field_value),
             is_public = VALUES(is_public)`,
          [userId, f.key, f.value, f.isPublic ?? true ? 1 : 0]
        );
      }
      await conn.commit();
      logger.info(`Custom fields upserted for user ${userId}: ${fields.length} keys`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async removeField(userId: number, key: string): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM user_custom_fields WHERE user_id = ? AND field_key = ?`,
      [userId, key]
    );
    return res.affectedRows > 0;
  }

  /** Builds a single VCard object from a directory profile. */
  buildCard(profile: DirectoryProfile): VCard {
    const card: VCard = {
      fn: `${profile.firstName} ${profile.lastName}`.trim(),
      givenName: profile.firstName,
      familyName: profile.lastName,
      email: profile.email,
      phone: profile.phone ?? undefined,
      title: profile.position ?? undefined,
      org: 'Staff Scheduler',
    };
    const extra: Record<string, string> = {};
    if (profile.employeeId) extra['X-EMPLOYEE-ID'] = profile.employeeId;
    extra['X-ROLE'] = profile.role;
    for (const f of profile.fields.filter((f) => f.isPublic)) {
      const k = `X-${f.key.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`;
      extra[k] = f.value;
    }
    if (Object.keys(extra).length > 0) card.extra = extra;
    return card;
  }

  async exportVcf(userIds: number[]): Promise<string> {
    const cards: VCard[] = [];
    for (const id of userIds) {
      const profile = await this.getProfile(id);
      if (profile) cards.push(this.buildCard(profile));
    }
    return buildVcfFile(cards);
  }

  /**
   * Imports vCards as new users. Existing emails are skipped (returned as
   * errors). Custom fields prefixed with X- are stored as user_custom_fields
   * rows.
   */
  async importVcf(
    vcfText: string,
    options: { defaultPasswordHash: string; createdBy: number }
  ): Promise<{ inserted: number; skipped: Array<{ email: string; reason: string }> }> {
    const cards = parseVcf(vcfText);
    let inserted = 0;
    const skipped: Array<{ email: string; reason: string }> = [];

    for (const card of cards) {
      if (!card.email) {
        skipped.push({ email: card.fn || '(unknown)', reason: 'missing email' });
        continue;
      }
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        const [existing] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM users WHERE email = ? LIMIT 1`,
          [card.email]
        );
        if (existing.length > 0) {
          await conn.rollback();
          skipped.push({ email: card.email, reason: 'email already exists' });
          continue;
        }
        const employeeId = card.extra?.['X-EMPLOYEE-ID'] ?? null;
        const role = (card.extra?.['X-ROLE']?.toLowerCase() === 'admin'
          ? 'admin'
          : card.extra?.['X-ROLE']?.toLowerCase() === 'manager'
            ? 'manager'
            : 'employee');
        const [userRes] = await conn.execute<ResultSetHeader>(
          `INSERT INTO users (email, password_hash, first_name, last_name, role,
                              employee_id, phone, position, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            card.email,
            options.defaultPasswordHash,
            card.givenName ?? card.fn.split(/\s+/)[0] ?? '',
            card.familyName ?? card.fn.split(/\s+/).slice(1).join(' ') ?? '',
            role,
            employeeId,
            card.phone ?? null,
            card.title ?? null,
          ]
        );
        const userId = userRes.insertId;
        for (const [k, v] of Object.entries(card.extra ?? {})) {
          if (k === 'X-EMPLOYEE-ID' || k === 'X-ROLE') continue;
          const cleanKey = k.replace(/^X-/, '').toLowerCase();
          await conn.execute(
            `INSERT INTO user_custom_fields (user_id, field_key, field_value, is_public)
             VALUES (?, ?, ?, 1)`,
            [userId, cleanKey, v]
          );
        }
        await conn.commit();
        inserted++;
      } catch (err) {
        await conn.rollback();
        skipped.push({
          email: card.email,
          reason: (err as Error).message,
        });
      } finally {
        conn.release();
      }
    }
    logger.info(`vCard import: inserted=${inserted} skipped=${skipped.length}`);
    return { inserted, skipped };
  }
}
