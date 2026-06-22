/**
 * ChangeRequestService unit tests.
 *
 * Covers: list (all filters, pagination), getById, create, approve,
 * reject, apply (attribution audit), cancel, and status-transition guards.
 *
 * @author Luca Ostinelli
 */

import { ChangeRequestService } from '../services/ChangeRequestService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_type: 'Schedule.Override',
  proposer_user_id: 10,
  target_entity_type: 'schedule',
  target_entity_id: 5,
  proposed_payload: JSON.stringify({ date: '2026-07-01', shiftId: 3 }),
  justification: 'Covering sick leave',
  status: 'pending',
  approver_user_id: null,
  approved_at: null,
  rejected_at: null,
  rejection_reason: null,
  applied_at: null,
  on_behalf_of_user_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('ChangeRequestService.list', () => {
  it('returns total and items without filters', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 2 }], null])
      .mockResolvedValueOnce([[buildRow(), buildRow({ id: 2 })], null]);

    const svc = new ChangeRequestService(pool);
    const { total, items } = await svc.list();
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
  });

  it('filters by proposerUserId', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ChangeRequestService(pool);
    await svc.list({ proposerUserId: 10 });

    const [countSql, params] = execute.mock.calls[0];
    expect(countSql).toContain('proposer_user_id = ?');
    expect(params).toContain(10);
  });

  it('filters by status', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow({ status: 'approved' })], null]);

    const svc = new ChangeRequestService(pool);
    await svc.list({ status: 'approved' });

    const [, params] = execute.mock.calls[0];
    expect(params).toContain('approved');
  });

  it('filters by changeType', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ChangeRequestService(pool);
    await svc.list({ changeType: 'Schedule.Override' });

    const [, params] = execute.mock.calls[0];
    expect(params).toContain('Schedule.Override');
  });

  it('maps proposed_payload JSON string to object', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ChangeRequestService(pool);
    const { items } = await svc.list();
    expect(items[0].proposedPayload).toEqual({ date: '2026-07-01', shiftId: 3 });
  });

  it('handles invalid JSON in proposed_payload gracefully', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow({ proposed_payload: 'not-json' })], null]);

    const svc = new ChangeRequestService(pool);
    const { items } = await svc.list();
    expect(items[0].proposedPayload).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe('ChangeRequestService.getById', () => {
  it('returns mapped change request when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);

    const svc = new ChangeRequestService(pool);
    const cr = await svc.getById(1);
    expect(cr).not.toBeNull();
    expect(cr!.id).toBe(1);
    expect(cr!.changeType).toBe('Schedule.Override');
    expect(cr!.status).toBe('pending');
    expect(cr!.proposerUserId).toBe(10);
  });

  it('returns null when not found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ChangeRequestService(pool);
    expect(await svc.getById(999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ChangeRequestService.create', () => {
  it('inserts a pending change request and returns it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 7, affectedRows: 1 }, null])  // INSERT change_request
      .mockResolvedValueOnce([[buildRow({ id: 7 })], null])               // getById
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }, null])   // audit.write
      .mockResolvedValueOnce([[], null]);                                  // getWorkflowByChangeType → no workflow

    const svc = new ChangeRequestService(pool);
    const cr = await svc.create(
      { changeType: 'Schedule.Override', targetEntityType: 'schedule', proposedPayload: { shift: 1 } },
      10
    );

    expect(cr.id).toBe(7);
    const [insertSql, insertParams] = execute.mock.calls[0];
    expect(insertSql).toContain("INSERT INTO change_requests");
    expect(insertSql).toContain("'pending'");
    expect(insertParams).toContain('Schedule.Override');
    expect(insertParams).toContain(10);
  });

  it('serialises proposedPayload as JSON', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])   // audit
      .mockResolvedValueOnce([[], null]);                                  // getWorkflowByChangeType → no workflow

    const svc = new ChangeRequestService(pool);
    await svc.create(
      { changeType: 'X', targetEntityType: 'y', proposedPayload: { key: 'value' } },
      5
    );

    const [, params] = execute.mock.calls[0];
    const payload = params.find((p: unknown) => typeof p === 'string' && p.includes('"key"'));
    expect(payload).toBeDefined();
    expect(JSON.parse(payload as string)).toEqual({ key: 'value' });
  });

  it('writes an audit log entry after creation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[], null]); // getWorkflowByChangeType → no workflow

    const svc = new ChangeRequestService(pool);
    await svc.create(
      { changeType: 'X', targetEntityType: 'y', proposedPayload: {} },
      5
    );

    expect(execute).toHaveBeenCalledTimes(4);
    const [auditSql] = execute.mock.calls[2];
    expect(auditSql).toContain('INSERT INTO audit_logs');
  });

  it('creates a pending_approval when a workflow is configured for the change type', async () => {
    const { pool, execute } = makePool();
    const workflowRow = {
      id: 1, change_type: 'Schedule.Override', require_all: 0, description: null,
      created_at: 't', updated_at: 't',
    };
    const stepRow = {
      id: 10, workflow_id: 1, step_order: 1, approver_scope: 'company_user',
      approver_role_id: null, approver_user_id: 20, approver_permission_code: null,
      auto_approve_for_owner: 0, escalate_after_hours: null,
    };
    execute
      .mockResolvedValueOnce([{ insertId: 7 }, null])          // INSERT change_request
      .mockResolvedValueOnce([[buildRow({ id: 7 })], null])     // getById
      .mockResolvedValueOnce([{ insertId: 99 }, null])          // audit.write
      .mockResolvedValueOnce([[workflowRow], null])              // getWorkflowByChangeType
      .mockResolvedValueOnce([[stepRow], null])                  // hydrateWorkflow steps
      .mockResolvedValueOnce([[stepRow], null])                  // resolveApproverForStep SELECT
      .mockResolvedValueOnce([{ insertId: 5 }, null]);          // INSERT pending_approvals

    const svc = new ChangeRequestService(pool);
    await svc.create(
      { changeType: 'Schedule.Override', targetEntityType: 'schedule', proposedPayload: {} },
      10
    );

    const lastCall = execute.mock.calls[execute.mock.calls.length - 1];
    expect(lastCall[0]).toContain('INSERT INTO pending_approvals');
    expect(lastCall[1]).toContain(7);   // change_request_id
    expect(lastCall[1]).toContain(1);   // workflow_id
    expect(lastCall[1]).toContain(20);  // assigned_to_user_id (company_user approver)
  });
});

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

