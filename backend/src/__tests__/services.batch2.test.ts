/**
 * Service coverage batch 2 — fills gaps not hit by existing service test files:
 *   AuditLogService    — before/after snapshot JSON.parse catch (lines 65, 68)
 *   OrgUnitService     — post-create null check (line 129),
 *                        post-update null check (line 179)
 *   ShiftSwapService   — approve: swap not found (159), row mismatch (177),
 *                        null refresh after approve (237);
 *                        decline: null refresh after decline (258);
 *                        cancel: null refresh after cancel (276)
 *   DepartmentService  — post-update null check (lines 283-284)
 *   ApprovalEngineService — post-create null (122), post-update null (165)
 *
 * @author Luca Ostinelli
 */

// ── AuditLogService ───────────────────────────────────────────────────────────

import { AuditLogService } from '../services/AuditLogService';
import { OrgUnitService } from '../services/OrgUnitService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { DepartmentService } from '../services/DepartmentService';
import { ApprovalEngineService } from '../services/ApprovalEngineService';

jest.mock('../services/ComplianceEngine', () => ({
  evaluateAssignmentCompliance: jest.fn().mockResolvedValue({ ok: true, violations: [] }),
}));

type Tuple = [unknown, unknown];

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

// ─────────────────────────────────────────────────────────────────────────────
// AuditLogService — JSON.parse catch in mapRow (before_snapshot / after_snapshot)
// ─────────────────────────────────────────────────────────────────────────────

