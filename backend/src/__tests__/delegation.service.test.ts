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
    const result = await service.createDelegation(1, delegatorPerms, {
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
      service.createDelegation(1, delegatorPerms, {
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
      service.createDelegation(1, delegatorPerms, {
        delegateeId: 1,
        permissionCodes: ['timeoff.approve'],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
    ).rejects.toThrow(/yourself/);
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
