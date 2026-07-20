/**
 * RbacService extended unit tests.
 *
 * Covers every public method with happy paths, edge cases, and error paths.
 */

import { RbacService } from '../services/RbacService';
import { UserRoleAssignment } from '../types';

// ---------------------------------------------------------------------------
// Pool / connection mock factory
// ---------------------------------------------------------------------------

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

// Convenience row builders
const permRow = (code: string) => ({ code });
const roleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Manager',
  description: 'A manager role',
  is_system: 0,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  perm_codes: 'schedule.read,employee.read',
  ...overrides,
});

// ---------------------------------------------------------------------------
// getEffectivePermissions
// ---------------------------------------------------------------------------

describe('RbacService.getEffectivePermissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns role-based and delegation permissions merged', async () => {
    const { pool, execute } = makePool();
    execute
      // 1st call: delegatee role permissions
      .mockResolvedValueOnce([[permRow('schedule.read'), permRow('employee.read')], null])
      // 2nd call: active delegations (includes delegator_id)
      .mockResolvedValueOnce([[{ delegator_id: 5, permission_codes: JSON.stringify(['timeoff.approve']) }], null])
      // 3rd call: batch query for all delegators' current role permissions (cap check)
      .mockResolvedValueOnce([[{ user_id: 5, code: 'timeoff.approve' }], null]);

    const svc = new RbacService(pool);
    const perms = await svc.getEffectivePermissions(1);

    expect(perms).toContain('schedule.read');
    expect(perms).toContain('employee.read');
    expect(perms).toContain('timeoff.approve');
  });

  it('de-duplicates codes present in both roles and delegations', async () => {
    const { pool, execute } = makePool();
    execute
      // 1st call: delegatee role permissions
      .mockResolvedValueOnce([[permRow('schedule.read')], null])
      // 2nd call: active delegations
      .mockResolvedValueOnce([[{ delegator_id: 5, permission_codes: JSON.stringify(['schedule.read']) }], null])
      // 3rd call: batch query for all delegators' current role permissions (cap check)
      .mockResolvedValueOnce([[{ user_id: 5, code: 'schedule.read' }], null]);

    const svc = new RbacService(pool);
    const perms = await svc.getEffectivePermissions(1);

    expect(perms.filter((c) => c === 'schedule.read')).toHaveLength(1);
  });

  it('returns empty array when user has no roles and no delegations', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    const perms = await svc.getEffectivePermissions(99);

    expect(perms).toEqual([]);
  });

  it('excludes expired role grants (query filters them; mock returns empty)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null]) // expired roles filtered by DB
      .mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    const perms = await svc.getEffectivePermissions(5);

    expect(perms).toEqual([]);
  });

  it('handles multiple delegation rows each with multiple codes', async () => {
    const { pool, execute } = makePool();
    execute
      // 1st call: delegatee role permissions
      .mockResolvedValueOnce([[permRow('schedule.read')], null])
      // 2nd call: active delegations (two rows, each with their own delegator_id)
      .mockResolvedValueOnce([
        [
          { delegator_id: 10, permission_codes: JSON.stringify(['timeoff.approve', 'employee.read']) },
          { delegator_id: 11, permission_codes: JSON.stringify(['shift.create']) },
        ],
        null,
      ])
      // 3rd call: single batch query for all delegators' current role permissions
      .mockResolvedValueOnce([
        [
          { user_id: 10, code: 'timeoff.approve' },
          { user_id: 10, code: 'employee.read' },
          { user_id: 11, code: 'shift.create' },
        ],
        null,
      ]);

    const svc = new RbacService(pool);
    const perms = await svc.getEffectivePermissions(3);

    expect(perms).toContain('schedule.read');
    expect(perms).toContain('timeoff.approve');
    expect(perms).toContain('employee.read');
    expect(perms).toContain('shift.create');
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('DB connection lost'));

    const svc = new RbacService(pool);
    await expect(svc.getEffectivePermissions(1)).rejects.toThrow('DB connection lost');
  });
});

