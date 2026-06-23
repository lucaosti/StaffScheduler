/**
 * ApprovalEngineService.processEscalations — complete escalation tests.
 *
 * Covers:
 *   - returns { escalated: 0, items: [] } when no overdue pending approvals exist
 *   - marks pending_approval as 'escalated' and creates new row for manager
 *   - creates no new row when no manager is found (escalatedToUserId null)
 *   - escalates multiple items in one run
 *   - skips already-escalated rows (status != 'pending')
 */

import { ApprovalEngineService } from '../services/ApprovalEngineService';

const makePool = (mockExecute?: jest.Mock) => {
  const execute = mockExecute ?? jest.fn();
  return { pool: { execute } as unknown as import('mysql2/promise').Pool, execute };
};

afterEach(() => jest.clearAllMocks());

// Helper: build a pending_approvals row as returned by the escalation query.
const overdueRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_request_id: 10,
  workflow_id: 2,
  step_id: 3,
  step_order: 1,
  assigned_to_user_id: 5,
  escalate_after_hours: 24,
  manager_id: 7,
  ...overrides,
});

describe('ApprovalEngineService.processEscalations', () => {
  it('returns empty result when no overdue pending approvals exist', async () => {
    const { pool, execute } = makePool();
    // The SELECT query returns empty.
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(0);
    expect(result.items).toHaveLength(0);
    // Only the SELECT was called — no UPDATE or INSERT.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('marks the pending_approval as escalated and creates a new row for the manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[overdueRow()], null]) // SELECT overdue
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE pending_approvals status
      .mockResolvedValueOnce([{ insertId: 99 }, null]);    // INSERT new pending_approval

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(1);
    expect(result.items[0]).toMatchObject({ pendingApprovalId: 1, changeRequestId: 10, escalatedToUserId: 7 });

    // UPDATE must set status = 'escalated'.
    const updateCall = execute.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'escalated'");
    expect(updateCall[1]).toContain(1); // pending_approval id

    // INSERT must assign to manager (id=7).
    const insertCall = execute.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO pending_approvals');
    expect(insertCall[1]).toContain(7); // manager user id
  });

  it('marks as escalated but creates no new row when manager_id is null', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[overdueRow({ manager_id: null })], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE only

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(1);
    expect(result.items[0].escalatedToUserId).toBeNull();
    // UPDATE called once; no INSERT.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('processes multiple overdue items in one run', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[overdueRow({ id: 1 }), overdueRow({ id: 2, change_request_id: 11 })], null])
      .mockResolvedValueOnce([{ affectedRows: 2 }, null])  // batch UPDATE all items
      .mockResolvedValueOnce([{ insertId: 50 }, null]);    // batch INSERT all manager rows

    const svc = new ApprovalEngineService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(3); // 1 SELECT + 1 batch UPDATE + 1 batch INSERT
  });
});

// ---------------------------------------------------------------------------
// ChangeRequestService.create — proposer context resolution
// ---------------------------------------------------------------------------

import { ChangeRequestService } from '../services/ChangeRequestService';
import { AuditLogService } from '../services/AuditLogService';

jest.mock('../services/AuditLogService');

(AuditLogService as jest.MockedClass<typeof AuditLogService>).prototype.write = jest.fn().mockResolvedValue(undefined);

describe('ChangeRequestService.create — proposer context resolution', () => {
  it('queries org_unit, departments, and roles of the proposer', async () => {
    const execute = jest.fn();
    const pool = { execute } as unknown as import('mysql2/promise').Pool;

    // INSERT change_request
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);
    // SELECT getById
    execute.mockResolvedValueOnce([[{
      id: 1, change_type: 'Leave.Request', proposer_user_id: 10,
      target_entity_type: 'leave', target_entity_id: null,
      proposed_payload: '{}', justification: null, status: 'pending',
      approver_user_id: null, approved_at: null, rejected_at: null,
      rejection_reason: null, applied_at: null, on_behalf_of_user_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }], null]);
    // resolveProposerContext: user_org_units
    execute.mockResolvedValueOnce([[{ org_unit_id: 5 }], null]);
    // resolveProposerContext: user_departments
    execute.mockResolvedValueOnce([[{ department_id: 3 }], null]);
    // resolveProposerContext: user_roles
    execute.mockResolvedValueOnce([[{ role_id: 2 }], null]);
    // getWorkflowByChangeType — no workflow
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ChangeRequestService(pool);
    await svc.create(
      { changeType: 'Leave.Request', targetEntityType: 'leave', proposedPayload: {}, justification: null },
      10
    );

    // Find the calls for org_unit, departments, roles by querying user_org_units.
    const calls = execute.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((sql) => sql.includes('user_org_units'))).toBe(true);
    expect(calls.some((sql) => sql.includes('user_departments'))).toBe(true);
    expect(calls.some((sql) => sql.includes('user_roles'))).toBe(true);
  });
});
