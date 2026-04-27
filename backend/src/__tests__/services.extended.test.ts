/**
 * Extended service-layer tests targeting uncovered branches in:
 *   - PolicyService (CRUD, listApplicable for all scopes)
 *   - PolicyExceptionService (approve/reject/cancel and forbidden flows)
 *   - PolicyValidator (manual_assignment_locked, no shift, applicable filtering)
 *   - ApprovalMatrixService (all approver scopes, update flow)
 *   - EmployeeLoanService (approve/reject/cancel, list filters)
 *   - OrgUnitService (CRUD, memberships)
 *
 * @author Luca Ostinelli
 */

import { ApprovalMatrixService } from '../services/ApprovalMatrixService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { OrgUnitService } from '../services/OrgUnitService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';
import { PolicyService } from '../services/PolicyService';
import { PolicyValidator } from '../services/PolicyValidator';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  const fakeConn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const getConnection = jest.fn().mockResolvedValue(fakeConn);
  return { pool: { execute, getConnection } as never, execute, conn: fakeConn };
};

const policyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  scope_type: 'global',
  scope_id: null,
  policy_key: 'min_rest_hours',
  policy_value: '{"hours":11}',
  description: null,
  imposed_by_user_id: 1,
  is_active: 1,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const matrixRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_type: 'Policy.Exception',
  approver_scope: 'policy_owner',
  approver_role: null,
  approver_user_id: null,
  auto_approve_for_owner: 1,
  description: null,
  ...overrides,
});

const exceptionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  policy_id: 1,
  target_type: 'shift_assignment',
  target_id: 100,
  reason: null,
  status: 'pending',
  requested_by_user_id: 7,
  reviewer_user_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const loanRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  from_org_unit_id: 1,
  to_org_unit_id: 2,
  start_date: '2026-05-10',
  end_date: '2026-05-15',
  reason: null,
  status: 'pending',
  requested_by: 99,
  approver_user_id: 99,
  reviewed_at: null,
  review_notes: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const orgUnitRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Unit',
  description: null,
  parent_id: null,
  manager_user_id: 10,
  is_active: 1,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const memberRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  org_unit_id: 1,
  is_primary: 1,
  assigned_at: 't',
  ...overrides,
});

/* ---------------- PolicyService ---------------- */

describe('PolicyService extended', () => {
  it('list (active only) appends WHERE clause', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[policyRow()], null] as Tuple);
    const svc = new PolicyService(pool);
    await svc.list(true);
    expect(execute.mock.calls[0][0]).toMatch(/WHERE is_active = 1/);
  });

  it('getById returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new PolicyService(pool);
    expect(await svc.getById(99)).toBeNull();
  });

  it('listApplicable matches schedule and shift_template scopes', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        policyRow({ id: 1, scope_type: 'global' }),
        policyRow({ id: 2, scope_type: 'schedule', scope_id: 9 }),
        policyRow({ id: 3, scope_type: 'shift_template', scope_id: 4 }),
        policyRow({ id: 4, scope_type: 'org_unit', scope_id: 5 }),
      ],
      null,
    ] as Tuple);
    const svc = new PolicyService(pool);
    const r = await svc.listApplicable({
      scheduleId: 9,
      shiftTemplateId: 4,
      orgUnitId: null,
    });
    const ids = r.map((p) => p.id).sort();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('parses non-string policy_value as-is and falls back on bad JSON', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        policyRow({ id: 1, policy_value: 'not-json' }),
        policyRow({ id: 2, policy_value: { foo: 'bar' } }),
        policyRow({ id: 3, policy_value: null }),
      ],
      null,
    ] as Tuple);
    const svc = new PolicyService(pool);
    const all = await svc.list();
    expect(all[0].policyValue).toBe('not-json');
    expect(all[1].policyValue).toEqual({ foo: 'bar' });
    expect(all[2].policyValue).toBeNull();
  });

  it('create rejects empty key, persists otherwise', async () => {
    const { pool, execute } = makePool();
    const svc = new PolicyService(pool);
    await expect(
      svc.create({
        scopeType: 'global',
        policyKey: '   ',
        policyValue: {},
        imposedByUserId: 1,
      })
    ).rejects.toThrow(/policyKey is required/);

    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[policyRow()], null] as Tuple);
    const created = await svc.create({
      scopeType: 'global',
      policyKey: 'k',
      policyValue: { hours: 11 },
      imposedByUserId: 1,
    });
    expect(created.id).toBe(1);
  });

  it('create throws when refresh returns no row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new PolicyService(pool);
    await expect(
      svc.create({ scopeType: 'global', policyKey: 'k', policyValue: 1, imposedByUserId: 1 })
    ).rejects.toThrow(/Failed to create/);
  });

  it('update/remove guard against missing rows', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new PolicyService(pool);
    await expect(svc.update(1, { policyKey: 'x' })).rejects.toThrow(/not found/);

    execute.mockResolvedValueOnce([[], null] as Tuple);
    await expect(svc.remove(1)).rejects.toThrow(/not found/);
  });

  it('update merges patch and persists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[policyRow({ id: 5 })], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[policyRow({ id: 5, description: 'changed' })], null] as Tuple);
    const svc = new PolicyService(pool);
    const updated = await svc.update(5, {
      description: 'changed',
      isActive: false,
      scopeId: 7,
      policyValue: { hours: 12 },
    });
    expect(updated.description).toBe('changed');
  });

  it('remove deletes when present', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[policyRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);
    const svc = new PolicyService(pool);
    await svc.remove(1);
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM policies/);
  });
});