// ---------------------------------------------------------------------------
// getUserRoles
// ---------------------------------------------------------------------------

describe('RbacService.getUserRoles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns mapped role assignments', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { role_id: 2, role_name: 'Admin', scope_org_unit_id: null, expires_at: null },
        { role_id: 3, role_name: 'Viewer', scope_org_unit_id: 10, expires_at: null },
      ],
      null,
    ]);

    const svc = new RbacService(pool);
    const roles = await svc.getUserRoles(1);

    expect(roles).toHaveLength(2);
    expect(roles[0]).toEqual({ roleId: 2, roleName: 'Admin', scopeOrgUnitId: null, expiresAt: null });
    expect(roles[1]).toEqual({ roleId: 3, roleName: 'Viewer', scopeOrgUnitId: 10, expiresAt: null });
  });

  it('returns empty array when user has no active roles', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    const roles = await svc.getUserRoles(99);

    expect(roles).toEqual([]);
  });

  it('maps scope_org_unit_id null to null (not undefined)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ role_id: 1, role_name: 'Manager', scope_org_unit_id: null, expires_at: null }],
      null,
    ]);

    const svc = new RbacService(pool);
    const [role] = await svc.getUserRoles(5);

    expect(role.scopeOrgUnitId).toBeNull();
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('query failed'));

    const svc = new RbacService(pool);
    await expect(svc.getUserRoles(1)).rejects.toThrow('query failed');
  });
});

// ---------------------------------------------------------------------------
// userHasPermission
// ---------------------------------------------------------------------------

describe('RbacService.userHasPermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when the user holds the code', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[permRow('schedule.manage')], null])
      .mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.userHasPermission(1, 'schedule.manage')).toBe(true);
  });

  it('returns false when the user does not hold the code', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[permRow('employee.read')], null])
      .mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.userHasPermission(1, 'settings.manage')).toBe(false);
  });

  it('returns false for a user with no permissions', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.userHasPermission(99, 'any.code')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listPermissions
// ---------------------------------------------------------------------------

describe('RbacService.listPermissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns mapped permission objects', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { id: 1, code: 'schedule.read', resource: 'schedule', action: 'read', description: 'Read schedules' },
        { id: 2, code: 'employee.read', resource: 'employee', action: 'read', description: null },
      ],
      null,
    ]);

    const svc = new RbacService(pool);
    const perms = await svc.listPermissions();

    expect(perms).toHaveLength(2);
    expect(perms[0]).toMatchObject({ id: 1, code: 'schedule.read', resource: 'schedule', action: 'read', description: 'Read schedules' });
    expect(perms[1].description).toBeUndefined(); // null → undefined
  });

  it('returns empty array when no permissions exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.listPermissions()).toEqual([]);
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('DB error'));

    const svc = new RbacService(pool);
    await expect(svc.listPermissions()).rejects.toThrow('DB error');
  });
});

// ---------------------------------------------------------------------------
// listRoles
// ---------------------------------------------------------------------------

describe('RbacService.listRoles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns mapped roles with permissions split from comma-separated string', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [roleRow()],
      null,
    ]);

    const svc = new RbacService(pool);
    const roles = await svc.listRoles();

    expect(roles).toHaveLength(1);
    expect(roles[0].permissions).toEqual(['schedule.read', 'employee.read']);
    expect(roles[0].isSystem).toBe(false);
  });

  it('returns empty permissions array when perm_codes is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[roleRow({ perm_codes: null })], null]);

    const svc = new RbacService(pool);
    const [role] = await svc.listRoles();

    expect(role.permissions).toEqual([]);
  });

  it('returns empty array when no roles exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.listRoles()).toEqual([]);
  });

  it('maps is_system=1 to isSystem=true', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[roleRow({ is_system: 1 })], null]);

    const svc = new RbacService(pool);
    const [role] = await svc.listRoles();

    expect(role.isSystem).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getRoleById
// ---------------------------------------------------------------------------

