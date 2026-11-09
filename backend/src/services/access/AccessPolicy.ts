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
 * belong to (`user_org_units`) is. A department attached to no org unit is
 * reachable only by unscoped callers, since no scoped authority covers it, and
 * so is a person who belongs to no unit. The one deliberate exception is the
 * `placeableUser` kind, which routes opt into only for creating and placing an
 * account: adding a person in no unit to the caller's own org unit or to a
 * department in their scope. Everything else a person can be the subject of —
 * preferences, contracts, skills, on-call, assignments, pairings, loans —
 * refuses an unassigned person to a scoped caller, because "in no unit" is
 * not "in mine". (Editing such an account goes through UserAuthorityService,
 * which applies the same opt-in under its permission-subset rule.)
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
  | 'orgUnit'
  | 'shiftSwap'
  | 'onCallPeriod'
  | 'shiftTemplate'
  | 'pairing'
  | 'changeRequest'
  | 'policyException'
  | 'placeableUser';

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


/**
 * The codes a unit scope can bound: every operation they admit touches a
 * unit-owned row or lists by scope — none reads or writes organization-wide
 * data, and none is a known unscoped gap. A delegation
 * scoped to a unit may carry only these (DelegationService) — a scoped
 * `role.manage` would still assign any role to anyone, because nothing about
 * role administration belongs to a unit.
 *
 * Not maintained by hand in isolation: the authorization matrix suite derives
 * this set from the declared table (codes of `unit`/`filtered` operations,
 * minus any code that also admits an `org`, `shared` or `gap` one, handler
 * checks included) and fails when it differs. Closing a gap is therefore what
 * can make a code delegable for one unit again.
 */
export const UNIT_SCOPED_PERMISSIONS: ReadonlySet<string> = new Set([
  'assignment.manage',
  'attendance.approve',
  'attendance.read',
  'loan.approve',
  'loan.request',
  'oncall.manage',
  'report.manage',
  'schedule.manage',
  'schedule.optimize',
  'schedule.publish',
  'schedule.read',
  'shift.manage',
  'shiftswap.approve',
  'timeline.read',
  'timeline.read_all',
  'timeoff.approve',
]);


interface Resolver {
  label: string;
  /** SQL over `ids` placeholders, selecting `id`, `unit`, `owner` and `party`. */
  sql: (ids: string) => string;
  /** How many times the id list appears in `sql` (a UNION repeats it). */
  repeat?: number;
  /**
   * The row spans several parties (`party`), and is reachable only when EVERY
   * party is: approving a swap rewrites both assignments, and a pairing binds
   * two people, so a manager of one side alone must not decide it.
   */
  all?: boolean;
  /**
   * A party in no org unit counts as reachable. Only for `placeableUser`: an
   * account a scoped manager has just created (`POST /users`, the imports)
   * belongs nowhere, and placing it in their own unit or department is how it
   * stops belonging nowhere. Any wider use would let "unassigned" stand in for
   * "mine" on every person write.
   */
  unassigned?: boolean;
}

