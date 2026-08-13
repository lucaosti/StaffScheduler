/**
 * Organization translation overrides (`translation_overrides`) — CRUD, and
 * the resolution an authenticated caller's own frontend uses to render
 * itself.
 *
 * Per-organization data, not a deployment-wide file in `./locales`: see the
 * migration's own header for why this is a table and not a JSON asset. The
 * whole override map for one organization+locale lives in a single JSON
 * column, matching `applyOrganizationOverrides(locale, overrides)`'s
 * existing frontend signature exactly.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ValidationUtils } from '../utils';
import { NotFoundError } from '../errors';

export interface TranslationOverride {
  id: number;
  organizationName: string | null;
  locale: string;
  overrides: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTranslationOverrideInput {
  organizationName?: string | null;
  locale: string;
  overrides: Record<string, string>;
}

const mapRow = (row: RowDataPacket): TranslationOverride => ({
  id: row.id as number,
  organizationName: (row.organization_name as string | null) ?? null,
  locale: row.locale as string,
  // A corrupted override set falls back to none, so the UI shows the shipped
  // translations for that locale instead of failing the whole list.
  overrides: ValidationUtils.parseJsonColumn<Record<string, string>>(
    row.overrides,
    {},
    'translation_overrides.overrides'
  ),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class TranslationOverrideService {
  constructor(private pool: Pool) {}

  /** Every override row, for administration. */
  async list(): Promise<TranslationOverride[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM translation_overrides ORDER BY locale, organization_name IS NULL DESC, organization_name`
    );
    return rows.map(mapRow);
  }

  async getById(id: number): Promise<TranslationOverride | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM translation_overrides WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /**
   * The override map an authenticated caller's own frontend should apply for
   * `locale`: the organization's own row if it has one, otherwise the
   * platform-wide (`organization_name IS NULL`) row, otherwise an empty map.
   * Same visibility shape as `SsoProviderService.listPublic` — the org's own
   * row wins over the platform-wide fallback.
   */
  async resolveForOrganization(
    organizationName: string | null,
    locale: string
  ): Promise<Record<string, string>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM translation_overrides
        WHERE locale = ? AND (organization_name IS NULL OR organization_name = ?)
        ORDER BY organization_name IS NULL ASC
        LIMIT 1`,
      [locale, organizationName]
    );
    return rows.length === 0 ? {} : mapRow(rows[0]).overrides;
  }

  async create(input: CreateTranslationOverrideInput): Promise<TranslationOverride> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO translation_overrides (organization_name, locale, overrides)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE overrides = VALUES(overrides), id = LAST_INSERT_ID(id)`,
      [input.organizationName ?? null, input.locale, JSON.stringify(input.overrides)]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create translation override');
    return created;
  }

  async update(id: number, overrides: Record<string, string>): Promise<TranslationOverride> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Translation override not found');
    await this.pool.execute(`UPDATE translation_overrides SET overrides = ? WHERE id = ?`, [
      JSON.stringify(overrides),
      id,
    ]);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh translation override');
    return refreshed;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Translation override not found');
    await this.pool.execute(`DELETE FROM translation_overrides WHERE id = ?`, [id]);
  }
}