describe('RbacService.getRoleById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the role when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[roleRow({ id: 5, name: 'Admin' })], null]);

    const svc = new RbacService(pool);
    const role = await svc.getRoleById(5);

    expect(role).not.toBeNull();
    expect(role?.id).toBe(5);
    expect(role?.name).toBe('Admin');
  });

  it('returns null when role is not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    expect(await svc.getRoleById(999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createRole
// ---------------------------------------------------------------------------

describe('RbacService.createRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a role with permissions and returns it', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])                    // dup-name check
      .mockResolvedValueOnce([{ insertId: 10 }, null])     // INSERT role
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // DELETE old perms
      .mockResolvedValueOnce([{ affectedRows: 2 }, null]); // INSERT perms
    // getRoleById call after commit uses pool.execute
    execute.mockResolvedValueOnce([[roleRow({ id: 10, name: 'NewRole', perm_codes: 'schedule.read' })], null]);

    const svc = new RbacService(pool);
    const role = await svc.createRole({ name: 'NewRole', permissionCodes: ['schedule.read'] });

    expect(role.id).toBe(10);
    expect(role.name).toBe('NewRole');
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('creates a role with no permissions (permissionCodes omitted)', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])                   // dup-name check
      .mockResolvedValueOnce([{ insertId: 11 }, null])    // INSERT role
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // DELETE old perms (no perms to insert)
    execute.mockResolvedValueOnce([[roleRow({ id: 11, name: 'Empty', perm_codes: null })], null]);

    const svc = new RbacService(pool);
    const role = await svc.createRole({ name: 'Empty' });

    expect(role.permissions).toEqual([]);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('throws and rolls back when role name already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1 }], null]); // dup-name check finds one

    const svc = new RbacService(pool);
    await expect(svc.createRole({ name: 'Existing' })).rejects.toThrow('Role name already exists');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('rolls back when DB INSERT fails', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])                  // dup-name check passes
      .mockRejectedValueOnce(new Error('insert failed')); // INSERT throws

    const svc = new RbacService(pool);
    await expect(svc.createRole({ name: 'AnyRole' })).rejects.toThrow('insert failed');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateRole
// ---------------------------------------------------------------------------

describe('RbacService.updateRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates name and description then returns the role', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE roles
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // DELETE old perms
      .mockResolvedValueOnce([{ affectedRows: 2 }, null]); // INSERT perms
    execute.mockResolvedValueOnce([[roleRow({ id: 2, name: 'Updated' })], null]);

    const svc = new RbacService(pool);
    const role = await svc.updateRole(2, { name: 'Updated', description: 'desc', permissionCodes: ['schedule.read'] });

    expect(role.name).toBe('Updated');
    expect(conn.commit).toHaveBeenCalled();
  });

  it('updates only permissions when name/description omitted', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])  // DELETE old perms
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT perms
    execute.mockResolvedValueOnce([[roleRow({ id: 3 })], null]);

    const svc = new RbacService(pool);
    const role = await svc.updateRole(3, { permissionCodes: ['employee.read'] });

    expect(role).not.toBeNull();
    expect(conn.commit).toHaveBeenCalled();
  });

  it('makes no SQL SET clause when no fields provided and no permissionCodes', async () => {
    const { pool, execute, conn } = makePool();
    // No conn.execute calls expected for UPDATE or perms
    execute.mockResolvedValueOnce([[roleRow({ id: 4 })], null]);

    const svc = new RbacService(pool);
    const role = await svc.updateRole(4, {});

    expect(role.id).toBe(4);
    expect(conn.commit).toHaveBeenCalled();
    // conn.execute not called for UPDATE since updates array is empty and permissionCodes is undefined
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it('throws Role not found when getRoleById returns null after update', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute.mockResolvedValueOnce([[], null]); // getRoleById returns nothing

    const svc = new RbacService(pool);
    await expect(svc.updateRole(999, { name: 'Ghost' })).rejects.toThrow('Role not found');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls back on DB error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('update failed'));

    const svc = new RbacService(pool);
    await expect(svc.updateRole(1, { name: 'X' })).rejects.toThrow('update failed');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteRole
// ---------------------------------------------------------------------------

describe('RbacService.deleteRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes a non-system role', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[roleRow({ id: 5, is_system: 0 })], null]) // getRoleById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);               // DELETE

    const svc = new RbacService(pool);
    await expect(svc.deleteRole(5)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM roles'), [5]);
  });

  it('throws when role does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // getRoleById returns null

    const svc = new RbacService(pool);
    await expect(svc.deleteRole(999)).rejects.toThrow('Role not found');
  });

  it('throws when attempting to delete a system role', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[roleRow({ id: 1, is_system: 1 })], null]);

    const svc = new RbacService(pool);
    await expect(svc.deleteRole(1)).rejects.toThrow('System roles cannot be deleted');
  });
});

