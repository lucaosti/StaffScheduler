/**
 * ResponsibilityRuleService unit tests.
 *
 * Covers: list (all filters), getById, create (validation + audit),
 * update (merge + validation + audit), delete (not-found + audit),
 * resolveResponsibleUsers (all subject-type branches).
 *
 * @author Luca Ostinelli
 */

import { ResponsibilityRuleService } from '../services/ResponsibilityRuleService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  subject_type: 'department',
  subject_id: 10,
  permission_code: 'schedule.manage',
  responsible_org_unit_id: 3,
  delegated_to_role_id: null,
  description: 'HR manages scheduling for sales dept',
  is_active: 1,
  created_by: 42,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.list', () => {
  it('returns all rules when no filters are given', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow(), buildRow({ id: 2, subject_id: 20 })], null]);

    const svc = new ResponsibilityRuleService(pool);
    const result = await svc.list();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('filters by subjectType', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ subjectType: 'department' });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('subject_type = ?');
    expect(params).toContain('department');
  });

  it('filters by permissionCode', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ permissionCode: 'schedule.manage' });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('permission_code = ?');
    expect(params).toContain('schedule.manage');
  });

  it('filters by responsibleOrgUnitId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ responsibleOrgUnitId: 3 });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('responsible_org_unit_id = ?');
    expect(params).toContain(3);
  });

  it('filters by isActive=true', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ isActive: true });

    const [, params] = execute.mock.calls[0];
    expect(params).toContain(1);
  });

  it('filters by isActive=false', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ is_active: 0 })], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ isActive: false });

    const [, params] = execute.mock.calls[0];
    expect(params).toContain(0);
  });

  it('combines multiple filters with AND', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.list({ permissionCode: 'schedule.manage', responsibleOrgUnitId: 3 });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('WHERE');
    expect(sql).toContain('AND');
  });

  it('maps is_active=1 to boolean true', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ is_active: 1 })], null]);

    const svc = new ResponsibilityRuleService(pool);
    const [rule] = await svc.list();
    expect(rule.isActive).toBe(true);
  });

  it('maps is_active=0 to boolean false', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ is_active: 0 })], null]);

    const svc = new ResponsibilityRuleService(pool);
    const [rule] = await svc.list();
    expect(rule.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.getById', () => {
  it('returns a mapped rule when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ResponsibilityRuleService(pool);
    const rule = await svc.getById(1);

    expect(rule).not.toBeNull();
    expect(rule!.id).toBe(1);
    expect(rule!.subjectType).toBe('department');
    expect(rule!.permissionCode).toBe('schedule.manage');
    expect(rule!.responsibleOrgUnitId).toBe(3);
    expect(rule!.delegatedToRoleId).toBeNull();
    expect(rule!.createdBy).toBe(42);
  });

  it('returns null when not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ResponsibilityRuleService(pool);
    const rule = await svc.getById(999);
    expect(rule).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.create', () => {
  it('inserts and returns the new rule', async () => {
    const { pool, execute } = makePool();
    // INSERT → getById → audit write
    execute
      .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ id: 7 })], null])
      .mockResolvedValue([{ insertId: 99, affectedRows: 1 }, null]);

    const svc = new ResponsibilityRuleService(pool);
    const rule = await svc.create(
      {
        subjectType: 'department',
        subjectId: 10,
        permissionCode: 'schedule.manage',
        responsibleOrgUnitId: 3,
      },
      42
    );

    expect(rule.id).toBe(7);
    const [insertSql, insertParams] = execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO responsibility_rules');
    expect(insertParams).toContain('department');
    expect(insertParams).toContain('schedule.manage');
    expect(insertParams).toContain(3);
  });

  it('throws when subjectId is missing for non-all subject_type', async () => {
    const { pool } = makePool();
    const svc = new ResponsibilityRuleService(pool);

    await expect(
      svc.create(
        { subjectType: 'department', permissionCode: 'schedule.manage', responsibleOrgUnitId: 3 },
        1
      )
    ).rejects.toThrow('subject_id is required');
  });

  it('throws when subjectId is supplied for subject_type "all"', async () => {
    const { pool } = makePool();
    const svc = new ResponsibilityRuleService(pool);

    await expect(
      svc.create(
        { subjectType: 'all', subjectId: 5, permissionCode: 'schedule.manage', responsibleOrgUnitId: 3 },
        1
      )
    ).rejects.toThrow('subject_id must be null');
  });

  it('accepts subject_type "all" with null subjectId', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 8, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ id: 8, subject_type: 'all', subject_id: null })], null])
      .mockResolvedValue([{ insertId: 99, affectedRows: 1 }, null]);

    const svc = new ResponsibilityRuleService(pool);
    const rule = await svc.create(
      { subjectType: 'all', permissionCode: 'schedule.manage', responsibleOrgUnitId: 3 },
      1
    );
    expect(rule.subjectType).toBe('all');
    expect(rule.subjectId).toBeNull();
  });

  it('writes an audit log entry after creation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ id: 7 })], null])
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }, null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.create(
      { subjectType: 'department', subjectId: 10, permissionCode: 'schedule.manage', responsibleOrgUnitId: 3 },
      42
    );

    // 3rd execute call is the audit INSERT
    expect(execute).toHaveBeenCalledTimes(3);
    const [auditSql] = execute.mock.calls[2];
    expect(auditSql).toContain('INSERT INTO audit_logs');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.update', () => {
  it('merges patch with existing rule and updates', async () => {
    const { pool, execute } = makePool();
    const existing = buildRow();
    execute
      .mockResolvedValueOnce([[existing], null])         // getById (existing)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE
      .mockResolvedValueOnce([[buildRow({ description: 'updated' })], null]) // getById (updated)
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]); // audit

    const svc = new ResponsibilityRuleService(pool);
    const updated = await svc.update(1, { description: 'updated' }, 42);

    expect(updated.description).toBe('updated');
    const [updateSql] = execute.mock.calls[1];
    expect(updateSql).toContain('UPDATE responsibility_rules');
  });

  it('throws NOT_FOUND when the rule does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ResponsibilityRuleService(pool);
    await expect(svc.update(999, { isActive: false }, 1)).rejects.toThrow('not found');
  });

  it('rejects update that would leave non-all subject without subjectId', async () => {
    const { pool, execute } = makePool();
    // existing rule has subject_type=department, subject_id=10
    execute.mockResolvedValueOnce([[buildRow({ subject_type: 'department', subject_id: 10 })], null]);

    const svc = new ResponsibilityRuleService(pool);
    // patch sets subjectId to null while keeping subject_type=department
    await expect(svc.update(1, { subjectId: null }, 1)).rejects.toThrow('subject_id is required');
  });

  it('writes an audit log entry with before and after snapshots', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ description: 'new desc' })], null])
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.update(1, { description: 'new desc' }, 42);

    const [auditSql, auditParams] = execute.mock.calls[3];
    expect(auditSql).toContain('INSERT INTO audit_logs');
    // before/after snapshots are JSON-serialised and appear in params
    expect(auditParams.some((p: unknown) => typeof p === 'string' && p.includes('responsibility_rule.update'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.delete', () => {
  it('deletes the rule and writes an audit entry', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])         // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // DELETE
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]); // audit

    const svc = new ResponsibilityRuleService(pool);
    await svc.delete(1, 42);

    const [deleteSql, deleteParams] = execute.mock.calls[1];
    expect(deleteSql).toContain('DELETE FROM responsibility_rules');
    expect(deleteParams).toContain(1);

    const [auditSql] = execute.mock.calls[2];
    expect(auditSql).toContain('INSERT INTO audit_logs');
  });

  it('throws NOT_FOUND when the rule does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ResponsibilityRuleService(pool);
    await expect(svc.delete(999, 1)).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// resolveResponsibleUsers
// ---------------------------------------------------------------------------

describe('ResponsibilityRuleService.resolveResponsibleUsers', () => {
  it('always includes the "all" subject condition', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 5 }, { user_id: 6 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    const ids = await svc.resolveResponsibleUsers({ permissionCode: 'schedule.manage' });

    expect(ids).toEqual([5, 6]);
    const [sql] = execute.mock.calls[0];
    expect(sql).toContain("subject_type = 'all'");
    expect(sql).toContain('permission_code = ?');
  });

  it('adds org_unit condition when orgUnitId is provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 7 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.resolveResponsibleUsers({ permissionCode: 'leave.manage', orgUnitId: 3 });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("subject_type = 'org_unit'");
    expect(params).toContain(3);
  });

  it('adds department condition when departmentIds are provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 8 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.resolveResponsibleUsers({ permissionCode: 'schedule.manage', departmentIds: [10, 11] });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("subject_type = 'department'");
    expect(params).toContain(10);
    expect(params).toContain(11);
  });

  it('adds role condition when roleIds are provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 9 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.resolveResponsibleUsers({ permissionCode: 'schedule.manage', roleIds: [2, 4] });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("subject_type = 'role'");
    expect(params).toContain(2);
    expect(params).toContain(4);
  });

  it('combines all subject conditions with OR', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 5 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.resolveResponsibleUsers({
      permissionCode: 'schedule.manage',
      orgUnitId: 3,
      departmentIds: [10],
      roleIds: [2],
    });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain("subject_type = 'all'");
    expect(sql).toContain("subject_type = 'org_unit'");
    expect(sql).toContain("subject_type = 'department'");
    expect(sql).toContain("subject_type = 'role'");
    // All joined by OR inside a sub-clause
    expect(sql.match(/OR/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty array when no matching rules exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ResponsibilityRuleService(pool);
    const ids = await svc.resolveResponsibleUsers({ permissionCode: 'unknown.code' });
    expect(ids).toEqual([]);
  });

  it('de-duplicates user IDs (DISTINCT in SQL)', async () => {
    const { pool, execute } = makePool();
    // The DISTINCT is in SQL; mock returns unique ids already
    execute.mockResolvedValueOnce([[{ user_id: 5 }, { user_id: 5 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    const ids = await svc.resolveResponsibleUsers({ permissionCode: 'schedule.manage' });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('DISTINCT');
    // Raw result from mock is [5,5]; DISTINCT is enforced by SQL — map returns what the mock gives
    expect(ids).toHaveLength(2); // raw mock result; DISTINCT enforced by DB in production
  });

  it('filters by delegated_to_role_id when set (LEFT JOIN + null check in SQL)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 3 }], null]);

    const svc = new ResponsibilityRuleService(pool);
    await svc.resolveResponsibleUsers({ permissionCode: 'schedule.manage' });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('delegated_to_role_id IS NULL OR ur.user_id IS NOT NULL');
  });
});
