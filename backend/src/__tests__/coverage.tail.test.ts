/**
 * Tail-coverage suite: the last uncovered arms across services and utils.
 *
 * Each block below pins a single small behaviour — retrieve-after-write
 * failures, input-bound guards, filter-arm SQL wiring, defensive fallbacks —
 * that no feature-level suite happens to reach. They are grouped in one file
 * because each is a two-to-ten-line test that would not justify a suite of
 * its own; the block comments say which behaviour (not which line) is pinned
 * so the file survives refactors.
 */

import { AuditLogService } from '../services/AuditLogService';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { DepartmentService } from '../services/DepartmentService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { ResponsibilityRuleService } from '../services/ResponsibilityRuleService';
import { ScheduleService } from '../services/ScheduleService';
import { ShiftService } from '../services/ShiftService';
import { TwoFactorService } from '../services/TwoFactorService';
import { UserService } from '../services/UserService';
import { ValidationUtils } from '../utils';
import { logger } from '../config/logger';

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], null]);
  const conn = {
    execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    ping: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

describe('AuditLogService', () => {
  it('truncates fractional pagination offsets instead of passing floats to SQL', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null]) // COUNT
      .mockResolvedValueOnce([[], null]); // page

    await new AuditLogService(pool).list({ limit: 10, offset: 5.7 });

    // LIMIT/OFFSET are integers by contract: 5.7 must arrive as 5.
    expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining([5]));
  });

  it('wires every optional filter into the WHERE clause', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null]) // COUNT
      .mockResolvedValueOnce([[], null]); // page

    await new AuditLogService(pool).list({
      onBehalfOfUserId: 2,
      action: 'role.grant',
      entityType: 'user',
      entityId: 5,
      requestId: 'rid',
    });

    const where = String(execute.mock.calls[0][0]);
    for (const frag of ['on_behalf_of_user_id = ?', 'action = ?', 'entity_type = ?', 'entity_id = ?', 'request_id = ?']) {
      expect(where).toContain(frag);
    }
  });

  it('warns and refuses when exportAll would exceed the export cap', async () => {
    const { pool, execute } = makePool();
    // One row past the cap; exportAll fetches cap+1 purely to detect overflow.
    const big = Array.from({ length: 100_001 }, (_, i) => ({ id: i }));
    execute.mockResolvedValueOnce([big, null]);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    try {
      // Refusing beats truncating: a partial audit export that looks complete
      // is a compliance failure.
      await expect(new AuditLogService(pool).exportAll()).rejects.toThrow(/more than 100000/i);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('rethrows a failed write only when throwOnFailure is set', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValue(new Error('audit db down'));

    const base = { actorId: 1, action: 'x', entityType: 'x', entityId: 1, description: 'd' };
    await expect(new AuditLogService(pool).write(base)).resolves.toBeUndefined();
    await expect(
      new AuditLogService(pool).write({ ...base, throwOnFailure: true })
    ).rejects.toThrow('audit db down');
  });
});

describe('ChangeRequestService', () => {
  it('wires approver and entity-type filters into the list query', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null]) // COUNT
      .mockResolvedValueOnce([[], null]); // page

    await new ChangeRequestService(pool).list({ approverUserId: 9, targetEntityType: 'policy' } as never);

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain('approver_user_id = ?');
    expect(sql).toContain('target_entity_type = ?');
    expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining([9, 'policy']));
  });
});

describe('DepartmentService.assignEmployeesToDepartment', () => {
  it('commits an empty membership set without touching users', async () => {
    const { pool, execute, conn } = makePool();
    void execute;
    conn.execute.mockResolvedValueOnce([[{ id: 3 }], null]); // department exists

    await new DepartmentService(pool).assignEmployeesToDepartment(3, []);

    expect(conn.commit).toHaveBeenCalled();
    // Only the existence check ran — no member queries for an empty set.
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });
});

