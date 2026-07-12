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
      .mockResolvedValueOnce([{ insertId: 42 }, null] as Tuple) // INSERT time_off_requests
      .mockResolvedValueOnce([[buildRow({ id: 42 })], null] as Tuple) // getById
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null] as Tuple) // audit insert
      .mockResolvedValueOnce([[], null] as Tuple); // getWorkflowByChangeType('TimeOff.Request') -> not found

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
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO time_off_requests/);
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

  it('refuses when the caller is not the assignee', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability (dry run) -> none
      .mockResolvedValueOnce([[buildPendingApprovalRow({ assigned_to_user_id: 5 })], null] as Tuple); // engine.getPendingApprovalById

    const service = new TimeOffService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Not authorized/);
  });

  it('writes the unavailability row and links it back to the request', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // getById
      .mockResolvedValueOnce([[{ id: 501 }], null] as Tuple) // findPendingApprovalId
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability (dry run) -> none
      .mockResolvedValueOnce([[buildPendingApprovalRow()], null] as Tuple) // engine.getPendingApprovalById (pre-decision)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE pending_approvals
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[buildPendingApprovalRow({ status: 'approved', decided_by_user_id: 99 })], null] as Tuple) // getPendingApprovalById (post-decision)
      .mockResolvedValueOnce([[buildRow({ status: 'approved', unavailability_id: 555 })], null] as Tuple); // final getById

    conn.execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // checkNoDuplicateUnavailability (locked re-check) -> none
      .mockResolvedValueOnce([{ insertId: 555 }, null] as Tuple) // INSERT user_unavailability
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple); // UPDATE time_off_requests

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