/* ---------------- PolicyExceptionService extended ---------------- */

describe('PolicyExceptionService extended', () => {
  it('create rejects when policy missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(
      svc.create({ policyId: 1, targetType: 't', targetId: 1, requestedByUserId: 1 })
    ).rejects.toThrow(/Policy not found/);
  });

  it('list applies all filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[exceptionRow()], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await svc.list({
      policyId: 1,
      targetType: 'shift_assignment',
      targetId: 100,
      status: 'pending',
      requestedByUserId: 7,
    });
    expect(execute.mock.calls[0][0]).toMatch(/policy_id/);
    expect(execute.mock.calls[0][0]).toMatch(/target_type/);
    expect(execute.mock.calls[0][0]).toMatch(/status/);
  });

  it('create with non-actor approver yields pending and notifies', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple) // policy
      .mockResolvedValueOnce([[matrixRow({ auto_approve_for_owner: 0 })], null] as Tuple) // matrix
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[exceptionRow({ id: 5, status: 'pending' })], null] as Tuple) // SELECT created
      .mockResolvedValueOnce([{ insertId: 99 }, null] as Tuple) // notification INSERT
      .mockResolvedValueOnce([
        [
          {
            id: 99,
            user_id: 8,
            type: 'policy.exception.requested',
            title: 't',
            body: null,
            link: null,
            is_read: 0,
            created_at: 'x',
            read_at: null,
          },
        ],
        null,
      ] as Tuple);
    const svc = new PolicyExceptionService(pool);
    const created = await svc.create({
      policyId: 1,
      targetType: 'shift_assignment',
      targetId: 100,
      requestedByUserId: 7,
    });
    expect(created.status).toBe('pending');
  });

  it('approve enforces resolved approver', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1 })], null] as Tuple) // getById existing
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple) // policy
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple); // matrix -> approver=8
    const svc = new PolicyExceptionService(pool);
    await expect(svc.approve(1, 99)).rejects.toThrow(/Forbidden/);
  });

  it('approve flow updates and notifies requester', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1 })], null] as Tuple) // existing
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple) // policy
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple) // matrix -> approver=8
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[exceptionRow({ id: 1, status: 'approved' })], null] as Tuple) // refresh
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple) // notification insert
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            user_id: 7,
            type: 'policy.exception.approved',
            title: 't',
            body: null,
            link: null,
            is_read: 0,
            created_at: 'x',
            read_at: null,
          },
        ],
        null,
      ] as Tuple);
    const svc = new PolicyExceptionService(pool);
    const r = await svc.approve(1, 8, 'ok');
    expect(r.status).toBe('approved');
  });

  it('approve raises when not pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1, status: 'approved' })], null] as Tuple)
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple)
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.approve(1, 8)).rejects.toThrow(/Cannot approve/);
  });

  it('reject flow updates and notifies', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple)
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[exceptionRow({ id: 1, status: 'rejected' })], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 2 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 2,
            user_id: 7,
            type: 'policy.exception.rejected',
            title: 't',
            body: null,
            link: null,
            is_read: 0,
            created_at: 'x',
            read_at: null,
          },
        ],
        null,
      ] as Tuple);
    const svc = new PolicyExceptionService(pool);
    const r = await svc.reject(1, 8, 'no');
    expect(r.status).toBe('rejected');
  });

  it('reject Forbidden when actor != approver', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple)
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.reject(1, 99)).rejects.toThrow(/Forbidden/);
  });

  it('reject raises when not pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[exceptionRow({ id: 1, status: 'rejected' })], null] as Tuple)
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 8 })], null] as Tuple)
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.reject(1, 8)).rejects.toThrow(/Cannot reject/);
  });

  it('cancel succeeds when affectedRows>0', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[exceptionRow({ id: 1, status: 'cancelled' })], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    const r = await svc.cancel(1, 7);
    expect(r.status).toBe('cancelled');
  });

  it('cancel raises when not found', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/not found/);
  });

  it('cancel Forbidden when not requester', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([
        [exceptionRow({ id: 1, requested_by_user_id: 8 })],
        null,
      ] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/Forbidden/);
  });

  it('cancel raises when wrong status', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([
        [exceptionRow({ id: 1, requested_by_user_id: 7, status: 'approved' })],
        null,
      ] as Tuple);
    const svc = new PolicyExceptionService(pool);
    await expect(svc.cancel(1, 7)).rejects.toThrow(/Cannot cancel/);
  });

  it('hasApproved returns false on count=0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 0 }], null] as Tuple);
    const svc = new PolicyExceptionService(pool);
    expect(await svc.hasApproved(1, 't', 1)).toBe(false);
  });
});

