/**
 * Module Service
 *
 * Manages runtime feature flags stored in the `modules` table. Provides a
 * cached look-up so `requireModule` middleware does not issue a DB query on
 * every single request; the cache is invalidated when a module is toggled.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logger } from '../config/logger';

export interface Module {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  updatedAt: Date;
}

export class ModuleService {
  /** In-process cache: module code → isEnabled. Cleared on every toggle. */
  private cache: Map<string, boolean> | null = null;

  constructor(private pool: Pool) {}

  async list(): Promise<Module[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, code, name, description, is_enabled, updated_at FROM modules ORDER BY code ASC'
    );
    return rows.map((r: any) => this.mapRow(r));
  }

  async getByCode(code: string): Promise<Module | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, code, name, description, is_enabled, updated_at FROM modules WHERE code = ? LIMIT 1',
      [code]
    );
    return rows.length ? this.mapRow(rows[0] as any) : null;
  }

  async setEnabled(code: string, isEnabled: boolean): Promise<Module> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE modules SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?',
      [isEnabled ? 1 : 0, code]
    );
    if (result.affectedRows === 0) throw new Error(`Module not found: ${code}`);
    this.cache = null;
    logger.info(`Module '${code}' ${isEnabled ? 'enabled' : 'disabled'}`);
    const mod = await this.getByCode(code);
    if (!mod) throw new Error('Failed to retrieve module after update');
    return mod;
  }

  /**
   * Returns true if the module is enabled. Uses an in-process cache built
   * from a single DB query (all modules) so the hot-path cost is zero after
   * the first check within a process lifetime.
   */
  async isEnabled(code: string): Promise<boolean> {
    if (this.cache === null) await this.buildCache();
    return this.cache!.get(code) ?? false;
  }

  private async buildCache(): Promise<void> {
    const modules = await this.list();
    this.cache = new Map(modules.map((m) => [m.code, m.isEnabled]));
  }

  private mapRow(r: any): Module {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description ?? null,
      isEnabled: Boolean(r.is_enabled),
      updatedAt: r.updated_at,
    };
  }
}
