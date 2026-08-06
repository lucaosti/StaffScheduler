/**
 * SSO identity-provider configuration (`sso_providers`) — CRUD.
 *
 * Per-organization data, not a deployment-wide secret in `.env`: see the
 * migration's own header for why this is a table and not an env var. The
 * client secret is never returned from `listPublic` — that endpoint is
 * reachable by an unauthenticated caller building a login page, and needs
 * only enough to render a "Sign in with…" button.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { NotFoundError } from '../errors';

export interface SsoProvider {
  id: number;
  organizationName: string | null;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  isActive: boolean;
  jitProvisioningEnabled: boolean;
  defaultRoleId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** What an unauthenticated login page may see: enough to render a button. */
export interface SsoProviderPublic {
  id: number;
  name: string;
}

export interface CreateSsoProviderInput {
  organizationName?: string | null;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  jitProvisioningEnabled?: boolean;
  defaultRoleId?: number | null;
}

export interface UpdateSsoProviderInput {
  name?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  jwksUrl?: string;
  isActive?: boolean;
  jitProvisioningEnabled?: boolean;
  defaultRoleId?: number | null;
}

const mapRow = (row: RowDataPacket): SsoProvider => ({
  id: row.id as number,
  organizationName: (row.organization_name as string | null) ?? null,
  name: row.name as string,
  issuer: row.issuer as string,
  clientId: row.client_id as string,
  clientSecret: row.client_secret as string,
  authorizationUrl: row.authorization_url as string,
  tokenUrl: row.token_url as string,
  jwksUrl: row.jwks_url as string,
  isActive: Boolean(row.is_active),
  jitProvisioningEnabled: Boolean(row.jit_provisioning_enabled),
  defaultRoleId: (row.default_role_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class SsoProviderService {
  constructor(private pool: Pool) {}

  /** Every provider, for administration. Carries the client secret. */
  async list(): Promise<SsoProvider[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM sso_providers ORDER BY name`
    );
    return rows.map(mapRow);
  }

  /**
   * Active providers available to a login page for the given organization —
   * the org's own configured providers plus any platform-wide one
   * (`organization_name IS NULL`). Never carries the client secret.
   */
  async listPublic(organizationName: string | null): Promise<SsoProviderPublic[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name FROM sso_providers
        WHERE is_active = 1 AND (organization_name IS NULL OR organization_name = ?)
        ORDER BY name`,
      [organizationName]
    );
    return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
  }

  async getById(id: number): Promise<SsoProvider | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM sso_providers WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async create(input: CreateSsoProviderInput): Promise<SsoProvider> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO sso_providers
         (organization_name, name, issuer, client_id, client_secret,
          authorization_url, token_url, jwks_url, jit_provisioning_enabled, default_role_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationName ?? null,
        input.name,
        input.issuer,
        input.clientId,
        input.clientSecret,
        input.authorizationUrl,
        input.tokenUrl,
        input.jwksUrl,
        input.jitProvisioningEnabled ?? false,
        input.defaultRoleId ?? null,
      ]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create SSO provider');
    return created;
  }

  async update(id: number, patch: UpdateSsoProviderInput): Promise<SsoProvider> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('SSO provider not found');
    const merged: SsoProvider = {
      ...existing,
      name: patch.name ?? existing.name,
      issuer: patch.issuer ?? existing.issuer,
      clientId: patch.clientId ?? existing.clientId,
      clientSecret: patch.clientSecret ?? existing.clientSecret,
      authorizationUrl: patch.authorizationUrl ?? existing.authorizationUrl,
      tokenUrl: patch.tokenUrl ?? existing.tokenUrl,
      jwksUrl: patch.jwksUrl ?? existing.jwksUrl,
      isActive: patch.isActive ?? existing.isActive,
      jitProvisioningEnabled: patch.jitProvisioningEnabled ?? existing.jitProvisioningEnabled,
      defaultRoleId: patch.defaultRoleId !== undefined ? patch.defaultRoleId : existing.defaultRoleId,
    };
    await this.pool.execute(
      `UPDATE sso_providers
          SET name = ?, issuer = ?, client_id = ?, client_secret = ?,
              authorization_url = ?, token_url = ?, jwks_url = ?,
              is_active = ?, jit_provisioning_enabled = ?, default_role_id = ?
        WHERE id = ?`,
      [
        merged.name,
        merged.issuer,
        merged.clientId,
        merged.clientSecret,
        merged.authorizationUrl,
        merged.tokenUrl,
        merged.jwksUrl,
        merged.isActive ? 1 : 0,
        merged.jitProvisioningEnabled ? 1 : 0,
        merged.defaultRoleId,
        id,
      ]
    );
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh SSO provider');
    return refreshed;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('SSO provider not found');
    await this.pool.execute(`DELETE FROM sso_providers WHERE id = ?`, [id]);
  }
}