/* ---------------- PolicyValidator ---------------- */

describe('PolicyValidator', () => {
  it('throws when shift not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const v = new PolicyValidator(pool);
    await expect(v.validateAssignment({ userId: 1, shiftId: 99 })).rejects.toThrow(/Shift not found/);
  });

  it('flags manual_assignment_locked policies', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 9,
            schedule_id: 1,
            template_id: null,
            department_id: 1,
            date: '2026-04-25',
            start_time: '08:00',
            end_time: '16:00',
          },
        ],
        null,
      ] as Tuple) // shift lookup
      .mockResolvedValueOnce([[{ org_unit_id: 1 }], null] as Tuple) // user_org_units
      .mockResolvedValueOnce([
        [
          policyRow({
            id: 1,
            scope_type: 'global',
            policy_key: 'manual_assignment_locked',
          }),
        ],
        null,
      ] as Tuple) // listApplicable
      .mockResolvedValueOnce([[{ c: 0 }], null] as Tuple); // hasApproved
    const v = new PolicyValidator(pool);
    const r = await v.validateAssignment({ userId: 1, shiftId: 9 });
    expect(r.ok).toBe(false);
    expect(r.violations[0].policyKey).toBe('manual_assignment_locked');
  });

  it('returns ok=true when no applicable policies', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 9,
            schedule_id: null,
            template_id: null,
            department_id: 1,
            date: '2026-04-25',
            start_time: '08:00',
            end_time: '16:00',
          },
        ],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple) // user_org_units empty
      .mockResolvedValueOnce([[], null] as Tuple); // listApplicable empty
    const v = new PolicyValidator(pool);
    const r = await v.validateAssignment({ userId: 1, shiftId: 9 });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('approved exception lifts violations', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 9,
            schedule_id: null,
            template_id: null,
            department_id: 1,
            date: '2026-04-25',
            start_time: '08:00',
            end_time: '16:00',
          },
        ],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ org_unit_id: 1 }], null] as Tuple)
      .mockResolvedValueOnce([
        [policyRow({ policy_key: 'manual_assignment_locked' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ c: 1 }], null] as Tuple);
    const v = new PolicyValidator(pool);
    const r = await v.validateAssignment({ userId: 1, shiftId: 9 });
    expect(r.ok).toBe(true);
    expect(r.violations[0].hasApprovedException).toBe(true);
  });

  it('non-blocking keys (e.g. min_rest_hours) emit no violation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 9,
            schedule_id: null,
            template_id: null,
            department_id: 1,
            date: '2026-04-25',
            start_time: '08:00',
            end_time: '16:00',
          },
        ],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([
        [policyRow({ policy_key: 'min_rest_hours' })],
        null,
      ] as Tuple);
    const v = new PolicyValidator(pool);
    const r = await v.validateAssignment({ userId: 1, shiftId: 9 });
    expect(r.violations).toHaveLength(0);
  });
});

