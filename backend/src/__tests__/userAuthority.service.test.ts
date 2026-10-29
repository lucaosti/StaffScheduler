/**
 * Unit tests for UserAuthorityService — the single rule deciding who may write
 * which account and grant which role (#809, #810). The end-to-end attacks it
 * closes are reproduced against a real database in the integration suite
 * ("user-management authority"); these tests pin each branch of the rule.
 *
 * @author Luca Ostinelli
 */

jest.mock('../services/RbacService');

import { RbacService } from '../services/RbacService';
import { UserAuthorityService } from '../services/UserAuthorityService';
import { ForbiddenError } from '../errors';
import { User } from '../types';

const actor = (permissions: string[], allowedOrgUnitIds: number[] | null = null): User =>
  ({ id: 10, permissions, allowedOrgUnitIds } as unknown as User);

const makeService = (orgUnitRows: Array<{ org_unit_id: number }> = []) => {
  const execute = jest.fn().mockResolvedValue([orgUnitRows, null]);
  return { service: new UserAuthorityService({ execute } as never), execute };
};

const getRoleById = RbacService.prototype.getRoleById as jest.Mock;
const getRoleIdByName = RbacService.prototype.getRoleIdByName as jest.Mock;
const getEffectivePermissions = RbacService.prototype.getEffectivePermissions as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getRoleById.mockImplementation(async (id: number) =>
    ({ 1: { id: 1, permissions: ['employee.read', 'role.manage'] }, 3: { id: 3, permissions: ['employee.read'] } } as Record<number, unknown>)[id] ?? null
  );
  getRoleIdByName.mockImplementation(async (name: string) => ({ Administrator: 1, Employee: 3 } as Record<string, number>)[name] ?? null);
  getEffectivePermissions.mockResolvedValue([]);
});

describe('assertCanAssignRoles', () => {
  it('allows anything when roles are not being changed', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoles(actor([]), undefined, 10)).resolves.toBeUndefined();
    expect(getRoleById).not.toHaveBeenCalled();
  });

  it("refuses any change to the actor's own roles, even an empty list and even for role.manage", async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoles(actor(['role.manage']), [], 10)).rejects.toThrow('You cannot change your own roles');
  });

  it('lets a role.manage holder grant any role without resolving it', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoles(actor(['role.manage']), [1], 20)).resolves.toBeUndefined();
    expect(getRoleById).not.toHaveBeenCalled();
  });

  it('grants a role whose permissions the actor holds', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoles(actor(['employee.read']), [3], 20)).resolves.toBeUndefined();
  });

  it('refuses a role carrying a permission the actor lacks', async () => {
    const { service } = makeService();
    const attempt = service.assertCanAssignRoles(actor(['employee.read']), [3, 1]);
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.assertCanAssignRoles(actor(['employee.read']), [1])).rejects.toThrow('permissions you do not hold');
  });

  it('treats a missing permission list as holding nothing, on either side', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoleNames({ id: 10 } as User, ['Employee'])).rejects.toThrow(ForbiddenError);
    getRoleById.mockResolvedValue({ id: 4 });
    await expect(service.assertCanAssignRoles({ id: 10 } as User, [4])).resolves.toBeUndefined();
    getEffectivePermissions.mockResolvedValue(['employee.read']);
    await expect(service.assertCanManageUser({ id: 10 } as User, 20)).rejects.toThrow(ForbiddenError);
  });

  it('refuses an unknown role id', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoles(actor(['employee.read']), [99])).rejects.toThrow('Role 99 not found');
  });
});

describe('assertCanAssignRoleNames', () => {
  it('refuses an import naming a role the actor could not grant', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoleNames(actor(['employee.read']), ['Employee', 'Administrator'])).rejects.toThrow(ForbiddenError);
  });

  it('accepts grantable names and ignores unknown ones, resolving each name once', async () => {
    const { service } = makeService();
    await expect(service.assertCanAssignRoleNames(actor(['employee.read']), ['Employee', 'Employee', 'Ghost'])).resolves.toBeUndefined();
    expect(getRoleIdByName).toHaveBeenCalledTimes(2);
  });

  it('skips resolution entirely for a role.manage holder', async () => {
    const { service } = makeService();
    await service.assertCanAssignRoleNames(actor(['role.manage']), ['Administrator']);
    expect(getRoleIdByName).not.toHaveBeenCalled();
  });
});

describe('assertCanManageUser', () => {
  it('leaves the actor’s own account to the self-service rules', async () => {
    const { service } = makeService();
    await expect(service.assertCanManageUser(actor([]), 10)).resolves.toBeUndefined();
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('lets a role.manage holder manage any account', async () => {
    const { service } = makeService();
    getEffectivePermissions.mockResolvedValue(['role.manage', 'settings.manage']);
    await expect(service.assertCanManageUser(actor(['role.manage'], [5]), 20)).resolves.toBeUndefined();
  });

  it('refuses writing an account that holds a permission the actor lacks', async () => {
    const { service } = makeService();
    getEffectivePermissions.mockResolvedValue(['employee.read', 'settings.manage']);
    await expect(service.assertCanManageUser(actor(['employee.read', 'user.manage']), 20)).rejects.toThrow(
      'You cannot modify an account with permissions you do not hold'
    );
  });

  it('lets an unscoped actor manage an account within their permissions', async () => {
    const { service, execute } = makeService();
    getEffectivePermissions.mockResolvedValue(['employee.read']);
    await expect(service.assertCanManageUser(actor(['employee.read', 'user.manage']), 20)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets a scoped actor manage an account in one of their units', async () => {
    const { service } = makeService([{ org_unit_id: 9 }, { org_unit_id: 5 }]);
    await expect(service.assertCanManageUser(actor(['user.manage'], [5, 6]), 20)).resolves.toBeUndefined();
  });

  it('refuses a scoped actor an account outside their units, or in no unit at all', async () => {
    const outside = makeService([{ org_unit_id: 9 }]);
    await expect(outside.service.assertCanManageUser(actor(['user.manage'], [5]), 20)).rejects.toThrow('outside your organizational scope');
    const nowhere = makeService([]);
    await expect(nowhere.service.assertCanManageUser(actor(['user.manage'], [5]), 20)).rejects.toThrow(ForbiddenError);
  });
});