// ---------------------------------------------------------------------------
// setUserRoles
// ---------------------------------------------------------------------------

describe('RbacService.setUserRoles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes existing unscoped roles then inserts the new ones', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 2 }, null])  // DELETE
      .mockResolvedValueOnce([{ affectedRows: 2 }, null]); // batch INSERT IGNORE

    const svc = new RbacService(pool);
    await expect(svc.setUserRoles(7, [10, 11])).resolves.toBeUndefined();
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('only deletes when roleIds is empty', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 3 }, null]); // DELETE only

    const svc = new RbacService(pool);
    await svc.setUserRoles(7, []);

    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back on DB error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('lock timeout'));

    const svc = new RbacService(pool);
    await expect(svc.setUserRoles(1, [5])).rejects.toThrow('lock timeout');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assignRole
// ---------------------------------------------------------------------------

describe('RbacService.assignRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts the role grant with upsert semantics', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // INSERT ... ON DUPLICATE KEY
      .mockResolvedValueOnce([{ insertId: 1 }, null]);    // audit write

    const svc = new RbacService(pool);
    await expect(svc.assignRole(1, 2, null, null)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_roles'),
      [1, 2, null, null]
    );
  });

  it('accepts org-unit scope and expiry', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ insertId: 2 }, null]);

    const svc = new RbacService(pool);
    const expiry = '2027-01-01T00:00:00Z';
    await svc.assignRole(3, 5, 10, expiry);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_roles'),
      [3, 5, 10, expiry]
    );
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('constraint violation'));

    const svc = new RbacService(pool);
    await expect(svc.assignRole(1, 2)).rejects.toThrow('constraint violation');
  });
});

// ---------------------------------------------------------------------------
// removeRole
// ---------------------------------------------------------------------------

describe('RbacService.removeRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes using IS NULL when scopeOrgUnitId is null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // DELETE
      .mockResolvedValueOnce([{ insertId: 1 }, null]);    // audit

    const svc = new RbacService(pool);
    await svc.removeRole(1, 2, null);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('scope_org_unit_id IS NULL'),
      [1, 2]
    );
  });

  it('deletes using = ? when scopeOrgUnitId is provided', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ insertId: 2 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(1, 2, 7);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('scope_org_unit_id = ?'),
      [1, 2, 7]
    );
  });

  it('defaults scopeOrgUnitId to null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ insertId: 3 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(5, 3); // no third arg

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('scope_org_unit_id IS NULL'),
      [5, 3]
    );
  });
});

// ---------------------------------------------------------------------------
// getDescendantOrgUnitIds
// ---------------------------------------------------------------------------

describe('RbacService.getDescendantOrgUnitIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns flat list of ids from CTE query', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ id: 10 }, { id: 11 }, { id: 12 }],
      null,
    ]);

    const svc = new RbacService(pool);
    const ids = await svc.getDescendantOrgUnitIds(10);

    expect(ids).toEqual([10, 11, 12]);
  });

  it('returns only the root when there are no children', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 5 }], null]);

    const svc = new RbacService(pool);
    const ids = await svc.getDescendantOrgUnitIds(5);

    expect(ids).toEqual([5]);
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('recursive CTE failed'));

    const svc = new RbacService(pool);
    await expect(svc.getDescendantOrgUnitIds(1)).rejects.toThrow('recursive CTE failed');
  });
});

