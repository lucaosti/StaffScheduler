/**
 * TimeOffService unit tests (F02).
 *
 * Uses a queueable mysql2 Pool fake. Each test queues the result tuples the
 * service is expected to consume (via `pool.execute` / `pool.getConnection`)
 * and asserts the surfaced behaviour: validation, listing, approve/reject
 * state machine, and cancel ownership rules.
 *
 * create()/approve()/reject() now also drive the shared
 * ApprovalEngineService (pending_approvals) — see approvalEngine.service.test.ts
 * for that engine's own unit tests. Here, `getWorkflowByChangeType` is left
 * to resolve "not found" (empty rows) by default so tests that aren't about
 * the workflow-creation path don't need to mock its extra queries.
 */

import { TimeOffService } from '../services/TimeOffService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  start_date: '2026-05-10',
  end_date: '2026-05-15',
  type: 'vacation',
  reason: 'Beach',
  status: 'pending',
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  unavailability_id: null,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const buildPendingApprovalRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: 1,
  employee_loan_id: null,
  shift_swap_request_id: null,
  workflow_id: 10,
  step_id: 20,
  step_order: 1,
  assigned_to_user_id: 99,
  assigned_to_org_unit_id: null,
  open_to_structure: 0,
  decided_by_user_id: null,
  status: 'pending',
  decided_at: null,
  decision_note: null,
  escalated_at: null,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], null]);
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

describe('TimeOffService.create', () => {
  it('rejects when endDate is before startDate', async () => {
    const { pool } = makePool();
    const service = new TimeOffService(pool);
    await expect(
      service.create({ userId: 1, startDate: '2026-05-10', endDate: '2026-05-09' })
    ).rejects.toThrow(/endDate must be on or after/);
  });

  it('inserts a pending request and skips pending_approval creation when no workflow is configured', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // getWorkflowByChangeType('TimeOff.Request') -> not found (checked before insert)
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple) // INSERT time_off_requests
      .mockResolvedValueOnce([[buildRow({ id: 42 })], null] as Tuple) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null] as Tuple); // audit insert

    const service = new TimeOffService(pool);
    const created = await service.create({
      userId: 7,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      type: 'vacation',
      reason: 'Beach',
    });

    expect(created.id).toBe(42);
    expect(created.status).toBe('pending');
    expect(execute.mock.calls[1][0]).toMatch(/INSERT INTO time_off_requests/);
  });

  it('rejects creation when the workflow exists but no approver can be resolved', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 10, change_type: 'TimeOff.Request', require_all: 0, description: null }], null] as Tuple) // getWorkflowByChangeType
      .mockResolvedValueOnce([
        [
          {
            id: 20,
            workflow_id: 10,
            step_order: 1,
            approver_scope: 'unit_manager',
            approver_role_id: null,
            approver_user_id: null,
            approver_permission_code: null,
            auto_approve_for_owner: 1,
            escalate_after_hours: 48,
          },
        ],
        null,
      ] as Tuple) // hydrate workflow steps
      .mockResolvedValueOnce([[], null] as Tuple); // resolvePrimaryOrgUnitForUser -> no membership

    const service = new TimeOffService(pool);
    await expect(
      service.create({ userId: 7, startDate: '2026-05-10', endDate: '2026-05-15' })
    ).rejects.toThrow(/No approver could be resolved/);
    // The entity row must never have been inserted.
    const insertCalls = execute.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO time_off_requests'));
    expect(insertCalls).toHaveLength(0);
  });
});

describe('TimeOffService.approve', () => {
  it('refuses to approve a request that is not pending', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'approved' })], null] as Tuple); // getById

    const service = new TimeOffService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve request in status 'approved'/);
  });

  it('throws when no pending_approval row exists for the request', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[], null] as Tuple); // findPendingApprovalId -> none

    const service = new TimeOffService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/No pending approval found/);
  });

  /** Queues the pool.execute calls approve()'s upfront `wouldBeFinalStep`
   *  check makes — getPendingApprovalById, then the next-step lookup (empty
   *  => final). The request itself (unavailability insert) is now validated
   *  and applied entirely inside the transaction, before decidePendingApproval
   *  is ever called. */
  const queueApprovePreChecks = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null] as Tuple) // wouldBeFinalStep: getPendingApprovalById
      .mockResolvedValueOnce([[], null] as Tuple); // wouldBeFinalStep: next-step lookup -> none (final)
  };

  it('refuses when the caller is not the assignee', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple); // findPendingApprovalId
    queueApprovePreChecks(execute);
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability -> none
      .mockResolvedValueOnce([{ insertId: 555 }, null] as Tuple); // INSERT user_unavailability
    // decidePendingApproval's own getPendingApprovalById sees a different assignee.
    execute.mockResolvedValueOnce([[buildPendingApprovalRow({ assigned_to_user_id: 5 })], null] as Tuple);

    const service = new TimeOffService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Not authorized/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('writes the unavailability row and links it back to the request', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple); // findPendingApprovalId
    queueApprovePreChecks(execute);
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability -> none
      .mockResolvedValueOnce([{ insertId: 555 }, null] as Tuple); // INSERT user_unavailability
    execute
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null] as Tuple) // engine.getPendingApprovalById (pre-decision)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[buildPendingApprovalRow({ status: 'approved', decided_by_user_id: 99 })], null] as Tuple); // getPendingApprovalById (post-decision)
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple); // UPDATE time_off_requests
    execute.mockResolvedValueOnce([[buildRow({ status: 'approved', unavailability_id: 555 })], null] as Tuple); // final getById

    const service = new TimeOffService(pool);
    const result = await service.approve(1, 99, 'OK');

    expect(result.status).toBe('approved');
    expect(result.unavailabilityId).toBe(555);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});

