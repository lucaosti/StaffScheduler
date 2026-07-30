/**
 * Role grants and revocations as a timeline — and honest about what it cannot see.
 *
 * WHY THE HISTORY IS NOT THE STATE. Current grants live in `user_roles`; the
 * events that produced them live in the audit log. They are different things and
 * the difference is not academic:
 *
 *  - a grant made before auditing existed, or written by the seed, appears in
 *    `user_roles` with NO corresponding event;
 *  - a grant that reached its `expires_at` stops applying WITHOUT producing any
 *    event at all — nobody revoked it, it simply lapsed.
 *
 * A view built only from events would therefore state that someone never
 * received a role they demonstrably hold, and would show a lapsed grant as still
 * live. So both are read, and every current grant is marked with whether the
 * timeline actually explains it (`hasHistory`). "This role was granted at some
 * point we cannot show you" is a useful thing to say; silently implying it never
 * happened is not.
 *
 * WHY EXPIRY IS SYNTHESISED AS AN EVENT. A grant whose `expires_at` has passed
 * gets an `expired` entry at that timestamp, so reading down the timeline
 * explains the person's current state without the reader having to cross-check
 * dates themselves. It is marked `derived: true` because nothing recorded it —
 * it is inferred from the grant, and a reader who wants only what was actually
 * logged must be able to tell the two apart.
 *
 * WHY THE PER-ROLE QUERY IS BOUNDED AND THE PER-USER ONE IS INDEXED. Per user,
 * `(entity_type, entity_id)` is an index the audit table already has. Per role,
 * the role id lives inside the JSON snapshot, which no index covers — so that
 * query is a scan over `action IN ('role.grant','role.revoke')` (itself
 * indexed), narrowed by a date range and hard-capped. Documented rather than
 * hidden: an unbounded JSON scan over an audit table that only grows is the kind
 * of query that is fine for a year and then is not.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

/** The two audited actions, and the one this service derives. */
export type RoleTimelineAction = 'granted' | 'revoked' | 'expired';

export interface RoleTimelineEntry {
  /** Null for a derived entry, which has no audit row behind it. */
  auditId: number | null;
  at: string;
  action: RoleTimelineAction;
  userId: number;
  userName: string | null;
  roleId: number | null;
  roleName: string | null;
  scopeOrgUnitId: number | null;
  scopeOrgUnitName: string | null;
  /** When the grant was set to lapse. Null means open-ended. */
  expiresAt: string | null;
  actorId: number | null;
  actorName: string | null;
  justification: string | null;
  /** True when nothing recorded this — it is inferred from the grant itself. */
  derived: boolean;
}

export interface CurrentGrant {
  userId: number;
  userName: string | null;
  roleId: number;
  roleName: string | null;
  scopeOrgUnitId: number | null;
  scopeOrgUnitName: string | null;
  expiresAt: string | null;
  /** False when no `role.grant` event explains this grant — see the header. */
  hasHistory: boolean;
}

export interface RoleTimeline {
  current: CurrentGrant[];
  entries: RoleTimelineEntry[];
  /**
   * True when the cap was reached, so the caller knows the timeline is a window
   * rather than the whole story. A truncated list presented as complete is the
   * failure this flag exists to prevent.
   */
  truncated: boolean;
}

/** Hard cap on returned events. A timeline is read, not paged through. */
const MAX_ENTRIES = 500;

interface AuditRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  action: string;
  entity_id: number | null;
  justification: string | null;
  before_snapshot: unknown;
  after_snapshot: unknown;
  created_at: Date | string;
}

/** MySQL returns JSON columns already parsed; a string is the older driver path. */
const snapshot = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
};

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

export class RoleTimelineService {
  constructor(private readonly pool: Pool) {}

  /** id → display name, for users, roles and org units in one pass each. */
  private async names(
    userIds: number[],
    roleIds: number[],
    orgUnitIds: number[]
  ): Promise<{
    users: Map<number, string>;
    roles: Map<number, string>;
    units: Map<number, string>;
  }> {
    const clean = (ids: number[]) => [...new Set(ids)].filter((id): id is number => Number.isInteger(id) && id > 0);
    const [u, r, o] = [clean(userIds), clean(roleIds), clean(orgUnitIds)];

    const lookup = async (table: string, ids: number[], expr: string): Promise<Map<number, string>> => {
      if (ids.length === 0) return new Map();
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT id, ${expr} AS label FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      return new Map(rows.map((row) => [row.id as number, row.label as string]));
    };

    const [users, roles, units] = await Promise.all([
      lookup('users', u, "CONCAT(first_name, ' ', last_name)"),
      lookup('roles', r, 'name'),
      lookup('org_units', o, 'name'),
    ]);
    return { users, roles, units };
  }

  /**
   * Turns audit rows into timeline entries.
   *
   * A revocation carries its payload in `before_snapshot` and a grant in
   * `after_snapshot` — reading only one of them is how half the timeline would
   * come back with a null role.
   */
  private toEntries(rows: AuditRow[]): Omit<RoleTimelineEntry, 'userName' | 'roleName' | 'scopeOrgUnitName' | 'actorName'>[] {
    return rows.map((row) => {
      const granted = row.action === 'role.grant';
      const payload = snapshot(granted ? row.after_snapshot : row.before_snapshot);
      return {
        auditId: row.id,
        at: asIso(row.created_at),
        action: (granted ? 'granted' : 'revoked') as RoleTimelineAction,
        userId: (asNumber(payload.userId) ?? row.entity_id ?? 0) as number,
        roleId: asNumber(payload.roleId),
        scopeOrgUnitId: asNumber(payload.scopeOrgUnitId),
        expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
        actorId: row.user_id,
        justification: row.justification,
        derived: false,
      };
    });
  }

