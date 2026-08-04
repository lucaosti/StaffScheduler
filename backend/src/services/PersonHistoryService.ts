/**
 * "As of a past date, what was true about this person" — projected from the
 * audit trail rather than a dedicated temporal schema.
 *
 * WHY THIS PROJECTS FROM `audit_logs` INSTEAD OF ITS OWN TEMPORAL TABLES. Every
 * fact this answers (role grants/revocations, org-unit membership, org-unit
 * headship) is already captured there, immutably and append-only (DB-trigger
 * enforced). A dedicated `valid_from`/`valid_to` table set would be a second
 * write path recording the same facts a mutation already reports — the
 * "unwired second capability sitting next to the real one" shape this project
 * has reversed elsewhere. See issue #600 / #327's decision record for the
 * full comparison against a schema-level alternative.
 *
 * WHY ROLES AND MEMBERSHIP REPLAY CLEANLY BUT HEADSHIP DOESN'T. A role grant
 * and an org-unit membership join are both INSERT-shaped actions — every one
 * that has ever existed produced an audit row at the moment it happened, so
 * replaying `role.grant`/`role.revoke` and `org_unit.member_add`/`_remove`/
 * `_primary_set` up to a timestamp fully reconstructs "held as of then".
 * Headship is different: `org_units.manager_user_id` can be set at unit
 * CREATION (`OrgUnitService.create`, which writes no audit row — org unit
 * creation itself is not considered sensitive enough to audit) and only
 * later changes go through `update()`, which is audited. So a unit that was
 * created with a manager and never touched again has NO audit trail at all
 * for its headship — replaying forward from nothing would wrongly conclude
 * no one has ever headed it.
 *
 * The fix is to anchor on the CURRENT value and walk BACKWARD: for each org
 * unit, the value as of T is either (a) the `before` snapshot of the
 * earliest `org_unit.update` event that happened AFTER T — nothing changed
 * between T and that event, so its `before` is exactly what was true at T —
 * or (b), when no update happened after T at all, simply the unit's current
 * `manager_user_id`, since nothing has changed since T by definition. This
 * handles the never-updated unit correctly without needing an audit row to
 * exist for its creation.
 *
 * WHY EVERY ORG UNIT IS CHECKED RATHER THAN ONLY ONES MENTIONING THIS USER.
 * The question is "who headed unit X as of T", asked for every unit, then
 * filtered to this user — not "did this user's id ever appear in an
 * org_unit.update payload", which would miss a unit whose only relevant
 * event is in the future (after T) and whose CURRENT manager is someone
 * else, even though this user headed it at T. Org units are few enough
 * (the tree is typically under 10 levels deep, same assumption the org-tree
 * CTE queries already make) that checking all of them, each against its own
 * — typically tiny — update history, is the correct approach at this scale
 * rather than a false optimization that gets the answer wrong.
 *
 * WHY MEMBERSHIP EVENTS ARE FILTERED IN JS, NOT BY AN INDEXED COLUMN. Role
 * events key `entity_id` on the subject user directly (indexed via
 * `idx_entity`). Membership events key it on the ORG UNIT — the subject's id
 * lives inside the JSON `before`/`after` payload, which has no index. This is
 * the unindexed-but-bounded scan #600 explicitly left as an implementation
 * choice pending real data volume: at today's scale (a few thousand audit
 * rows per organization at most) a full scan of membership-action rows is
 * fast; if that stops being true, a generated column projecting the JSON
 * `userId` for indexing is the documented next step, not a schema rewrite.
 *
 * WHAT THIS CANNOT SEE, SAME CAVEAT AS `RoleTimelineService`. A role grant or
 * org-unit membership written before auditing existed, or inserted directly
 * (a seed, a migration-time fixup), has no audit row at all — this
 * necessarily reconstructs "held as of T" as absent, even though it may
 * genuinely have been held. This is inherent to reconstructing from a log
 * rather than a temporal table (see the class header on why that trade was
 * made anyway) and is not something a smarter query can fix; it degrades the
 * same way `RoleTimelineService`'s `hasHistory` flag already documents for
 * the current-state view.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { OrgUnitService } from './OrgUnitService';

export interface PersonHistoryRole {
  roleId: number;
  scopeOrgUnitId: number | null;
  expiresAt: string | null;
}

export interface PersonHistoryOrgUnit {
  orgUnitId: number;
  isPrimary: boolean;
}

export interface PersonHistorySnapshot {
  userId: number;
  /** The instant this snapshot was reconstructed as of, echoed back verbatim. */
  asOf: string;
  rolesHeld: PersonHistoryRole[];
  orgUnitsBelongedTo: PersonHistoryOrgUnit[];
  /** Org units this person headed (`manager_user_id`) as of `asOf`. */
  orgUnitsHeaded: number[];
}

interface AuditEventRow extends RowDataPacket {
  action: string;
  before_snapshot: string | Record<string, unknown> | null;
  after_snapshot: string | Record<string, unknown> | null;
  created_at: string | Date;
}

const parseJson = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
};

export class PersonHistoryService {
  private readonly units: OrgUnitService;

  constructor(private readonly pool: Pool) {
    this.units = new OrgUnitService(pool);
  }

