/**
 * AccessPolicy — the one place that decides whether a caller may reach a row.
 *
 * WHY THIS EXISTS. Authorization has three parts: does the caller hold the
 * permission, do they own the record, and does the record lie inside the org
 * units their authority covers. The first is `requirePermission`. The other two
 * used to be copy-pasted into route handlers — `schedules.ts` twice, `shifts.ts`
 * with a `(shift as any).orgUnitId` that no query ever selected — and wherever
 * nobody pasted them they were simply absent: every write to schedules, shifts,
 * assignments and employees, every approval and every id named in a request body
 * ignored the caller's scope (#813, #867). A rule that has to be remembered in
 * each handler is a rule that is missing from most of them, so it lives here and
 * routes declare it (see `middleware/accessScope.ts`) instead of implementing it.
 *
 * SCOPE IS PER PERMISSION. A role grant may carry an org unit and a delegation
 * may carry one too. `allowedOrgUnitIds` is the scope of the caller's roles;
 * `delegationScopes` overrides it for the codes that scoped delegations grant
 * (computed in `RbacService.getEffectiveDelegationScopes`). Asking "what may
 * this caller reach WITH THIS PERMISSION" is therefore the only correct
 * question: a delegatee holding `schedule.manage` for ward A through a
 * delegation, and nothing through their roles, must not manage ward B's
 * schedules just because their roles carry no scope (#814).
 *
 * WHY OUT-OF-SCOPE IS 404, NOT 403. A 403 for "exists but not yours" and a 404
 * for "does not exist" let a scoped caller enumerate every id in the
 * organization and learn which ones are real, and which unit owns them, by
 * probing. Answering both with the same 404 discloses nothing a caller could
 * not see anyway. 403 stays for what the caller can already know about
 * themselves: lacking the permission, or acting on someone else's record
 * without the authority to. The same 404 applies to ids named in a request
 * body (`shiftId`, `userId`, `departmentId`): referencing another unit's row is
 * how records would be moved into, or created inside, a unit the caller does
 * not govern, and it must look exactly like referencing a missing one.
 *
 * WHY UNSCOPED CALLERS COST NOTHING. When the caller's scope for a permission
 * is unrestricted the check returns before any query, so the common case — an
 * Administrator or an organization-wide manager — runs exactly the SQL it ran
 * before this policy existed, and a missing row is reported by the service
 * that would have reported it anyway.
 *
 * Departments and org units are two hierarchies (scheduling and authority)
 * bridged by `departments.org_unit_id`: a department-owned row is in scope when
 * its department's org unit is; a person is in scope when any org unit they
 * belong to (`user_org_units`) is. A row whose unit is NULL — a department
 * attached to no org unit, a person belonging to none — is reachable only by
 * unscoped callers, since no scoped authority covers it.
 *
 * Rejected: passing the actor into every service method. It would put the same
 * check into a hundred signatures, and the services are also called by seeding,
 * workers and the optimizer, which have no actor — an optional actor is an
 * authorization check that is silently skipped whenever it is omitted.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ForbiddenError, NotFoundError } from '../../errors';
import { User } from '../../types';

/** Org units a caller may reach; `null` means unrestricted. */
export type Scope = number[] | null;

/** The kinds of row whose org unit the policy knows how to resolve. */
export type ScopedKind =
  | 'schedule'
  | 'shift'
  | 'department'
  | 'user'
  | 'assignment'
  | 'timeOff'
  | 'attendance'
  | 'loan'
  | 'costPlan'
  | 'orgUnit';

/**
 * The caller's scope for one permission: the delegation override for that code
 * when there is one, otherwise the scope of their roles.
 */
export const scopeFor = (user: User, permission: string): Scope => {
  const override = user.delegationScopes?.find((s) => s.permissionCode === permission);
  if (override) return override.allowedOrgUnitIds;
  return user.allowedOrgUnitIds ?? null;
};

/**
 * The `orgUnitIds` value a list query must apply, or `undefined` when the
 * caller is unrestricted. An empty array is meaningful — a scope that resolves
 * to nothing — and services must match no rows for it, never all of them.
 */
export const scopeFilter = (user: User, permissions: string | string[]): number[] | undefined => {
  // Several codes (e.g. attendance.read OR attendance.approve) widen the view
  // to the union of the scopes of those the caller actually holds.
  const codes = Array.isArray(permissions) ? permissions.filter((c) => user.permissions?.includes(c)) : [permissions];
  const scopes = codes.map((c) => scopeFor(user, c));
  if (scopes.length === 0) return [];
  if (scopes.some((s) => s === null)) return undefined;
  return [...new Set((scopes as number[][]).flat())];
};

/** True when any of `units` lies inside `scope` (NULL units are in no scope). */
export const inScope = (scope: Scope, units: Array<number | null>): boolean =>
  scope === null || units.some((u) => u !== null && scope.includes(u));

/**
 * Refuses a row outside the caller's scope for `permission` with the same 404
 * a missing row gets — see the header for why not 403.
 */
export const assertInScope = (
  user: User,
  permission: string,
  units: number | null | Array<number | null>,
  label = 'Record'
): void => {
  const list = Array.isArray(units) ? units : [units];
  if (!inScope(scopeFor(user, permission), list)) throw new NotFoundError(`${label} not found`);
};

/**
 * Owner-or-permission: returns true when the caller owns the record, false when
 * they do not but hold one of `permissions` (the caller then still applies the
 * scope check), and throws 403 when neither — the caller knows whose record it
 * is not, so refusing it discloses nothing.
 */