  /** Current grants, with whether the timeline explains each one. */
  private async currentGrants(
    filter: { userId?: number; roleId?: number },
    explained: Set<string>
  ): Promise<Omit<CurrentGrant, 'userName' | 'roleName' | 'scopeOrgUnitName'>[]> {
    const where: string[] = [];
    const params: number[] = [];
    if (filter.userId !== undefined) {
      where.push('ur.user_id = ?');
      params.push(filter.userId);
    }
    if (filter.roleId !== undefined) {
      where.push('ur.role_id = ?');
      params.push(filter.roleId);
    }

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ur.user_id, ur.role_id, ur.scope_org_unit_id, ur.expires_at
         FROM user_roles ur
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ur.user_id ASC, ur.role_id ASC`,
      params
    );

    return rows.map((row) => ({
      userId: row.user_id as number,
      roleId: row.role_id as number,
      scopeOrgUnitId: (row.scope_org_unit_id as number | null) ?? null,
      expiresAt: row.expires_at ? asIso(row.expires_at as Date) : null,
      hasHistory: explained.has(`${row.user_id}:${row.role_id}`),
    }));
  }

  /**
   * The timeline for one user, or for one role.
   *
   * Exactly one of the two is required — a call with neither would scan the
   * whole audit table, and a call with both is a question nobody asks.
   */
  async getTimeline(filter: { userId?: number; roleId?: number; since?: string }): Promise<RoleTimeline> {
    const params: Array<number | string> = [];
    let scope: string;

    if (filter.userId !== undefined) {
      // Uses the (entity_type, entity_id) index the audit table already has.
      scope = "al.entity_type = 'user' AND al.entity_id = ?";
      params.push(filter.userId);
    } else if (filter.roleId !== undefined) {
      // No index reaches inside the JSON snapshot; the action filter and the
      // date range are what keep this bounded. See the header.
      scope =
        "(JSON_EXTRACT(al.after_snapshot, '$.roleId') = ? OR JSON_EXTRACT(al.before_snapshot, '$.roleId') = ?)";
      params.push(filter.roleId, filter.roleId);
    } else {
      throw new Error('A role timeline needs either a userId or a roleId');
    }

    let sinceClause = '';
    if (filter.since) {
      sinceClause = 'AND al.created_at >= ?';
      params.push(filter.since);
    }

    const [rows] = await this.pool.query<AuditRow[]>(
      `SELECT al.id, al.user_id, al.action, al.entity_id, al.justification,
              al.before_snapshot, al.after_snapshot, al.created_at
         FROM audit_logs al
        WHERE al.action IN ('role.grant', 'role.revoke')
          AND ${scope}
          ${sinceClause}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${MAX_ENTRIES + 1}`,
      params
    );

    const truncated = rows.length > MAX_ENTRIES;
    const bare = this.toEntries(rows.slice(0, MAX_ENTRIES));

    // Which (user, role) pairs the timeline actually accounts for.
    const explained = new Set(
      bare.filter((e) => e.action === 'granted' && e.roleId !== null).map((e) => `${e.userId}:${e.roleId}`)
    );
    const current = await this.currentGrants(
      {
        ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
        ...(filter.roleId !== undefined ? { roleId: filter.roleId } : {}),
      },
      explained
    );

    // A lapsed grant produced no event; synthesise one so reading down the
    // timeline explains the current state without cross-checking dates.
    const now = Date.now();
    const derived = current
      .filter((g) => g.expiresAt !== null && Date.parse(g.expiresAt) <= now)
      .map((g) => ({
        auditId: null,
        at: g.expiresAt as string,
        action: 'expired' as RoleTimelineAction,
        userId: g.userId,
        roleId: g.roleId,
        scopeOrgUnitId: g.scopeOrgUnitId,
        expiresAt: g.expiresAt,
        actorId: null,
        justification: null,
        derived: true,
      }));

    const all = [...bare, ...derived].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const { users, roles, units } = await this.names(
      [...all.map((e) => e.userId), ...all.map((e) => e.actorId ?? 0), ...current.map((g) => g.userId)],
      [...all.map((e) => e.roleId ?? 0), ...current.map((g) => g.roleId)],
      [...all.map((e) => e.scopeOrgUnitId ?? 0), ...current.map((g) => g.scopeOrgUnitId ?? 0)]
    );

    return {
      truncated,
      current: current.map((g) => ({
        ...g,
        userName: users.get(g.userId) ?? null,
        roleName: roles.get(g.roleId) ?? null,
        scopeOrgUnitName: g.scopeOrgUnitId !== null ? (units.get(g.scopeOrgUnitId) ?? null) : null,
      })),
      entries: all.map((e) => ({
        ...e,
        userName: users.get(e.userId) ?? null,
        roleName: e.roleId !== null ? (roles.get(e.roleId) ?? null) : null,
        scopeOrgUnitName: e.scopeOrgUnitId !== null ? (units.get(e.scopeOrgUnitId) ?? null) : null,
        actorName: e.actorId !== null ? (users.get(e.actorId) ?? null) : null,
      })),
    };
  }
}