const RESOLVERS: Record<ScopedKind, Resolver> = {
  department: { label: 'Department', sql: (ids) => `SELECT id, org_unit_id AS unit, NULL AS owner, NULL AS party FROM departments WHERE id IN (${ids})` },
  schedule: {
    label: 'Schedule',
    sql: (ids) => `SELECT s.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM schedules s
            LEFT JOIN departments d ON d.id = s.department_id WHERE s.id IN (${ids})`,
  },
  shift: {
    label: 'Shift',
    sql: (ids) => `SELECT s.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM shifts s
            LEFT JOIN departments d ON d.id = s.department_id WHERE s.id IN (${ids})`,
  },
  assignment: {
    label: 'Assignment',
    sql: (ids) => `SELECT sa.id, d.org_unit_id AS unit, sa.user_id AS owner, NULL AS party FROM shift_assignments sa
            JOIN shifts s ON s.id = sa.shift_id
            LEFT JOIN departments d ON d.id = s.department_id WHERE sa.id IN (${ids})`,
  },
  costPlan: {
    label: 'Cost plan',
    sql: (ids) => `SELECT c.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM cost_plans c
            LEFT JOIN departments d ON d.id = c.department_id WHERE c.id IN (${ids})`,
  },
  user: {
    label: 'User',
    sql: (ids) => `SELECT u.id, uou.org_unit_id AS unit, u.id AS owner, NULL AS party FROM users u
            LEFT JOIN user_org_units uou ON uou.user_id = u.id WHERE u.id IN (${ids})`,
  },
  placeableUser: {
    label: 'User',
    unassigned: true,
    sql: (ids) => `SELECT u.id, uou.org_unit_id AS unit, u.id AS owner, NULL AS party FROM users u
            LEFT JOIN user_org_units uou ON uou.user_id = u.id WHERE u.id IN (${ids})`,
  },
  timeOff: {
    label: 'Time-off request',
    sql: (ids) => `SELECT t.id, uou.org_unit_id AS unit, t.user_id AS owner, NULL AS party FROM time_off_requests t
            LEFT JOIN user_org_units uou ON uou.user_id = t.user_id WHERE t.id IN (${ids})`,
  },
  attendance: {
    label: 'Attendance record',
    sql: (ids) => `SELECT a.id, uou.org_unit_id AS unit, a.user_id AS owner, NULL AS party FROM attendance_records a
            LEFT JOIN user_org_units uou ON uou.user_id = a.user_id WHERE a.id IN (${ids})`,
  },
  // A loan is decided by the unit receiving the person — the same unit the
  // approval workflow resolves its approvers from (EmployeeLoanService).
  loan: { label: 'Loan', sql: (ids) => `SELECT id, to_org_unit_id AS unit, NULL AS owner, NULL AS party FROM employee_loans WHERE id IN (${ids})` },
  orgUnit: { label: 'Org unit', sql: (ids) => `SELECT id, id AS unit, NULL AS owner, NULL AS party FROM org_units WHERE id IN (${ids})` },
  shiftSwap: {
    label: 'Shift swap request',
    all: true,
    sql: (ids) => `SELECT r.id, d.org_unit_id AS unit, NULL AS owner, sa.id AS party FROM shift_swap_requests r
            JOIN shift_assignments sa ON sa.id IN (r.requester_assignment_id, r.target_assignment_id)
            JOIN shifts s ON s.id = sa.shift_id
            LEFT JOIN departments d ON d.id = s.department_id WHERE r.id IN (${ids})`,
  },
  onCallPeriod: {
    label: 'On-call period',
    sql: (ids) => `SELECT p.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM on_call_periods p
            LEFT JOIN departments d ON d.id = p.department_id WHERE p.id IN (${ids})`,
  },
  shiftTemplate: {
    label: 'Shift template',
    sql: (ids) => `SELECT t.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM shift_templates t
            LEFT JOIN departments d ON d.id = t.department_id WHERE t.id IN (${ids})`,
  },
  pairing: {
    label: 'Employee pairing',
    all: true,
    repeat: 2,
    sql: (ids) => `SELECT p.id, uou.org_unit_id AS unit, NULL AS owner, p.user_id AS party FROM employee_pairings p
            LEFT JOIN user_org_units uou ON uou.user_id = p.user_id WHERE p.id IN (${ids})
          UNION ALL
          SELECT p.id, uou.org_unit_id AS unit, NULL AS owner, p.other_user_id AS party FROM employee_pairings p
            LEFT JOIN user_org_units uou ON uou.user_id = p.other_user_id WHERE p.id IN (${ids})`,
  },
  // A change request is about its proposer's own situation — the same subject
  // the approval routing resolves (resolveSubjectContext).
  changeRequest: {
    label: 'Change request',
    sql: (ids) => `SELECT c.id, uou.org_unit_id AS unit, NULL AS owner, NULL AS party FROM change_requests c
            LEFT JOIN user_org_units uou ON uou.user_id = c.proposer_user_id WHERE c.id IN (${ids})`,
  },
  // An exception to a policy for a shift lives in that shift's unit; any other
  // target is judged by the requester's units.
  policyException: {
    label: 'Policy exception',
    repeat: 2,
    sql: (ids) => `SELECT r.id, d.org_unit_id AS unit, NULL AS owner, NULL AS party FROM policy_exception_requests r
            JOIN shifts s ON r.target_type IN ('shift_assignment', 'shift') AND s.id = r.target_id
            LEFT JOIN departments d ON d.id = s.department_id WHERE r.id IN (${ids})
          UNION ALL
          SELECT r.id, uou.org_unit_id AS unit, NULL AS owner, NULL AS party FROM policy_exception_requests r
            LEFT JOIN user_org_units uou ON uou.user_id = r.requested_by_user_id
           WHERE r.id IN (${ids}) AND r.target_type NOT IN ('shift_assignment', 'shift')`,
  },
};