  /** Roles held as of `asOf`, replaying grant/revoke events in order. */
  private async rolesHeldAsOf(userId: number, asOf: string): Promise<PersonHistoryRole[]> {
    const [rows] = await this.pool.execute<AuditEventRow[]>(
      `SELECT action, before_snapshot, after_snapshot, created_at
         FROM audit_logs
        WHERE action IN ('role.grant', 'role.revoke')
          AND entity_type = 'user'
          AND entity_id = ?
          AND created_at <= ?
        ORDER BY created_at ASC, id ASC`,
      [userId, asOf]
    );

    const held = new Map<string, PersonHistoryRole>();
    for (const row of rows) {
      if (row.action === 'role.grant') {
        const after = parseJson(row.after_snapshot);
        if (!after) continue;
        const roleId = after.roleId as number;
        const scopeOrgUnitId = (after.scopeOrgUnitId as number | null) ?? null;
        const key = `${roleId}:${scopeOrgUnitId ?? 'null'}`;
        held.set(key, { roleId, scopeOrgUnitId, expiresAt: (after.expiresAt as string | null) ?? null });
      } else {
        const before = parseJson(row.before_snapshot);
        if (!before) continue;
        const roleId = before.roleId as number;
        const scopeOrgUnitId = (before.scopeOrgUnitId as number | null) ?? null;
        held.delete(`${roleId}:${scopeOrgUnitId ?? 'null'}`);
      }
    }

    // A grant with an expiry that had already passed by `asOf` is not held
    // anymore even absent an explicit revoke — expiry is enforced by every
    // live permission check (see RbacService), so history must agree with it.
    return [...held.values()].filter((r) => r.expiresAt === null || r.expiresAt > asOf);
  }

  /**
   * Org units belonged to as of `asOf`, replaying membership events in
   * order. `entity_id` on these events is the org unit, not the subject —
   * see the class header for why the subject filter runs against the JSON
   * payload instead.
   */
  private async orgUnitsBelongedToAsOf(userId: number, asOf: string): Promise<PersonHistoryOrgUnit[]> {
    const [rows] = await this.pool.execute<AuditEventRow[]>(
      `SELECT action, before_snapshot, after_snapshot, created_at
         FROM audit_logs
        WHERE action IN ('org_unit.member_add', 'org_unit.member_remove', 'org_unit.primary_set')
          AND entity_type = 'user_org_unit'
          AND created_at <= ?
          AND (
            JSON_EXTRACT(after_snapshot, '$.userId') = ?
            OR JSON_EXTRACT(before_snapshot, '$.userId') = ?
          )
        ORDER BY created_at ASC, id ASC`,
      [asOf, userId, userId]
    );

    const belonged = new Map<number, boolean>();
    const clearPrimary = () => {
      for (const [unitId, isPrimary] of belonged) {
        if (isPrimary) belonged.set(unitId, false);
      }
    };
    for (const row of rows) {
      if (row.action === 'org_unit.member_remove') {
        const before = parseJson(row.before_snapshot);
        if (!before) continue;
        belonged.delete(before.orgUnitId as number);
        continue;
      }
      const after = parseJson(row.after_snapshot);
      if (!after) continue;
      const orgUnitId = after.orgUnitId as number;
      const isPrimary = Boolean(after.isPrimary);
      if (isPrimary) clearPrimary();
      belonged.set(orgUnitId, isPrimary);
    }

    return [...belonged.entries()].map(([orgUnitId, isPrimary]) => ({ orgUnitId, isPrimary }));
  }

  /**
   * Org units this person headed as of `asOf` — see the class header for the
   * anchor-on-current-and-walk-backward reasoning.
   */
  private async orgUnitsHeadedAsOf(userId: number, asOf: string): Promise<number[]> {
    const allUnits = await this.units.list();

    const [afterRows] = await this.pool.execute<
      Array<RowDataPacket & { entity_id: number; before_snapshot: string | Record<string, unknown> | null }>
    >(
      `SELECT al.entity_id, al.before_snapshot
         FROM audit_logs al
        INNER JOIN (
          SELECT entity_id, MIN(created_at) AS min_created
            FROM audit_logs
           WHERE action = 'org_unit.update' AND entity_type = 'org_unit' AND created_at > ?
           GROUP BY entity_id
        ) first_after
          ON first_after.entity_id = al.entity_id AND first_after.min_created = al.created_at
        WHERE al.action = 'org_unit.update' AND al.entity_type = 'org_unit'`,
      [asOf]
    );
    const managerAsOfByUnit = new Map<number, number | null>();
    for (const row of afterRows) {
      const before = parseJson(row.before_snapshot);
      if (!before) continue;
      managerAsOfByUnit.set(row.entity_id, (before.managerUserId as number | null) ?? null);
    }

    const headed: number[] = [];
    for (const unit of allUnits) {
      const managerAsOf = managerAsOfByUnit.has(unit.id)
        ? managerAsOfByUnit.get(unit.id)!
        : unit.managerUserId;
      if (managerAsOf === userId) headed.push(unit.id);
    }
    return headed;
  }

  async getSnapshot(userId: number, asOf: string): Promise<PersonHistorySnapshot> {
    const [rolesHeld, orgUnitsBelongedTo, orgUnitsHeaded] = await Promise.all([
      this.rolesHeldAsOf(userId, asOf),
      this.orgUnitsBelongedToAsOf(userId, asOf),
      this.orgUnitsHeadedAsOf(userId, asOf),
    ]);
    return { userId, asOf, rolesHeld, orgUnitsBelongedTo, orgUnitsHeaded };
  }
}
