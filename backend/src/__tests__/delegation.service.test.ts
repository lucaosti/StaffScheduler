/**
 * DelegationService unit tests (issue #90).
 *
 * Covers:
 *   - successful delegation creation
 *   - escalation guard (code not held by delegator is rejected)
 *   - self-delegation guard
 *   - RbacService.getEffectivePermissions merges active delegations
 *   - expired delegation is excluded from effective permissions
 */

import { DelegationService } from '../services/DelegationService';
import { RbacService } from '../services/RbacService';

// ──────────────────────────────────────────────────────────────────────────────
// Pool mock helpers
// ──────────────────────────────────────────────────────────────────────────────

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

// ──────────────────────────────────────────────────────────────────────────────
// DelegationService tests
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.createDelegation', () => {
  const delegatorPerms = ['timeoff.approve', 'schedule.read', 'employee.read'];

  it('creates a delegation when all requested codes are held by the delegator', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }, null]) // INSERT
      .mockResolvedValueOnce([[]])                                       // writeAuditLog audit insert
      .mockResolvedValueOnce([                                           // getDelegationById
        [{
          id: 42,
          delegator_id: 1,
          delegatee_id: 2,
          permission_codes: JSON.stringify(['timeoff.approve']),
          scope_org_unit_id: null,
          starts_at: new Date(),
          expires_at: new Date(Date.now() + 86400000),
          is_active: 1,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        null,
      ]);

    const service = new DelegationService(pool);
    const result = await service.createDelegation({ id: 1, permissions: delegatorPerms }, {
      delegateeId: 2,
      permissionCodes: ['timeoff.approve'],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    expect(result.id).toBe(42);
    expect(result.permissionCodes).toEqual(['timeoff.approve']);
  });

  it('throws when a requested code is not held by the delegator (escalation guard)', async () => {
    const { pool } = makePool();
    const service = new DelegationService(pool);

    await expect(
      service.createDelegation({ id: 1, permissions: delegatorPerms }, {
        delegateeId: 2,
        permissionCodes: ['settings.manage'], // not in delegatorPerms
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
    ).rejects.toThrow(/escalation/);
  });

  it('throws when delegatee is the same as the delegator', async () => {
    const { pool } = makePool();
    const service = new DelegationService(pool);

    await expect(
      service.createDelegation({ id: 1, permissions: delegatorPerms }, {
        delegateeId: 1,
        permissionCodes: ['timeoff.approve'],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
    ).rejects.toThrow(/yourself/);
  });

  // #814: a delegation can never be wider than the delegator's own scope.
  const scoped = { id: 1, permissions: delegatorPerms, allowedOrgUnitIds: [5, 6] };
  const input = (scopeOrgUnitId: number | null) => ({
    delegateeId: 2,
    permissionCodes: ['timeoff.approve'],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    scopeOrgUnitId,
  });

  it('refuses an organization-wide delegation from a scoped delegator', async () => {
    const { pool, execute } = makePool();
    await expect(new DelegationService(pool).createDelegation(scoped, input(null))).rejects.toThrow(/organization-wide/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a delegation scoped outside the delegator\'s units', async () => {
    const { pool } = makePool();
    await expect(new DelegationService(pool).createDelegation(scoped, input(9))).rejects.toThrow(/outside the delegator's scope/);
  });

  it('judges each code by its own scope, delegation overrides included', async () => {
    const { pool } = makePool();
    const delegatee = { ...scoped, allowedOrgUnitIds: null, delegationScopes: [{ permissionCode: 'timeoff.approve', allowedOrgUnitIds: [7] }] };
    await expect(new DelegationService(pool).createDelegation(delegatee, input(5))).rejects.toThrow(/outside/);
  });

  it('accepts a delegation inside the delegator\'s scope', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null])
      .mockResolvedValueOnce([{ insertId: 1 }, null])
      .mockResolvedValueOnce([[{
        id: 42, delegator_id: 1, delegatee_id: 2, permission_codes: '["timeoff.approve"]', scope_org_unit_id: 6,
        starts_at: new Date(), expires_at: new Date(Date.now() + 86400000), is_active: 1, created_at: new Date(), updated_at: new Date(),
      }], null]);
    const result = await new DelegationService(pool).createDelegation(scoped, input(6));
    expect(result.scopeOrgUnitId).toBe(6);
  });
});

describe('DelegationService.revokeDelegation', () => {
  it('throws when delegation does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const service = new DelegationService(pool);
    await expect(service.revokeDelegation(999, 1)).rejects.toThrow(/not found/);
  });

  it('throws when the requestor is not the delegator', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 10, delegator_id: 5 }], null]);

    const service = new DelegationService(pool);
    await expect(service.revokeDelegation(10, 99)).rejects.toThrow(/Only the delegator/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// RbacService.getEffectivePermissions — delegation merge
// ──────────────────────────────────────────────────────────────────────────────

describe('RbacService.getEffectivePermissions — delegation merge', () => {
  it('includes delegated permissions alongside role permissions', async () => {
    const { pool, execute } = makePool();
    // First call: role-based permissions for the delegatee
    execute.mockResolvedValueOnce([[{ code: 'schedule.read' }], null]);
    // Second call: active delegations (now includes delegator_id)
    execute.mockResolvedValueOnce([
      [{ delegator_id: 99, permission_codes: JSON.stringify(['timeoff.approve']) }],
      null,
    ]);
    // Third call: batch query for all delegators' current role permissions (cap check)
    execute.mockResolvedValueOnce([[{ user_id: 99, code: 'timeoff.approve' }], null]);

    const service = new RbacService(pool);
    const perms = await service.getEffectivePermissions(7);

    expect(perms).toContain('schedule.read');
    expect(perms).toContain('timeoff.approve');
    expect(new Set(perms).size).toBe(perms.length); // no duplicates
  });

  it('excludes expired delegations (query WHERE handles it; mock returns [])', async () => {
    const { pool, execute } = makePool();
    // Role-based permissions
    execute.mockResolvedValueOnce([[{ code: 'employee.read' }], null]);
    // Active delegations — empty because the delegation has expired
    execute.mockResolvedValueOnce([[], null]);

    const service = new RbacService(pool);
    const perms = await service.getEffectivePermissions(7);

    expect(perms).toEqual(['employee.read']);
    expect(perms).not.toContain('timeoff.approve');
  });

  it('de-duplicates codes that appear in both role and delegation', async () => {
    const { pool, execute } = makePool();
    // Delegatee role permissions
    execute.mockResolvedValueOnce([[{ code: 'schedule.read' }], null]);
    // Active delegations (includes delegator_id)
    execute.mockResolvedValueOnce([
      [{ delegator_id: 99, permission_codes: JSON.stringify(['schedule.read', 'timeoff.approve']) }],
      null,
    ]);
    // Batch query for all delegators' current role permissions — delegator holds both
    execute.mockResolvedValueOnce([
      [{ user_id: 99, code: 'schedule.read' }, { user_id: 99, code: 'timeoff.approve' }],
      null,
    ]);

    const service = new RbacService(pool);
    const perms = await service.getEffectivePermissions(7);

    expect(perms.filter((c) => c === 'schedule.read')).toHaveLength(1);
    expect(perms).toContain('timeoff.approve');
  });
});