/* ---------------- ApprovalMatrixService ---------------- */

describe('ApprovalMatrixService', () => {
  it('list returns rows mapped', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[matrixRow()], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const rows = await svc.list();
    expect(rows[0].changeType).toBe('Policy.Exception');
  });

  it('getByChangeType returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    expect(await svc.getByChangeType('X')).toBeNull();
  });

  it('update raises when not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    await expect(svc.update('X', { description: 'd' })).rejects.toThrow(/not found/);
  });

  it('update persists merged values', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[matrixRow()], null] as Tuple) // getByChangeType
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[matrixRow({ description: 'new' })], null] as Tuple); // refresh
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.update('Policy.Exception', { description: 'new' });
    expect(r.description).toBe('new');
  });

  it('resolves policy_owner scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[matrixRow()], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('Policy.Exception', { policyOwnerId: 5, actorUserId: 5 });
    expect(r.approverUserId).toBe(5);
    expect(r.autoApprove).toBe(true);
  });

  it('resolves unit_manager scope (found)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[matrixRow({ approver_scope: 'unit_manager' })], null] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 9 }], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { orgUnitId: 1, actorUserId: 9 });
    expect(r.approverUserId).toBe(9);
  });

  it('unit_manager returns null when no orgUnitId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[matrixRow({ approver_scope: 'unit_manager' })], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { actorUserId: 9 });
    expect(r.approverUserId).toBeNull();
  });

  it('unit_manager_chain walks parent chain', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager_chain' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: null, parent_id: 2 }], null] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 7, parent_id: null }], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { orgUnitId: 1, actorUserId: 0 });
    expect(r.approverUserId).toBe(7);
  });

  it('unit_manager_chain returns null when chain ends', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager_chain' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: null, parent_id: null }], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { orgUnitId: 1, actorUserId: 0 });
    expect(r.approverUserId).toBeNull();
  });

  it('unit_manager_chain returns null when unit missing', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager_chain' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { orgUnitId: 1, actorUserId: 0 });
    expect(r.approverUserId).toBeNull();
  });

  it('company_role finds first active', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'company_role', approver_role: 'admin' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { actorUserId: 1 });
    expect(r.approverUserId).toBe(1);
  });

  it('company_role returns null without role', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [matrixRow({ approver_scope: 'company_role', approver_role: null })],
      null,
    ] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { actorUserId: 1 });
    expect(r.approverUserId).toBeNull();
  });

  it('company_user uses explicit user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [matrixRow({ approver_scope: 'company_user', approver_user_id: 42 })],
      null,
    ] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    const r = await svc.resolve('X', { actorUserId: 42 });
    expect(r.approverUserId).toBe(42);
    expect(r.autoApprove).toBe(true);
  });

  it('throws when no row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalMatrixService(pool);
    await expect(svc.resolve('X', { actorUserId: 1 })).rejects.toThrow(/No approval matrix/);
  });
});

/* ---------------- EmployeeLoanService extended ---------------- */