describe('AuditLogService.list — snapshot JSON.parse catch', () => {
  it('returns null for before_snapshot and after_snapshot when JSON is invalid', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null] as Tuple) // COUNT
      .mockResolvedValueOnce([[{
        id: 1,
        timestamp: 't',
        user_id: 1,
        user_email: 'a@b',
        action: 'create',
        entity_type: 'shift',
        entity_id: 1,
        description: 'created',
        before_snapshot: '{invalid json',
        after_snapshot: '{also invalid',
        ip_address: null,
      }], null] as Tuple); // SELECT rows
    const svc = new AuditLogService(pool);
    const result = await svc.list();
    expect(result.items[0].beforeSnapshot).toBeNull();
    expect(result.items[0].afterSnapshot).toBeNull();
  });

  it('returns parsed object when JSON is valid', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null] as Tuple) // COUNT
      .mockResolvedValueOnce([[{
        id: 2,
        timestamp: 't',
        user_id: 1,
        user_email: 'a@b',
        action: 'update',
        entity_type: 'shift',
        entity_id: 2,
        description: 'updated',
        before_snapshot: '{"key":"old"}',
        after_snapshot: '{"key":"new"}',
        ip_address: null,
      }], null] as Tuple); // SELECT rows
    const svc = new AuditLogService(pool);
    const result = await svc.list();
    expect(result.items[0].beforeSnapshot).toEqual({ key: 'old' });
    expect(result.items[0].afterSnapshot).toEqual({ key: 'new' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OrgUnitService — post-create / post-update null guard
// ─────────────────────────────────────────────────────────────────────────────

describe('OrgUnitService.create — null after insert', () => {
  it('throws Failed to create org unit when getById returns null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[], null] as Tuple);              // getById → null
    const svc = new OrgUnitService(pool);
    await expect(svc.create({ name: 'Root' })).rejects.toThrow('Failed to create org unit');
  });
});

describe('OrgUnitService.update — null after update', () => {
  it('throws Failed to refresh org unit when getById returns null after UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, name: 'A', description: null, parent_id: null, manager_user_id: null, is_active: 1, created_at: 't', updated_at: 't' }], null] as Tuple) // getById (existing)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById (refresh) → null
    const svc = new OrgUnitService(pool);
    await expect(svc.update(1, { name: 'B' })).rejects.toThrow('Failed to refresh org unit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ShiftSwapService — error paths
// ─────────────────────────────────────────────────────────────────────────────

const swapRow = {
  id: 1,
  requester_user_id: 10,
  requester_assignment_id: 100,
  target_user_id: 20,
  target_assignment_id: 200,
  status: 'pending',
  notes: null,
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  created_at: 't',
  updated_at: 't',
};

const pendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: null,
  shift_swap_request_id: 1,
  workflow_id: 10,
  step_id: 20,
  step_order: 1,
  assigned_to_user_id: 5,
  assigned_to_org_unit_id: null,
  open_to_structure: 0,
  decided_by_user_id: null,
  status: 'pending',
  decided_at: null,
  decision_note: null,
  escalated_at: null,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

/** Queues the pool.execute calls the pre-transaction authorization path
 *  makes before ShiftSwapService.approve opens its conn-based transaction:
 *  getById, findPendingApprovalId, the upfront wouldBeFinalStep check
 *  (getPendingApprovalById + next-step lookup). The swap itself is now
 *  validated and applied entirely inside the transaction, before
 *  decidePendingApproval is ever called. */
const queueApprovePreChecks = (execute: jest.Mock) => {
  execute
    .mockResolvedValueOnce([[swapRow], null] as Tuple) // getById
    .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
    .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // wouldBeFinalStep: getPendingApprovalById
    .mockResolvedValueOnce([[], null] as Tuple); // wouldBeFinalStep: next-step lookup -> none (final)
};

/** Queues the pool.execute calls ApprovalEngineService.decidePendingApproval
 *  makes once the swap itself has already been validated and applied inside
 *  the transaction — pre-fetch, guarded UPDATE, next-step lookup (none,
 *  since ShiftSwap.Request is single-step), and the post-decision fetch. */
const queueDecideApproved = (execute: jest.Mock) => {
  execute
    .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
    .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
    .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
    .mockResolvedValueOnce([[pendingApprovalRow({ status: 'approved' })], null] as Tuple); // post-decision fetch
};

describe('ShiftSwapService.approve — error paths', () => {
  it('throws Shift swap request not found when getById returns empty', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getById -> empty, short-circuits before any transaction
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 5)).rejects.toThrow('Shift swap request not found');
  });

  it('throws Assignment row mismatch when pair SELECT IDs do not match the swap', async () => {
    const { pool, conn, execute } = makePool();
    queueApprovePreChecks(execute);
    conn.execute
      .mockResolvedValueOnce([[swapRow], null]) // SELECT swap → pending
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([[                 // pair query: 2 rows but neither matches
        { assignment_id: 999, user_id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
        { assignment_id: 888, user_id: 20, date: '2026-05-02', start_time: '09:00', end_time: '17:00' },
      ], null]);
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 5)).rejects.toThrow('Assignment row mismatch');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('throws Failed to retrieve approved swap when getById returns null after commit', async () => {
    const { pool, conn, execute } = makePool();
    queueApprovePreChecks(execute);
    conn.execute
      .mockResolvedValueOnce([[swapRow], null]) // SELECT swap
      .mockResolvedValueOnce([[], null]) // lock both users' current assignments
      .mockResolvedValueOnce([[                 // pair query: correct IDs
        { assignment_id: 100, user_id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
        { assignment_id: 200, user_id: 20, date: '2026-05-02', start_time: '09:00', end_time: '17:00' },
      ], null])
      .mockResolvedValueOnce([[], null]) // checkSwapCompliance: duplicate-assignment check -> none
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE assignment 100
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE assignment 200
    queueDecideApproved(execute);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE swap status
    // pool.execute for getById (post-transaction refresh) returns null
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ShiftSwapService(pool);
    await expect(svc.approve(1, 5)).rejects.toThrow('Failed to retrieve approved swap');
  });
});

describe('ShiftSwapService.decline — null refresh', () => {
  it('throws Failed to retrieve declined swap when getById returns null after UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[swapRow], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[pendingApprovalRow()], null] as Tuple) // getPendingApprovalById (pre)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[pendingApprovalRow({ status: 'rejected' })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE decline
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById → null
    const svc = new ShiftSwapService(pool);
    await expect(svc.decline(1, 5)).rejects.toThrow('Failed to retrieve declined swap');
  });
});

describe('ShiftSwapService.cancel — null refresh', () => {
  it('throws Failed to retrieve cancelled swap when getById returns null after UPDATE', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE cancel
      .mockResolvedValueOnce([[], null] as Tuple);                  // getById → null
    const svc = new ShiftSwapService(pool);
    await expect(svc.cancel(1, 10)).rejects.toThrow('Failed to retrieve cancelled swap');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DepartmentService — post-update null check
// ─────────────────────────────────────────────────────────────────────────────

describe('DepartmentService.updateDepartment — various update paths', () => {
  it('throws Department not found after update when getDepartmentById returns null', async () => {
    const { pool, conn, execute } = makePool();
    // isActive update only — no name check, no manager check
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE departments
    // getDepartmentById uses pool.execute → returns empty
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new DepartmentService(pool);
    await expect(svc.updateDepartment(1, { isActive: true })).rejects.toThrow('Department not found after update');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('covers orgUnitId update branch (lines 283-284)', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE departments
    execute.mockResolvedValueOnce([[], null] as Tuple);    // getDepartmentById → null
    const svc = new DepartmentService(pool);
    await expect(svc.updateDepartment(1, { orgUnitId: 5 })).rejects.toThrow('Department not found after update');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalEngineService — post-create / post-update null guards
// ─────────────────────────────────────────────────────────────────────────────

describe('ApprovalEngineService.createWorkflow — null after insert', () => {
  it('throws Failed to retrieve created workflow when getWorkflowById returns null', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ insertId: 42 }, null]); // INSERT workflow
    // getWorkflowById uses pool.execute
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalEngineService(pool);
    await expect(svc.createWorkflow({ changeType: 'Loan.Request', requireAll: false, steps: [] }))
      .rejects.toThrow('Failed to retrieve created workflow');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('ApprovalEngineService.updateWorkflow — null after update', () => {
  it('throws Workflow not found when getWorkflowById returns null after update', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE workflow
    // getWorkflowById uses pool.execute → returns null
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ApprovalEngineService(pool);
    await expect(svc.updateWorkflow(1, { requireAll: true })).rejects.toThrow('Workflow not found');
    expect(conn.rollback).toHaveBeenCalled();
  });
});
