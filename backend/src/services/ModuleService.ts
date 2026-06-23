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

export interface ModuleWithOrgOverride extends Module {
  /** Effective enabled state after applying the org override (same as isEnabled when no override). */
  effectiveEnabled: boolean;
  /** The org-specific override, or null if none is set (global default applies). */
  orgOverride: boolean | null;
}

export class ModuleService {
  /** In-process cache: module code → isEnabled (global). Cleared on every toggle. */
  private cache: Map<string, boolean> | null = null;
  /** Per-org cache: org name → (code → isEnabled). Cleared on override change for that org. */
  private orgCache: Map<string, Map<string, boolean>> = new Map();

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

  async setEnabled(
    code: string,
    isEnabled: boolean,
    actorId?: number | null,
    justification?: string | null
  ): Promise<Module> {
    const before = await this.getByCode(code);
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE modules SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?',
      [isEnabled ? 1 : 0, code]
    );
    if (result.affectedRows === 0) throw new Error(`Module not found: ${code}`);
    this.cache = null;
    logger.info(`Module '${code}' ${isEnabled ? 'enabled' : 'disabled'}`);
    const mod = await this.getByCode(code);
    if (!mod) throw new Error('Failed to retrieve module after update');

    const audit = new (await import('./AuditLogService')).AuditLogService(this.pool);
    await audit.write({
      actorId: actorId ?? null,
      action: 'module.toggle',
      entityType: 'module',
      description: `Module '${code}' ${isEnabled ? 'enabled' : 'disabled'}`,
      justification: justification ?? null,
      before: before as unknown as Record<string, unknown>,
      after: mod as unknown as Record<string, unknown>,
    });

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

  /**
   * Lists all modules with the org-specific override applied.
   * `orgOverride` is null when no override exists (global default in effect).
   */
  async listWithOrgOverrides(org: string): Promise<ModuleWithOrgOverride[]> {
    const modules = await this.list();
    const overrideMap = await this.loadOrgOverrides(org);
    return modules.map((m) => {
      const override = overrideMap.get(m.code) ?? null;
      return {
        ...m,
        effectiveEnabled: override !== null ? override : m.isEnabled,
        orgOverride: override,
      };
    });
  }

  /**
   * Creates or updates a per-organization module override.
   * org-level override takes priority over the global is_enabled value.
   */
  async setOrgOverride(
    code: string,
    org: string,
    isEnabled: boolean,
    updatedBy?: number | null,
    justification?: string | null
  ): Promise<ModuleWithOrgOverride> {
    const mod = await this.getByCode(code);
    if (!mod) throw new Error(`Module not found: ${code}`);

    await this.pool.execute(
      `INSERT INTO organization_module_overrides (organization_name, module_code, is_enabled, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_by = VALUES(updated_by),
                               updated_at = CURRENT_TIMESTAMP`,
      [org, code, isEnabled ? 1 : 0, updatedBy ?? null]
    );
    this.orgCache.delete(org);
    logger.info(`Module override: org='${org}' code='${code}' enabled=${isEnabled}`);

    const audit = new (await import('./AuditLogService')).AuditLogService(this.pool);
    await audit.write({
      actorId: updatedBy ?? null,
      action: 'module.org_override',
      entityType: 'module',
      description: `Module '${code}' org override for '${org}': ${isEnabled ? 'enabled' : 'disabled'}`,
      justification: justification ?? null,
      after: { code, org, isEnabled },
    });

    return {
      ...mod,
      effectiveEnabled: isEnabled,
      orgOverride: isEnabled,
    };
  }

  /**
   * Removes the per-org override for a module, reverting to the global default.
   */
  async removeOrgOverride(code: string, org: string): Promise<void> {
    const mod = await this.getByCode(code);
    if (!mod) throw new Error(`Module not found: ${code}`);

    const [result] = await this.pool.execute<import('mysql2/promise').ResultSetHeader>(
      `DELETE FROM organization_module_overrides WHERE organization_name = ? AND module_code = ?`,
      [org, code]
    );
    this.orgCache.delete(org);
    if (result.affectedRows === 0) throw new Error('Override not found');
    logger.info(`Module override removed: org='${org}' code='${code}'`);
  }

  /**
   * Checks whether a module is enabled for a specific organisation.
   * Org override has priority; falls back to the global default.
   */
  async isEnabledForOrg(code: string, org: string): Promise<boolean> {
    const overrideMap = await this.loadOrgOverrides(org);
    if (overrideMap.has(code)) return overrideMap.get(code)!;
    return this.isEnabled(code);
  }

  private async loadOrgOverrides(org: string): Promise<Map<string, boolean>> {
    if (!this.orgCache.has(org)) {
      const [rows] = await this.pool.execute<import('mysql2/promise').RowDataPacket[]>(
        `SELECT module_code, is_enabled FROM organization_module_overrides WHERE organization_name = ?`,
        [org]
      );
      const m = new Map<string, boolean>();
      for (const r of rows as any[]) m.set(r.module_code, Boolean(r.is_enabled));
      this.orgCache.set(org, m);
    }
    return this.orgCache.get(org)!;
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
