/**
 * DelegationService — extended unit tests.
 *
 * Covers:
 *   - createDelegation: writes audit log entry
 *   - createDelegation: scopeOrgUnitId passed when provided
 *   - revokeDelegation: happy path (marks is_active = FALSE, writes audit log)
 *   - listForUser: returns all delegations (as delegator or delegatee)
 *   - listForUser: returns empty array when none found
 *   - getActiveDelegatedPermissions: merges codes from multiple delegations
 *   - getActiveDelegatedPermissions: returns empty array when no active delegations
 *   - getActiveDelegatedPermissions: de-duplicates codes across multiple rows
 *   - getDelegationById: returns null when not found
 *   - getDelegationById: returns mapped delegation when found
 */

import { DelegationService } from '../services/DelegationService';

// ──────────────────────────────────────────────────────────────────────────────
// Pool mock helper
// ──────────────────────────────────────────────────────────────────────────────

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as unknown as import('mysql2/promise').Pool, execute };
};

// Shared fixtures
const futureDate = new Date(Date.now() + 86_400_000 * 7);

const makeDelegationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  delegator_id: 10,
  delegatee_id: 20,
  permission_codes: JSON.stringify(['timeoff.approve', 'schedule.read']),
  scope_org_unit_id: null,
  starts_at: new Date(),
  expires_at: futureDate,
  is_active: 1,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// createDelegation — additional paths
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.createDelegation — additional paths', () => {
  it('includes scopeOrgUnitId in the INSERT when provided', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])  // INSERT delegation
      .mockResolvedValueOnce([[], null])                                  // audit_logs INSERT
      .mockResolvedValueOnce([[makeDelegationRow()], null]);               // getDelegationById

    const svc = new DelegationService(pool);
    await svc.createDelegation(10, ['timeoff.approve'], {
      delegateeId: 20,
      permissionCodes: ['timeoff.approve'],
      expiresAt: futureDate.toISOString(),
      scopeOrgUnitId: 5,
    });

    // The first execute call is the INSERT; verify scopeOrgUnitId param is present
    const insertArgs = execute.mock.calls[0][1] as unknown[];
    expect(insertArgs[3]).toBe(5);  // scope_org_unit_id is the 4th value-param
  });

  it('writes an audit log entry after successful creation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }, null])  // INSERT delegation
      .mockResolvedValueOnce([[], null])                                   // audit INSERT
      .mockResolvedValueOnce([[makeDelegationRow({ id: 42 })], null]);     // getDelegationById

    const svc = new DelegationService(pool);
    await svc.createDelegation(10, ['timeoff.approve'], {
      delegateeId: 20,
      permissionCodes: ['timeoff.approve'],
      expiresAt: futureDate.toISOString(),
    });

    // Second execute call should be the audit_logs INSERT
    expect(execute.mock.calls[1][0]).toContain('INSERT INTO audit_logs');
    const auditArgs = execute.mock.calls[1][1] as unknown[];
    expect(auditArgs[1]).toBe('delegation.grant');
  });

  it('still resolves even if audit log INSERT fails (silent error)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])   // INSERT delegation
      .mockRejectedValueOnce(new Error('audit table locked'))             // audit log fails
      .mockResolvedValueOnce([[makeDelegationRow()], null]);               // getDelegationById

    const svc = new DelegationService(pool);
    // Should not throw — audit errors are swallowed
    await expect(
      svc.createDelegation(10, ['timeoff.approve'], {
        delegateeId: 20,
        permissionCodes: ['timeoff.approve'],
        expiresAt: futureDate.toISOString(),
      })
    ).resolves.toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// revokeDelegation — happy path
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.revokeDelegation — happy path', () => {
  it('marks the delegation inactive and writes an audit log', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, delegator_id: 10 }], null])  // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])             // UPDATE is_active
      .mockResolvedValueOnce([[], null]);                              // audit INSERT

    const svc = new DelegationService(pool);
    await expect(svc.revokeDelegation(1, 10)).resolves.toBeUndefined();

    // UPDATE call
    expect(execute.mock.calls[1][0]).toContain('UPDATE delegations SET is_active = FALSE');
    expect(execute.mock.calls[1][1]).toEqual([1]);

    // Audit log call
    expect(execute.mock.calls[2][0]).toContain('INSERT INTO audit_logs');
    expect(execute.mock.calls[2][1]![1]).toBe('delegation.revoke');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listForUser
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.listForUser', () => {
  it('returns all delegations for a user (both as delegator and delegatee)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      makeDelegationRow({ id: 1, delegator_id: 10, delegatee_id: 20 }),
      makeDelegationRow({ id: 2, delegator_id: 30, delegatee_id: 10 }),
    ], null]);

    const svc = new DelegationService(pool);
    const result = await svc.listForUser(10);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[0].permissionCodes).toContain('timeoff.approve');
  });

  it('returns an empty array when the user has no delegations', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new DelegationService(pool);
    const result = await svc.listForUser(99);

    expect(result).toEqual([]);
  });

  it('correctly maps all fields including isActive and scopeOrgUnitId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      makeDelegationRow({ scope_org_unit_id: 5, is_active: 0 }),
    ], null]);

    const svc = new DelegationService(pool);
    const [d] = await svc.listForUser(10);

    expect(d.scopeOrgUnitId).toBe(5);
    expect(d.isActive).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getActiveDelegatedPermissions
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.getActiveDelegatedPermissions', () => {
  it('returns an empty array when no active delegations exist for the user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getActiveDelegatedPermissions(20);

    expect(result).toEqual([]);
  });

  it('returns all delegated permission codes for the user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      { permission_codes: JSON.stringify(['timeoff.approve', 'schedule.read']) },
    ], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getActiveDelegatedPermissions(20);

    expect(result).toContain('timeoff.approve');
    expect(result).toContain('schedule.read');
    expect(result).toHaveLength(2);
  });

  it('merges codes from multiple active delegations', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      { permission_codes: JSON.stringify(['timeoff.approve']) },
      { permission_codes: JSON.stringify(['employee.read', 'schedule.write']) },
    ], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getActiveDelegatedPermissions(20);

    expect(result).toContain('timeoff.approve');
    expect(result).toContain('employee.read');
    expect(result).toContain('schedule.write');
    expect(result).toHaveLength(3);
  });

  it('de-duplicates permission codes that appear in multiple delegations', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[
      { permission_codes: JSON.stringify(['timeoff.approve', 'schedule.read']) },
      { permission_codes: JSON.stringify(['timeoff.approve', 'employee.read']) },
    ], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getActiveDelegatedPermissions(20);

    expect(result.filter((c) => c === 'timeoff.approve')).toHaveLength(1);
    expect(result).toHaveLength(3);
  });

  it('queries using delegatee_id of the target user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new DelegationService(pool);
    await svc.getActiveDelegatedPermissions(77);

    expect(execute.mock.calls[0][1]).toEqual([77]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getDelegationById
// ──────────────────────────────────────────────────────────────────────────────

describe('DelegationService.getDelegationById', () => {
  it('returns null when no delegation matches the id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getDelegationById(999);

    expect(result).toBeNull();
  });

  it('returns a correctly mapped delegation when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[makeDelegationRow({ id: 7 })], null]);

    const svc = new DelegationService(pool);
    const result = await svc.getDelegationById(7);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(7);
    expect(result!.delegatorId).toBe(10);
    expect(result!.delegateeId).toBe(20);
    expect(result!.permissionCodes).toEqual(['timeoff.approve', 'schedule.read']);
    expect(result!.isActive).toBe(true);
  });
});