describe('ChangeRequestService.approve', () => {
  it('transitions status to approved and sets approver_user_id', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])              // getById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])       // UPDATE
      .mockResolvedValueOnce([[buildRow({ status: 'approved', approver_user_id: 20 })], null]) // getById
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]); // audit

    const svc = new ChangeRequestService(pool);
    const cr = await svc.approve(1, 20, 'Looks good');
    expect(cr.status).toBe('approved');
    expect(cr.approverUserId).toBe(20);
  });

  it('throws when request is not in pending status', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'rejected' })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.approve(1, 20)).rejects.toThrow("Cannot approve");
  });

  it('throws not found when request does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.approve(999, 20)).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

describe('ChangeRequestService.reject', () => {
  it('transitions status to rejected with a reason', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ status: 'rejected', rejection_reason: 'Not justified' })], null])
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ChangeRequestService(pool);
    const cr = await svc.reject(1, 20, 'Not justified');
    expect(cr.status).toBe('rejected');
    expect(cr.rejectionReason).toBe('Not justified');

    const [updateSql, params] = execute.mock.calls[1];
    expect(updateSql).toContain("'rejected'");
    expect(params).toContain('Not justified');
  });

  it('throws when request is not in pending status', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'approved' })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.reject(1, 20, 'reason')).rejects.toThrow("Cannot reject");
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

describe('ChangeRequestService.apply', () => {
  it('transitions status to applied and records on_behalf_of_user_id', async () => {
    const { pool, execute } = makePool();
    const approvedRow = buildRow({ status: 'approved', approver_user_id: 20 });
    execute
      .mockResolvedValueOnce([[approvedRow], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ status: 'applied', on_behalf_of_user_id: 10 })], null])
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ChangeRequestService(pool);
    const cr = await svc.apply(1, 20);
    expect(cr.status).toBe('applied');
    expect(cr.onBehalfOfUserId).toBe(10); // proposer

    const [updateSql, updateParams] = execute.mock.calls[1];
    expect(updateSql).toContain("'applied'");
    // on_behalf_of_user_id should be set to proposer (10)
    expect(updateParams).toContain(10);
  });

  it('writes audit log with authority holder as actor and proposer as on_behalf_of', async () => {
    const { pool, execute } = makePool();
    const approvedRow = buildRow({ status: 'approved', approver_user_id: 20, proposer_user_id: 10 });
    execute
      .mockResolvedValueOnce([[approvedRow], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ status: 'applied' })], null])
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ChangeRequestService(pool);
    await svc.apply(1, 20);

    const [auditSql, auditParams] = execute.mock.calls[3];
    expect(auditSql).toContain('INSERT INTO audit_logs');
    // user_id (index 0) = authority holder (20)
    expect(auditParams[0]).toBe(20);
    // on_behalf_of_user_id (index 1) = proposer (10)
    expect(auditParams[1]).toBe(10);
  });

  it('throws when request is not in approved status', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'pending' })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.apply(1, 20)).rejects.toThrow('Cannot apply');
  });

  it('throws not found when request does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.apply(999, 20)).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('ChangeRequestService.cancel', () => {
  it('transitions status to cancelled', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ status: 'cancelled' })], null])
      .mockResolvedValue([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ChangeRequestService(pool);
    const cr = await svc.cancel(1, 10);
    expect(cr.status).toBe('cancelled');
  });

  it('throws when request is not in pending status', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'applied' })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.cancel(1, 10)).rejects.toThrow('Cannot cancel');
  });

  it('throws not found when request does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.cancel(999, 10)).rejects.toThrow('not found');
  });

  it('writes an audit entry after cancellation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[buildRow({ status: 'cancelled' })], null])
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new ChangeRequestService(pool);
    await svc.cancel(1, 10);

    const [auditSql] = execute.mock.calls[3];
    expect(auditSql).toContain('INSERT INTO audit_logs');
  });
});