// ---------------------------------------------------------------------------
// computeAllowedOrgUnitIds
// ---------------------------------------------------------------------------

describe('RbacService.computeAllowedOrgUnitIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when all roles are global (no scope)', async () => {
    const { pool } = makePool();
    const roles: UserRoleAssignment[] = [
      { roleId: 1, roleName: 'Admin', scopeOrgUnitId: null, expiresAt: null },
    ];

    const svc = new RbacService(pool);
    const result = await svc.computeAllowedOrgUnitIds(roles);

    expect(result).toBeNull();
  });

  it('returns null when roles array is empty', async () => {
    const { pool } = makePool();
    const svc = new RbacService(pool);
    const result = await svc.computeAllowedOrgUnitIds([]);

    expect(result).toBeNull();
  });

  it('returns de-duplicated subtree ids when at least one scoped role exists', async () => {
    const { pool, execute } = makePool();
    // Two scoped roles: org 10 (subtree: 10, 11) and org 20 (subtree: 20)
    execute
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], null])
      .mockResolvedValueOnce([[{ id: 20 }], null]);

    const roles: UserRoleAssignment[] = [
      { roleId: 1, roleName: 'Manager', scopeOrgUnitId: 10, expiresAt: null },
      { roleId: 2, roleName: 'Viewer', scopeOrgUnitId: 20, expiresAt: null },
    ];

    const svc = new RbacService(pool);
    const result = await svc.computeAllowedOrgUnitIds(roles);

    expect(result).not.toBeNull();
    expect(result).toEqual(expect.arrayContaining([10, 11, 20]));
    expect(result).toHaveLength(3);
  });

  it('de-duplicates overlapping subtrees', async () => {
    const { pool, execute } = makePool();
    // Two scoped roles both rooted at the same org unit
    execute
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], null])
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }], null]);

    const roles: UserRoleAssignment[] = [
      { roleId: 1, roleName: 'A', scopeOrgUnitId: 10, expiresAt: null },
      { roleId: 2, roleName: 'B', scopeOrgUnitId: 10, expiresAt: null },
    ];

    const svc = new RbacService(pool);
    const result = await svc.computeAllowedOrgUnitIds(roles);

    expect(result).toEqual([10, 11]); // no duplicates
  });

  it('skips roles with undefined scopeOrgUnitId, counting only non-null/non-undefined scopes', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 5 }], null]);

    const roles: UserRoleAssignment[] = [
      { roleId: 1, roleName: 'Global', scopeOrgUnitId: undefined, expiresAt: null },
      { roleId: 2, roleName: 'Scoped', scopeOrgUnitId: 5, expiresAt: null },
    ];

    const svc = new RbacService(pool);
    const result = await svc.computeAllowedOrgUnitIds(roles);

    expect(result).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// getRoleIdByName
// ---------------------------------------------------------------------------