export const assertOwnerOr = (user: User, ownerId: number | null, permissions: string | string[]): boolean => {
  if (ownerId !== null && ownerId === user.id) return true;
  const codes = Array.isArray(permissions) ? permissions : [permissions];
  if (!codes.some((c) => user.permissions?.includes(c))) throw new ForbiddenError();
  return false;
};

/**
 * SQL for "`column` lies in these org units", or `null` when there is no
 * restriction. `[]` yields a condition no row satisfies.
 */
export const unitCondition = (column: string, orgUnitIds: number[] | undefined): { sql: string; params: number[] } | null => {
  if (orgUnitIds === undefined) return null;
  if (orgUnitIds.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${orgUnitIds.map(() => '?').join(', ')})`, params: [...orgUnitIds] };
};

/** SQL for "the person in `userColumn` belongs to one of these org units". */
export const memberCondition = (userColumn: string, orgUnitIds: number[] | undefined): { sql: string; params: number[] } | null => {
  const units = unitCondition('org_unit_id', orgUnitIds);
  if (!units) return null;
  return { sql: `${userColumn} IN (SELECT user_id FROM user_org_units WHERE ${units.sql})`, params: units.params };
};

/** One query per kind; each yields `unit` rows (and `owner` where ownership applies). */
const RESOLVERS: Record<ScopedKind, { label: string; sql: string }> = {
  department: { label: 'Department', sql: 'SELECT org_unit_id AS unit, NULL AS owner FROM departments WHERE id = ?' },
  schedule: {
    label: 'Schedule',
    sql: `SELECT d.org_unit_id AS unit, NULL AS owner FROM schedules s
            LEFT JOIN departments d ON d.id = s.department_id WHERE s.id = ?`,
  },
  shift: {
    label: 'Shift',
    sql: `SELECT d.org_unit_id AS unit, NULL AS owner FROM shifts s
            LEFT JOIN departments d ON d.id = s.department_id WHERE s.id = ?`,
  },
  assignment: {
    label: 'Assignment',
    sql: `SELECT d.org_unit_id AS unit, sa.user_id AS owner FROM shift_assignments sa
            JOIN shifts s ON s.id = sa.shift_id
            LEFT JOIN departments d ON d.id = s.department_id WHERE sa.id = ?`,
  },
  costPlan: {
    label: 'Cost plan',
    sql: `SELECT d.org_unit_id AS unit, NULL AS owner FROM cost_plans c
            LEFT JOIN departments d ON d.id = c.department_id WHERE c.id = ?`,
  },
  user: {
    label: 'User',
    sql: `SELECT uou.org_unit_id AS unit, u.id AS owner FROM users u
            LEFT JOIN user_org_units uou ON uou.user_id = u.id WHERE u.id = ?`,
  },
  timeOff: {
    label: 'Time-off request',
    sql: `SELECT uou.org_unit_id AS unit, t.user_id AS owner FROM time_off_requests t
            LEFT JOIN user_org_units uou ON uou.user_id = t.user_id WHERE t.id = ?`,
  },
  attendance: {
    label: 'Attendance record',
    sql: `SELECT uou.org_unit_id AS unit, a.user_id AS owner FROM attendance_records a
            LEFT JOIN user_org_units uou ON uou.user_id = a.user_id WHERE a.id = ?`,
  },
  // A loan is decided by the unit receiving the person — the same unit the
  // approval workflow resolves its approvers from (EmployeeLoanService).
  loan: { label: 'Loan', sql: 'SELECT to_org_unit_id AS unit, NULL AS owner FROM employee_loans WHERE id = ?' },
  orgUnit: { label: 'Org unit', sql: 'SELECT id AS unit, NULL AS owner FROM org_units WHERE id = ?' },
};

export class AccessPolicy {
  constructor(private readonly pool: Pool) {}

  /** The row's org units and owner, or `null` when it does not exist. */
  private async resolve(kind: ScopedKind, id: number): Promise<{ units: Array<number | null>; owner: number | null } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(RESOLVERS[kind].sql, [id]);
    if (rows.length === 0) return null;
    return {
      units: rows.map((r) => (r.unit ?? null) as number | null),
      owner: (rows[0].owner ?? null) as number | null,
    };
  }

  /**
   * Refuses (404) a row of `kind` that is missing or outside the caller's scope
   * for any of `permissions`. Unrestricted callers pass without a query.
   */
  async assertReach(user: User, permissions: string | string[], kind: ScopedKind, id: number): Promise<void> {
    const scopes = heldScopes(user, permissions);
    if (scopes.some((s) => s === null)) return;
    const row = await this.resolve(kind, id);
    if (!row || !scopes.some((s) => inScope(s, row.units))) throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
  }

  /**
   * Owner-or-permission for a row of `kind`: its owner passes; anyone else needs
   * one of `permissions` (403 otherwise) and the row inside that scope (404).
   * A caller holding one of them unrestricted passes without a query, as in
   * `assertReach`: ownership could only admit them further.
   */
  async assertOwnerOrReach(user: User, permissions: string | string[], kind: ScopedKind, id: number): Promise<void> {
    const scopes = heldScopes(user, permissions);
    if (scopes.some((s) => s === null)) return;
    const row = await this.resolve(kind, id);
    if (!row) throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
    if (assertOwnerOr(user, row.owner, permissions)) return;
    if (!scopes.some((s) => inScope(s, row.units))) {
      throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
    }
  }
}

/** The caller's scope for each of `permissions` they actually hold. */
const heldScopes = (user: User, permissions: string | string[]): Scope[] =>
  (Array.isArray(permissions) ? permissions : [permissions])
    .filter((c) => user.permissions?.includes(c))
    .map((c) => scopeFor(user, c));