describe('TimeOffService.reject', () => {
  it('rejects only when status is pending', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({ status: 'approved' })], null] as Tuple); // getById

    const service = new TimeOffService(pool);
    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject request in status 'approved'/);
  });

  it('rejects a pending request end to end', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null] as Tuple) // engine.getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[buildPendingApprovalRow({ status: 'rejected', decided_by_user_id: 99 })], null] as Tuple) // post-decision fetch
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE time_off_requests
      .mockResolvedValueOnce([[buildRow({ status: 'rejected' })], null] as Tuple); // final getById

    const service = new TimeOffService(pool);
    const result = await service.reject(1, 99);
    expect(result.status).toBe('rejected');
  });
});

describe('TimeOffService.cancel', () => {
  it('forbids cancelling a request belonging to a different user', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ user_id: 7, status: 'pending' })], null] as Tuple);

    const service = new TimeOffService(pool);
    await expect(service.cancel(1, 999)).rejects.toThrow(/Forbidden/);
  });
});

// ── Workflow attachment, non-final steps and diagnosis arms ──────────────────
// Mirrors the ShiftSwapService companion suite: engine interactions are spied
// at the instance boundary so each test pins TimeOffService's orchestration
// (the engine's own behaviour has a dedicated suite).

const engineOf = (service: TimeOffService) =>
  (service as unknown as { engine: Record<string, jest.Mock> }).engine as unknown as {
    getWorkflowByChangeType: (t: string) => unknown;
    resolvePrimaryOrgUnitForUser: (u: number) => unknown;
    canCreatePendingApprovalForStep: (s: unknown, c: unknown) => unknown;
    createPendingApprovalForStep: (w: number, s: unknown, l: unknown, c: unknown) => unknown;
    wouldBeFinalStep: (id: number) => unknown;
    decidePendingApproval: (...a: unknown[]) => unknown;
  };

const timeOffWorkflow = {
  id: 10,
  changeType: 'TimeOff.Request',
  requireAll: false,
  description: null,
  steps: [{ id: 20, workflowId: 10, stepOrder: 1, approverScope: 'unit_structure' }],
};

const spyWorkflowCreation = (service: TimeOffService, paResult: unknown) => {
  const engine = engineOf(service);
  jest.spyOn(engine, 'getWorkflowByChangeType').mockResolvedValue(timeOffWorkflow as never);
  jest.spyOn(engine, 'resolvePrimaryOrgUnitForUser').mockResolvedValue(3 as never);
  jest.spyOn(engine, 'canCreatePendingApprovalForStep').mockResolvedValue(true as never);
  return jest.spyOn(engine, 'createPendingApprovalForStep').mockResolvedValue(paResult as never);
};

describe('TimeOffService.create — workflow attachment', () => {
  it('attaches the first-step pending approval', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null]) // INSERT
      .mockResolvedValueOnce([[buildRow({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1 }, null]); // audit

    const service = new TimeOffService(pool);
    const createPa = spyWorkflowCreation(service, { id: 501 });

    const created = await service.create({
      userId: 7,
      startDate: '2026-05-10',
      endDate: '2026-05-15',
      type: 'vacation',
    });

    expect(created.id).toBe(42);
    expect(createPa).toHaveBeenCalledWith(
      10,
      timeOffWorkflow.steps[0],
      { timeOffRequestId: 42 },
      { actorUserId: 7, orgUnitId: 3 }
    );
  });

  it('deletes the stranded request when approver resolution changes mid-flight', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 42 }, null]) // INSERT
      .mockResolvedValueOnce([[buildRow({ id: 42 })], null]) // getById
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // audit
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // cleanup DELETE

    const service = new TimeOffService(pool);
    spyWorkflowCreation(service, null);

    await expect(
      service.create({ userId: 7, startDate: '2026-05-10', endDate: '2026-05-15', type: 'vacation' })
    ).rejects.toThrow(/approver resolution changed during creation/);

    const deleteCall = execute.mock.calls[execute.mock.calls.length - 1];
    expect(deleteCall[0]).toContain('DELETE FROM time_off_requests');
    expect(deleteCall[1]).toEqual([42]);
  });
});