describe('RbacService.getRoleIdByName', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the id when the role exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 7 }], null]);

    const svc = new RbacService(pool);
    const id = await svc.getRoleIdByName('Admin');

    expect(id).toBe(7);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM roles WHERE name = ?'),
      ['Admin']
    );
  });

  it('returns null when no role matches the name', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    const id = await svc.getRoleIdByName('NonExistent');

    expect(id).toBeNull();
  });

  it('propagates DB errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('timeout'));

    const svc = new RbacService(pool);
    await expect(svc.getRoleIdByName('Admin')).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// getEffectiveDelegationScopes
// ---------------------------------------------------------------------------

describe('RbacService.getEffectiveDelegationScopes', () => {
  it('returns empty array when user has no scoped delegations', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // delegations query → none

    const svc = new RbacService(pool);
    const scopes = await svc.getEffectiveDelegationScopes(10);
    expect(scopes).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('resolves org-unit subtree for each scoped delegation', async () => {
    const { pool, execute } = makePool();
    execute
      // Delegations query — one row with scope_org_unit_id = 5
      .mockResolvedValueOnce([
        [{ permission_codes: JSON.stringify(['schedule.manage', 'timeoff.approve']), scope_org_unit_id: 5 }],
        null,
      ])
      // getDescendantOrgUnitIds(5) — CTE returns [5, 10, 11]
      .mockResolvedValueOnce([[{ id: 5 }, { id: 10 }, { id: 11 }], null]);

    const svc = new RbacService(pool);
    const scopes = await svc.getEffectiveDelegationScopes(10);

    expect(scopes).toHaveLength(2);
    const scheduleScope = scopes.find((s) => s.permissionCode === 'schedule.manage')!;
    expect(scheduleScope.allowedOrgUnitIds).toEqual(expect.arrayContaining([5, 10, 11]));
    const timeoffScope = scopes.find((s) => s.permissionCode === 'timeoff.approve')!;
    expect(timeoffScope.allowedOrgUnitIds).toEqual(expect.arrayContaining([5, 10, 11]));
  });

  it('merges allowedOrgUnitIds for the same permissionCode across multiple delegations', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          { permission_codes: JSON.stringify(['schedule.manage']), scope_org_unit_id: 5 },
          { permission_codes: JSON.stringify(['schedule.manage']), scope_org_unit_id: 20 },
        ],
        null,
      ])
      .mockResolvedValueOnce([[{ id: 5 }], null])   // subtree for org 5
      .mockResolvedValueOnce([[{ id: 20 }], null]);  // subtree for org 20

    const svc = new RbacService(pool);
    const scopes = await svc.getEffectiveDelegationScopes(7);

    expect(scopes).toHaveLength(1); // merged into one entry
    expect(scopes[0].permissionCode).toBe('schedule.manage');
    expect(scopes[0].allowedOrgUnitIds).toEqual(expect.arrayContaining([5, 20]));
  });

  it('only queries delegations with scope_org_unit_id IS NOT NULL', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new RbacService(pool);
    await svc.getEffectiveDelegationScopes(99);

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('scope_org_unit_id IS NOT NULL');
  });
});

describe('RbacService.bulkAssignRole', () => {
  const makeTxPool = () => {
    const execute = jest.fn().mockResolvedValue([[], null]);
    const conn = {
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]),
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    return { pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never, execute, conn };
  };

  it('short-circuits an empty user list without opening a transaction', async () => {
    const { pool, conn } = makeTxPool();
    const result = await new RbacService(pool).bulkAssignRole([], 2, null, null, 1, null);
    expect(result).toEqual({ assigned: 0 });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('grants the role to every user in one transaction, then audits after commit', async () => {
    const { pool, execute, conn } = makeTxPool();

    const result = await new RbacService(pool).bulkAssignRole([5, 6], 2, 3, '2026-12-31', 1, 'seasonal staff');

    expect(result).toEqual({ assigned: 2 });
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.execute.mock.calls[0][1]).toEqual([5, 2, 3, '2026-12-31']);
    expect(conn.commit).toHaveBeenCalled();
    // Audit rows are written on the pool AFTER the commit: an audit failure
    // must never roll back an already-granted role.
    const auditCalls = execute.mock.calls.filter((c) => String(c[0]).includes('audit_logs'));
    expect(auditCalls).toHaveLength(2);
  });

  it('rolls back and rethrows when a grant fails mid-batch', async () => {
    const { pool, execute, conn } = makeTxPool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockRejectedValueOnce(new Error('deadlock'));

    await expect(
      new RbacService(pool).bulkAssignRole([5, 6], 2, null, null, 1, null)
    ).rejects.toThrow('deadlock');

    expect(conn.rollback).toHaveBeenCalled();
    // No audit rows for a failed batch.
    expect(execute.mock.calls.filter((c) => String(c[0]).includes('audit_logs'))).toHaveLength(0);
  });
});