// ---------------------------------------------------------------------------
// advancePendingApproval
// ---------------------------------------------------------------------------

const buildPaRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_request_id: 1,
  workflow_id: 1,
  step_id: 10,
  step_order: 1,
  assigned_to_user_id: 20,
  status: 'pending',
  decided_at: null,
  decision_note: null,
  escalated_at: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

describe('ChangeRequestService.advancePendingApproval', () => {
  it('throws not found when pending approval does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // getPendingApprovalById → null

    const svc = new ChangeRequestService(pool);
    await expect(svc.advancePendingApproval(99, 20, 'approved')).rejects.toThrow('not found');
  });

  it('throws when pending approval is not in pending status', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ status: 'approved' })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.advancePendingApproval(1, 20, 'approved')).rejects.toThrow('already approved');
  });

  it('throws when user is not the assigned approver', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 99 })], null]);

    const svc = new ChangeRequestService(pool);
    await expect(svc.advancePendingApproval(1, 20, 'approved')).rejects.toThrow('Not authorized');
  });

  it('rejects the change_request when decision is rejected', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow()], null])             // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])        // UPDATE pending_approval
      .mockResolvedValueOnce([[buildRow()], null])                // getById change_request
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])        // UPDATE change_request → rejected
      .mockResolvedValueOnce([{ insertId: 1 }, null])            // audit.write
      .mockResolvedValueOnce([[buildPaRow({ status: 'rejected' })], null])           // getPendingApprovalById (refresh)
      .mockResolvedValueOnce([[buildRow({ status: 'rejected' })], null]);            // getById (refresh)

    const svc = new ChangeRequestService(pool);
    const { changeRequest } = await svc.advancePendingApproval(1, 20, 'rejected', 'Not acceptable');
    expect(changeRequest.status).toBe('rejected');

    const [updateCrSql, updateCrParams] = execute.mock.calls[3];
    expect(updateCrSql).toContain("'rejected'");
    expect(updateCrParams).toContain('Not acceptable');
  });

  it('creates next pending_approval when an additional workflow step exists', async () => {
    const { pool, execute } = makePool();
    const nextStepRow = { id: 11, step_order: 2 };
    const nextStepFullRow = {
      id: 11, workflow_id: 1, step_order: 2, approver_scope: 'company_user',
      approver_role_id: null, approver_user_id: 30, approver_permission_code: null,
      auto_approve_for_owner: 0, escalate_after_hours: null,
    };
    execute
      .mockResolvedValueOnce([[buildPaRow()], null])             // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])        // UPDATE pending_approval → approved
      .mockResolvedValueOnce([[buildRow()], null])                // getById change_request
      .mockResolvedValueOnce([[nextStepRow], null])               // SELECT next step from approval_steps
      .mockResolvedValueOnce([[nextStepFullRow], null])           // resolveApproverForStep SELECT
      .mockResolvedValueOnce([{ insertId: 6 }, null])            // INSERT next pending_approval
      .mockResolvedValueOnce([[buildPaRow({ status: 'approved' })], null])  // getPendingApprovalById refresh
      .mockResolvedValueOnce([[buildRow()], null]);               // getById change_request refresh

    const svc = new ChangeRequestService(pool);
    await svc.advancePendingApproval(1, 20, 'approved');

    const insertCall = execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO pending_approvals')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain(30); // assigned to next step's approver
    expect(insertCall[1]).toContain(2);  // step_order = 2
  });

  it('approves the change_request when the final step is approved', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow()], null])             // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])        // UPDATE pending_approval → approved
      .mockResolvedValueOnce([[buildRow()], null])                // getById change_request
      .mockResolvedValueOnce([[], null])                         // SELECT next step → none (last step)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])        // UPDATE change_request → approved
      .mockResolvedValueOnce([{ insertId: 1 }, null])            // audit.write
      .mockResolvedValueOnce([[buildPaRow({ status: 'approved' })], null])           // getPendingApprovalById refresh
      .mockResolvedValueOnce([[buildRow({ status: 'approved', approver_user_id: 20 })], null]); // getById refresh

    const svc = new ChangeRequestService(pool);
    const { changeRequest } = await svc.advancePendingApproval(1, 20, 'approved');
    expect(changeRequest.status).toBe('approved');
    expect(changeRequest.approverUserId).toBe(20);

    const updateCrCall = execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes("'approved'") && sql.includes('change_requests')
    );
    expect(updateCrCall).toBeDefined();
    expect(updateCrCall[1]).toContain(20); // approver_user_id
  });
});