describe('EmployeeLoanService extended', () => {
  it('refuses same-source/target', async () => {
    const { pool } = makePool();
    const svc = new EmployeeLoanService(pool);
    await expect(
      svc.create({
        userId: 7,
        fromOrgUnitId: 1,
        toOrgUnitId: 1,
        startDate: '2026-05-10',
        endDate: '2026-05-15',
        requestedBy: 99,
      })
    ).rejects.toThrow(/source and target unit must differ/);
  });

  it('list applies all filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[loanRow()], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    await svc.list({
      userId: 7,
      toOrgUnitId: 2,
      fromOrgUnitId: 1,
      status: 'pending',
    });
    expect(execute.mock.calls[0][0]).toMatch(/user_id/);
    expect(execute.mock.calls[0][0]).toMatch(/to_org_unit_id/);
    expect(execute.mock.calls[0][0]).toMatch(/from_org_unit_id/);
    expect(execute.mock.calls[0][0]).toMatch(/status/);
  });

  it('approve returns Forbidden when actor is not approver', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ change_type: 'Loan.Request', approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 5 }], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    await expect(svc.approve(1, 99)).rejects.toThrow(/Forbidden/);
  });

  it('approve raises when affected=0', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [loanRow({ id: 1, status: 'approved' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 99 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    await expect(svc.approve(1, 99)).rejects.toThrow(/Cannot approve/);
  });

  it('approve happy path notifies user', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 99 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [loanRow({ id: 1, status: 'approved' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            user_id: 7,
            type: 'loan.approved',
            title: 't',
            body: 'b',
            link: null,
            is_read: 0,
            created_at: 'x',
            read_at: null,
          },
        ],
        null,
      ] as Tuple);
    const svc = new EmployeeLoanService(pool);
    const r = await svc.approve(1, 99);
    expect(r.status).toBe('approved');
  });

  it('reject Forbidden / not found / wrong status', async () => {
    const { pool, execute } = makePool();
    const svc = new EmployeeLoanService(pool);

    execute.mockResolvedValueOnce([[], null] as Tuple);
    await expect(svc.reject(1, 1)).rejects.toThrow(/Loan not found/);

    execute
      .mockResolvedValueOnce([[loanRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 5 }], null] as Tuple);
    await expect(svc.reject(1, 99)).rejects.toThrow(/Forbidden/);

    execute
      .mockResolvedValueOnce([
        [loanRow({ id: 1, status: 'rejected' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 99 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);
    await expect(svc.reject(1, 99)).rejects.toThrow(/Cannot reject/);
  });

  it('reject happy notifies requester', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[loanRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([
        [matrixRow({ approver_scope: 'unit_manager' })],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 99 }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[loanRow({ id: 1, status: 'rejected' })], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            user_id: 99,
            type: 'loan.rejected',
            title: 't',
            body: null,
            link: null,
            is_read: 0,
            created_at: 'x',
            read_at: null,
          },
        ],
        null,
      ] as Tuple);
    const svc = new EmployeeLoanService(pool);
    const r = await svc.reject(1, 99, 'no');
    expect(r.status).toBe('rejected');
  });

  it('cancel succeeds', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[loanRow({ id: 1, status: 'cancelled' })], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    const r = await svc.cancel(1, 99);
    expect(r.status).toBe('cancelled');
  });

  it('cancel branches: not found, forbidden, wrong status', async () => {
    const { pool, execute } = makePool();
    const svc = new EmployeeLoanService(pool);

    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    await expect(svc.cancel(1, 99)).rejects.toThrow(/Loan not found/);

    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[loanRow({ id: 1, requested_by: 5 })], null] as Tuple);
    await expect(svc.cancel(1, 99)).rejects.toThrow(/Forbidden/);

    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([
        [loanRow({ id: 1, requested_by: 99, status: 'rejected' })],
        null,
      ] as Tuple);
    await expect(svc.cancel(1, 99)).rejects.toThrow(/Cannot cancel/);
  });

  it('isOnLoan zero when count missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 0 }], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    expect(await svc.isOnLoan(7, 2, '2026-05-12')).toBe(false);
  });

  it('getById returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new EmployeeLoanService(pool);
    expect(await svc.getById(99)).toBeNull();
  });
});