describe('EmployeeLoanService — residual arms', () => {
  it('non-final approve throws when the refresh fails', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, user_id: 7, from_org_unit_id: 1, to_org_unit_id: 2, start_date: 's', end_date: 'e', reason: null, status: 'pending', requested_by: 5, approver_user_id: null, reviewed_at: null, review_notes: null, created_at: 't', updated_at: 't' }], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([[], null]); // refresh gone

    const service = new EmployeeLoanService(pool);
    jest
      .spyOn((service as unknown as { engine: { decidePendingApproval: () => unknown } }).engine, 'decidePendingApproval')
      .mockResolvedValue({ isFinalStep: false } as never);

    await expect(service.approve(1, 99)).rejects.toThrow('Failed to refresh loan');
  });

  it('reject refuses when no pending approval row exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, user_id: 7, from_org_unit_id: 1, to_org_unit_id: 2, start_date: 's', end_date: 'e', reason: null, status: 'pending', requested_by: 5, approver_user_id: null, reviewed_at: null, review_notes: null, created_at: 't', updated_at: 't' }], null])
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId -> none

    await expect(new EmployeeLoanService(pool).reject(1, 99)).rejects.toThrow(
      'No pending approval found for this loan'
    );
  });
});

describe('ResponsibilityRuleService — input bounds and residual arms', () => {
  const svc = () => new ResponsibilityRuleService(makePool().pool);

  it('rejects subject ids for the "all" subject type', async () => {
    await expect(
      svc().create({ subjectType: 'all', subjectId: 5, permissionCode: 'x', responsibleOrgUnitId: 1 } as never, 1)
    ).rejects.toThrow('subject_id must be null when subject_type is "all"');
  });

  it('bounds resolve inputs to 100 departments and 100 roles', async () => {
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    await expect(
      svc().resolveResponsibleUsers({ permissionCode: 'x', orgUnitId: null, departmentIds: many, roleIds: [] })
    ).rejects.toThrow('Max 100 department IDs allowed');
    await expect(
      svc().resolveResponsibleUsers({ permissionCode: 'x', orgUnitId: null, departmentIds: [], roleIds: many })
    ).rejects.toThrow('Max 100 role IDs allowed');
  });

  it('bounds bulk creation: non-empty permission codes, max 500 rules', async () => {
    await expect(
      svc().bulkCreate({ subjectType: 'all', subjectIds: [], permissionCodes: [], responsibleOrgUnitId: 1, delegatedToRoleId: null, description: null }, 1)
    ).rejects.toThrow('permissionCodes must not be empty');

    const codes = Array.from({ length: 501 }, (_, i) => `p${i}`);
    await expect(
      svc().bulkCreate({ subjectType: 'all', subjectIds: [], permissionCodes: codes, responsibleOrgUnitId: 1, delegatedToRoleId: null, description: null }, 1)
    ).rejects.toThrow('Bulk create limited to 500 rules per request');
  });

  it('orders matrix entries by subject specificity', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { id: 1, subject_type: 'all', subject_id: null, permission_code: 'x', responsible_org_unit_id: 1, delegated_to_role_id: null, description: null, is_active: 1, created_by: 1, created_at: 't', updated_at: 't' },
        { id: 2, subject_type: 'department', subject_id: 3, permission_code: 'x', responsible_org_unit_id: 1, delegated_to_role_id: null, description: null, is_active: 1, created_by: 1, created_at: 't', updated_at: 't' },
      ],
      null,
    ]);

    const matrix = await new ResponsibilityRuleService(pool).getMatrix();
    // Entries for the same permission are ordered most-specific first.
    expect(matrix.map((e) => e.subjectType)).toEqual(['department', 'all']);
  });
});

