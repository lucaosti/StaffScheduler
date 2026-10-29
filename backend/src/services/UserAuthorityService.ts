/**
 * UserAuthorityService — who may write which account, and grant which role.
 *
 * WHY ONE SERVICE, CALLED FROM EVERY WRITE PATH. Accounts and role grants are
 * written by five surfaces: `/users`, `/employees` (single and batch), the CSV
 * import and the vCard import. The anti-escalation rule used to live inside
 * `routes/users.ts` only, so the other four were open doors: a Manager holding
 * `employee.manage` could `PUT /employees/<self> {"roleIds":[<Administrator>]}`
 * or import a CSV row with role `Administrator` (#809). A rule that guards one
 * door of five is not a rule, so it now lives here and each surface calls it.
 *
 * WHY THE TARGET'S PERMISSIONS, NOT ONLY THE ROLES BEING GRANTED. `user.manage`
 * on its own let a Manager reset an Administrator's password and log in as
 * them, or strip their roles with `roleIds: []` (#810). Writing an account is
 * authority over everything that account can do, so an actor may only write
 * accounts whose effective permissions are a subset of their own. The same
 * subset test is what already decided which roles may be granted, so one
 * principle covers both: you cannot reach, directly or through another
 * account, a permission you do not hold.
 *
 * WHY `role.manage` IS THE EXCEPTION. It is the explicit authority to assign
 * any role, held by Administrators. Without the bypass an Administrator could
 * not manage another Administrator, nor grant a role carrying a permission
 * they lack (e.g. a custom role with a newly added code).
 *
 * WHY ORG-UNIT SCOPE APPLIES TO TARGETS AND GRANTS. A scoped actor reaching an
 * account outside their subtree is the cross-unit access scoping exists to
 * prevent; a target belonging to no unit is reachable only by unscoped actors.
 * Grants made here are always organization-wide (`scope_org_unit_id NULL`), so
 * a scoped actor granting any role would hand out authority wider than their
 * own — e.g. create an org-wide Manager with a password they chose and log in
 * as it. Scoped actors therefore create accounts without roles and leave role
 * assignment to role administration.
 *
 * NOT DECIDED HERE: whether a target's own scope is wider than the actor's, and
 * who may change org-unit membership. Scope is unenforced across most of the
 * API today; it is fixed as one rule in #813/#814 rather than piecemeal here.
 *
 * Rejected: putting the check inside `UserService.createUser/updateUser`. Those
 * are also called by seeding and SSO provisioning, which have no actor, so the
 * methods would need an optional actor — and an optional authorization check
 * is exactly the kind that gets silently skipped.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { RbacService } from './RbacService';
import { ForbiddenError, ValidationError } from '../errors';
import { User } from '../types';

export class UserAuthorityService {
  private readonly rbac: RbacService;

  constructor(private readonly pool: Pool) {
    this.rbac = new RbacService(pool);
  }

  /**
   * Refuses granting a role whose permissions the actor does not hold, and any
   * change to the actor's own roles. `targetUserId` is omitted when creating.
   * Absent `roleIds` means "roles unchanged"; an empty list is a change.
   */
  async assertCanAssignRoles(actor: User, roleIds: number[] | undefined, targetUserId?: number): Promise<void> {
    if (roleIds === undefined) return;
    if (targetUserId === actor.id) throw new ForbiddenError('You cannot change your own roles');
    const held = new Set(actor.permissions ?? []);
    if (held.has('role.manage')) return;
    if (roleIds.length > 0 && actor.allowedOrgUnitIds !== null && actor.allowedOrgUnitIds !== undefined) {
      throw new ForbiddenError('An account scoped to part of the organization cannot grant organization-wide roles');
    }
    for (const roleId of roleIds) {
      const role = await this.rbac.getRoleById(roleId);
      if (!role) throw new ForbiddenError(`Role ${roleId} not found`);
      if ((role.permissions ?? []).some((code) => !held.has(code))) {
        throw new ForbiddenError('You cannot assign a role with permissions you do not hold');
      }
    }
  }

  /**
   * The same rule for imports, which name roles instead of referencing ids.
   * Unknown names are left to the importer, which reports or ignores them;
   * they grant nothing, so they cannot escalate.
   */
  async assertCanAssignRoleNames(actor: User, roleNames: string[]): Promise<void> {
    if ((actor.permissions ?? []).includes('role.manage')) return;
    const ids: number[] = [];
    for (const name of new Set(roleNames)) {
      const id = await this.rbac.getRoleIdByName(name);
      if (id !== null) ids.push(id);
    }
    await this.assertCanAssignRoles(actor, ids);
  }

  /**
   * Refuses writing (updating, deactivating, deleting) another account that
   * holds a permission the actor does not, or that lies outside the actor's
   * org-unit scope. Writing one's own account is otherwise decided by the
   * caller's self-service rules — except deactivating it, which is refused for
   * everyone: it would lock the actor out, possibly the last Administrator.
   */
  async assertCanManageUser(actor: User, targetUserId: number, change: { deactivate?: boolean } = {}): Promise<void> {
    if (targetUserId === actor.id) {
      if (change.deactivate) throw new ValidationError('You cannot deactivate your own account');
      return;
    }
    const held = new Set(actor.permissions ?? []);
    if (held.has('role.manage')) return;

    const targetPermissions = await this.rbac.getEffectivePermissions(targetUserId);
    if (targetPermissions.some((code) => !held.has(code))) {
      throw new ForbiddenError('You cannot modify an account with permissions you do not hold');
    }

    const scope = actor.allowedOrgUnitIds;
    if (scope === null || scope === undefined) return;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT org_unit_id FROM user_org_units WHERE user_id = ?',
      [targetUserId]
    );
    const allowed = new Set(scope);
    if (!rows.some((r) => allowed.has(r.org_unit_id as number))) {
      throw new ForbiddenError('This account is outside your organizational scope');
    }
  }
}