describe('TimeOffService.approve — steps and diagnosis', () => {
  it('refuses when no pending approval row exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null]) // getById
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId -> none

    await expect(new TimeOffService(pool).approve(1, 99)).rejects.toThrow(
      'No pending approval found for this time-off request'
    );
  });

  it('records a non-final decision without touching unavailability', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([[buildRow()], null]); // refreshed getById

    const service = new TimeOffService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(false as never);
    const decide = jest
      .spyOn(engine, 'decidePendingApproval')
      .mockImplementation(async (...args: unknown[]) => {
        await (args[4] as () => Promise<unknown>)();
        return undefined as never;
      });

    const result = await service.approve(1, 99, 'first sign-off');

    expect(result.status).toBe('pending');
    expect(decide).toHaveBeenCalledWith(501, 99, 'approved', 'first sign-off', expect.any(Function));
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('non-final approve throws when the refreshed row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null])
      .mockResolvedValueOnce([[], null]); // refreshed getById: gone

    const service = new TimeOffService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(false as never);
    jest.spyOn(engine, 'decidePendingApproval').mockResolvedValue(undefined as never);

    await expect(service.approve(1, 99)).rejects.toThrow('Failed to retrieve time-off request');
  });

  it('throws 404 when the locked re-read finds the row gone', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null]);
    conn.execute.mockResolvedValueOnce([[], null]); // FOR UPDATE -> gone

    const service = new TimeOffService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);

    await expect(service.approve(1, 99)).rejects.toThrow('Time-off request not found');
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('throws 409 when the row was decided between the auth check and the lock', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null]);
    conn.execute.mockResolvedValueOnce([[buildRow({ status: 'approved' })], null]);

    const service = new TimeOffService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);

    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve request in status 'approved'/);
  });

  it('blocks approval when the user already has unavailability for the same dates', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null])
      .mockResolvedValueOnce([[{ id: 501 }], null]);
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null]) // FOR UPDATE
      .mockResolvedValueOnce([[{ id: 77 }], null]); // duplicate unavailability

    const service = new TimeOffService(pool);
    jest.spyOn(engineOf(service), 'wouldBeFinalStep').mockResolvedValue(true as never);

    await expect(service.approve(1, 99)).rejects.toThrow(/already has unavailability recorded/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('TimeOffService.reject — diagnosis arms', () => {
  const rejectWith = (updateResult: unknown, refetchRows: unknown[]) => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null]) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null]) // findPendingApprovalId
      .mockResolvedValueOnce([updateResult, null]); // guarded UPDATE
    for (const rows of refetchRows) execute.mockResolvedValueOnce([rows, null]);
    const service = new TimeOffService(pool);
    jest.spyOn(engineOf(service), 'decidePendingApproval').mockImplementation(async (...args: unknown[]) => {
      await (args[4] as () => Promise<unknown>)();
      return undefined as never;
    });
    return service;
  };

  it('diagnoses a concurrent decision via the current row status', async () => {
    const service = rejectWith({ affectedRows: 0 }, [[buildRow({ status: 'approved' })]]);
    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject request in status 'approved'/);
  });

  it('falls back to the pre-check status when the row vanished', async () => {
    const service = rejectWith({ affectedRows: 0 }, [[]]);
    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject request in status 'pending'/);
  });

  it('throws an internal error when the rejected row cannot be re-read', async () => {
    const service = rejectWith({ affectedRows: 1 }, [[]]);
    await expect(service.reject(1, 99)).rejects.toThrow('Failed to retrieve rejected request');
  });
});

describe('TimeOffService — residual arms', () => {
  it('final approve materializes unavailability and scopes the decision to the reviewer', async () => {
    const { pool, execute, conn } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null]) // getById (auth check)
      .mockResolvedValueOnce([[{ id: 501 }], null]); // findPendingApprovalId
    conn.execute
      .mockResolvedValueOnce([[buildRow()], null]) // FOR UPDATE
      .mockResolvedValueOnce([[], null]) // duplicate unavailability -> none
      .mockResolvedValueOnce([{ insertId: 88 }, null]) // INSERT user_unavailability
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE time_off_requests
    execute
      .mockResolvedValueOnce([[buildRow({ status: 'approved', unavailability_id: 88 })], null]) // final getById
      .mockResolvedValueOnce([{ insertId: 1 }, null]); // audit

    const service = new TimeOffService(pool);
    const engine = engineOf(service);
    jest.spyOn(engine, 'wouldBeFinalStep').mockResolvedValue(true as never);
    const decide = jest
      .spyOn(engine, 'decidePendingApproval')
      .mockImplementation(async (...args: unknown[]) => {
        const ctx = await (args[4] as () => Promise<{ actorUserId: number }>)();
        expect(ctx).toEqual({ actorUserId: 99 });
        return undefined as never;
      });

    const approved = await service.approve(1, 99, 'enjoy');

    expect(approved.status).toBe('approved');
    expect(decide).toHaveBeenCalledWith(501, 99, 'approved', 'enjoy', expect.any(Function));
    expect(conn.commit).toHaveBeenCalled();
  });

  it('reject refuses when no pending approval row exists', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null]) // getById
      .mockResolvedValueOnce([[], null]); // findPendingApprovalId -> none

    await expect(new TimeOffService(pool).reject(1, 99)).rejects.toThrow(
      'No pending approval found for this time-off request'
    );
  });
});