describe('ScheduleService — residual arms', () => {
  it('publishing notifies every assigned user asynchronously', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ shift_count: 2 }], null]); // shifts exist
    execute
      .mockResolvedValueOnce([[{ id: 1, name: 'July', description: null, department_id: 3, start_date: 's', end_date: 'e', status: 'published', published_at: 't', notes: null, created_at: 't', updated_at: 't', created_by: 1, shift_count: 0, total_assignments: 0 }], null]) // refreshed schedule
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // audit write
      .mockResolvedValueOnce([[{ user_id: 7 }, { user_id: 8 }], null]) // assigned users
      .mockResolvedValue([{ insertId: 1 }, null]); // notification inserts

    const service = new ScheduleService(pool);
    const notify = jest
      .spyOn((service as unknown as { notifications: { notifyAsync: (n: unknown) => void } }).notifications, 'notifyAsync')
      .mockImplementation(() => undefined);

    await service.publishSchedule(1, 99);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toMatchObject({ userId: 7, type: 'schedule.published' });
  });

  it('delete diagnoses a vanished schedule under the guarded DELETE', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ status: 'draft' }], null]) // status pre-check
      .mockResolvedValue([{ affectedRows: 0 }, null]); // child cleanups + guarded DELETE

    await expect(new ScheduleService(pool).deleteSchedule(99)).rejects.toThrow('Schedule not found');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('ShiftService / TwoFactorService / UserService — residual arms', () => {
  it('shift template creation throws when the created row cannot be re-read', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ insertId: 5 }, null]); // INSERT template
    execute.mockResolvedValueOnce([[], null]); // re-read gone

    await expect(
      new ShiftService(pool).createShiftTemplate({ name: 'T', startTime: '08:00', endTime: '16:00', minStaff: 1, maxStaff: 2 } as never)
    ).rejects.toThrow('Failed to retrieve created shift template');
  });

  it('TOTP verification returns false when the code matches no time window', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, totp_last_counter: null }],
      null,
    ]);

    await expect(new TwoFactorService(pool).verifyCode(1, '000000')).resolves.toBe(false);
  });

  it('createUser translates a duplicate-key race into the domain conflict', async () => {
    const { pool, execute, conn } = makePool();
    void execute;
    conn.execute
      .mockResolvedValueOnce([[], null]) // email pre-check: free
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })); // INSERT loses the race

    await expect(
      new UserService(pool).createUser({ email: 'a@x', password: 'pw', firstName: 'A', lastName: 'B' } as never)
    ).rejects.toThrow('Email or employee ID already exists');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('updateUser can clear and set organization_name', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE users
      .mockResolvedValue([[{ id: 9, email: 'a@x', first_name: 'A', last_name: 'B', is_active: 1 }], null]); // re-read

    (pool as unknown as { execute: jest.Mock }).execute.mockResolvedValue([
      [{ id: 9, email: 'a@x', first_name: 'A', last_name: 'B', is_active: 1 }],
      null,
    ]);

    await new UserService(pool).updateUser(9, { organizationName: 'Acme' } as never);

    const update = conn.execute.mock.calls.find((c) => String(c[0]).includes('organization_name = ?'))!;
    expect(update[1]).toContain('Acme');
  });
});

describe('utils — parseStringArray fallbacks and TOTP base32 guard', () => {
  it('passes arrays through, filtering non-strings', () => {
    expect(ValidationUtils.parseStringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for empty/non-string input and non-array JSON', () => {
    expect(ValidationUtils.parseStringArray('')).toEqual([]);
    expect(ValidationUtils.parseStringArray(7)).toEqual([]);
    expect(ValidationUtils.parseStringArray('{"a":1}')).toEqual([]);
  });

  it('base32 decoding sanitizes non-alphabet characters instead of throwing', () => {
    const { verifyTotp } = require('../utils/totp');
    // Illegal characters are stripped before decoding, so a polluted secret
    // degrades to a normal failed verification, never an exception.
    expect(verifyTotp('JBSWY3DP!EHPK3PXP', '000000')).toBe(false);
  });
});