/* ---------------- OrgUnitService extended ---------------- */

describe('OrgUnitService extended', () => {
  it('getById returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    expect(await svc.getById(1)).toBeNull();
  });

  it('create rejects unknown parent', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    await expect(svc.create({ name: 'X', parentId: 9 })).rejects.toThrow(/parent org unit not found/);
  });

  it('create with valid parent succeeds', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow({ id: 5 })], null] as Tuple)
      .mockResolvedValueOnce([{ insertId: 11 }, null] as Tuple)
      .mockResolvedValueOnce([[orgUnitRow({ id: 11, parent_id: 5 })], null] as Tuple);
    const svc = new OrgUnitService(pool);
    const r = await svc.create({ name: 'C', parentId: 5 });
    expect(r.id).toBe(11);
  });

  it('update detects cycles', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow({ id: 1 })], null] as Tuple) // existing
      .mockResolvedValueOnce([[{ parent_id: 1 }], null] as Tuple); // cycle
    const svc = new OrgUnitService(pool);
    await expect(svc.update(1, { parentId: 2 })).rejects.toThrow(/cycle detected/);
  });

  it('update rejects when parent missing in walk', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    await expect(svc.update(1, { parentId: 2 })).rejects.toThrow(/parent org unit not found/);
  });

  it('update merges and persists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[{ parent_id: null }], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([
        [orgUnitRow({ id: 1, name: 'Renamed', parent_id: 2 })],
        null,
      ] as Tuple);
    const svc = new OrgUnitService(pool);
    const r = await svc.update(1, { parentId: 2, name: 'Renamed', isActive: false });
    expect(r.name).toBe('Renamed');
  });

  it('update without parent change still updates', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[orgUnitRow({ id: 1, name: 'New' })], null] as Tuple);
    const svc = new OrgUnitService(pool);
    const r = await svc.update(1, { name: 'New' });
    expect(r.name).toBe('New');
  });

  it('update raises when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    await expect(svc.update(1, {})).rejects.toThrow(/Org unit not found/);
  });

  it('remove raises when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    await expect(svc.remove(1)).rejects.toThrow(/Org unit not found/);
  });

  it('remove deletes', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[orgUnitRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);
    const svc = new OrgUnitService(pool);
    await svc.remove(1);
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM org_units/);
  });

  it('listMembers, listForUser, getPrimary', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[memberRow()], null] as Tuple)
      .mockResolvedValueOnce([[memberRow()], null] as Tuple)
      .mockResolvedValueOnce([[orgUnitRow()], null] as Tuple);
    const svc = new OrgUnitService(pool);
    expect((await svc.listMembers(1)).length).toBe(1);
    expect((await svc.listForUser(7)).length).toBe(1);
    expect((await svc.getPrimaryUnitForUser(7))?.id).toBe(1);
  });

  it('getPrimary returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    expect(await svc.getPrimaryUnitForUser(7)).toBeNull();
  });

  it('addMember (primary) demotes others, returns row', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // demote
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT
    execute.mockResolvedValueOnce([[memberRow()], null] as Tuple);
    const svc = new OrgUnitService(pool);
    const r = await svc.addMember(7, 1, true);
    expect(r.userId).toBe(7);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('addMember (non-primary) does not demote', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[memberRow({ is_primary: 0 })], null] as Tuple);
    const svc = new OrgUnitService(pool);
    const r = await svc.addMember(7, 1, false);
    expect(r.isPrimary).toBe(false);
  });

  it('addMember rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new OrgUnitService(pool);
    await expect(svc.addMember(7, 1, true)).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('addMember raises when refresh empty', async () => {
    const { pool, execute, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new OrgUnitService(pool);
    await expect(svc.addMember(7, 1, true)).rejects.toThrow(/Membership not found/);
  });

  it('removeMember executes delete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);
    const svc = new OrgUnitService(pool);
    await svc.removeMember(7, 1);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM user_org_units/);
  });
});