/**
 * Ids per resolver query. MySQL refuses a statement with more than 65,535
 * placeholders, so an import of tens of thousands of rows resolved in one
 * `IN (...)` would fail as an internal error; this keeps every statement far
 * below that, at a handful of queries for any realistic file.
 */
export const RESOLVE_CHUNK = 1000;

interface ResolvedRow {
  /** Org units per party (one party, `''`, for single-party kinds). */
  parties: Map<string, Array<number | null>>;
  owner: number | null;
}

/** Whether a row of `kind` lies inside `scope`. */
const rowInScope = (kind: ScopedKind, scope: Scope, row: ResolvedRow): boolean => {
  if (scope === null) return true;
  const { all, unassigned } = RESOLVERS[kind];
  const partyIn = (units: Array<number | null>) =>
    (unassigned === true && units.every((u) => u === null)) || inScope(scope, units);
  const parties = [...row.parties.values()];
  return all ? parties.every(partyIn) : partyIn(parties.flat());
};

export class AccessPolicy {
  constructor(private readonly pool: Pool) {}

  /** The org units and owner of each existing row among `ids`, in chunked queries. */
  private async resolve(kind: ScopedKind, ids: number[]): Promise<Map<number, ResolvedRow>> {
    const distinct = [...new Set(ids)];
    const found = new Map<number, ResolvedRow>();
    const resolver = RESOLVERS[kind];
    for (let i = 0; i < distinct.length; i += RESOLVE_CHUNK) {
      const chunk = distinct.slice(i, i + RESOLVE_CHUNK);
      const params = Array.from({ length: resolver.repeat ?? 1 }, () => chunk).flat();
      const [rows] = await this.pool.execute<RowDataPacket[]>(resolver.sql(chunk.map(() => '?').join(', ')), params);
      for (const r of rows) {
        const id = r.id as number;
        const row = found.get(id) ?? { parties: new Map(), owner: (r.owner ?? null) as number | null };
        const party = String(r.party ?? '');
        row.parties.set(party, [...(row.parties.get(party) ?? []), (r.unit ?? null) as number | null]);
        found.set(id, row);
      }
    }
    return found;
  }


  /**
   * A per-id check for a batch whose rows succeed or fail one by one: the rows
   * are resolved up front in one query, and the returned function throws the
   * 404 for an id that is missing or out of scope, without a query of its own.
   * Unrestricted callers get a check that passes everything, at no cost.
   */
  async reachChecker(user: User, permissions: string | string[], kind: ScopedKind, ids: number[]): Promise<(id: number) => void> {
    const scopes = heldScopes(user, permissions);
    if (scopes.some((s) => s === null)) return () => undefined;
    const rows = await this.resolve(kind, ids);
    return (id: number) => {
      const row = rows.get(id);
      if (!row || !scopes.some((s) => rowInScope(kind, s, row))) throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
    };
  }

  /**
   * Refuses (404) any of `ids` of `kind` that is missing or outside the
   * caller's scope for one of `permissions`. Unrestricted callers pass without
   * a query; any number of ids costs one.
   */
  async assertReach(user: User, permissions: string | string[], kind: ScopedKind, ids: number | number[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const check = await this.reachChecker(user, permissions, kind, list);
    list.forEach(check);
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
    const row = (await this.resolve(kind, [id])).get(id);
    if (!row) throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
    if (assertOwnerOr(user, row.owner, permissions)) return;
    if (!scopes.some((s) => rowInScope(kind, s, row))) {
      throw new NotFoundError(`${RESOLVERS[kind].label} not found`);
    }
  }
}

/** The caller's scope for each of `permissions` they actually hold. */
const heldScopes = (user: User, permissions: string | string[]): Scope[] =>
  (Array.isArray(permissions) ? permissions : [permissions])
    .filter((c) => user.permissions?.includes(c))
    .map((c) => scopeFor(user, c));
