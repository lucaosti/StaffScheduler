/**
 * PendingApprovalService unit tests.
 *
 * This service is pure read-side SQL + row mapping, so the tests focus on the
 * two things that can actually break: the SQL parameter wiring (status filter
 * present/absent, userId bound twice for the membership check) and the mapRow
 * projection, which must classify each row into exactly one of the four
 * entity types and synthesize changeType / proposedPayload / proposer /
 * justification from the type-specific joined columns.
 *
 * Every mapRow branch is exercised: all four entity types, JSON payloads
 * arriving as string vs. object vs. malformed string, changeType fallbacks,
 * and the null-coalescing chains for proposer and justification.
 */

import { PendingApprovalService } from '../services/PendingApprovalService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as unknown as import('mysql2/promise').Pool, execute };
};

// Base pending_approvals columns shared by all fixtures; entity-specific
// columns are added per test.
const baseRow = {
  id: 11,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: null,
  shift_swap_request_id: null,
  workflow_id: 2,
  step_id: 20,
  step_order: 1,
  assigned_to_user_id: 7,
  assigned_to_org_unit_id: null,
  open_to_structure: 0,
  decided_by_user_id: null,
  status: 'pending',
  decided_at: null,
  decision_note: null,
  escalated_at: null,
  created_at: new Date('2026-06-01'),
  updated_at: new Date('2026-06-02'),
};

describe('PendingApprovalService.listForUser', () => {
  it('binds userId twice and omits the status clause when no status is given', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[]]);

    const result = await new PendingApprovalService(pool).listForUser(7);

    expect(result).toEqual([]);
    const [sql, params] = execute.mock.calls[0];
    expect(params).toEqual([7, 7]);
    expect(sql).not.toContain('pa.status = ?');
  });

  it('appends the status filter and its parameter when a status is given', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[]]);

    await new PendingApprovalService(pool).listForUser(7, 'pending');

    const [sql, params] = execute.mock.calls[0];
    expect(params).toEqual([7, 7, 'pending']);
    expect(sql).toContain('pa.status = ?');
  });

  it('maps a change-request row, parsing a JSON-string payload', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      change_request_id: 5,
      cr_change_type: 'Policy.Update',
      cr_proposed_payload: '{"a":1}',
      cr_justification: 'because',
      cr_proposer_user_id: 3,
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);

    expect(item.targetEntityType).toBe('change_request');
    expect(item.targetEntityId).toBe(5);
    expect(item.changeType).toBe('Policy.Update');
    expect(item.proposedPayload).toEqual({ a: 1 });
    expect(item.justification).toBe('because');
    expect(item.proposerUserId).toBe(3);
  });

  it('keeps an already-parsed change-request payload object as-is', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      change_request_id: 5,
      cr_change_type: 'Policy.Update',
      cr_proposed_payload: { b: 2 },
      cr_proposer_user_id: 3,
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);
    expect(item.proposedPayload).toEqual({ b: 2 });
  });

  it('falls back to an empty payload when the JSON string is malformed', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      change_request_id: 5,
      cr_change_type: 'Policy.Update',
      cr_proposed_payload: '{not json',
      cr_proposer_user_id: 3,
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);
    expect(item.proposedPayload).toEqual({});
  });

  it('falls back to an empty payload when the payload column is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      change_request_id: 5,
      cr_change_type: 'Policy.Update',
      cr_proposed_payload: null,
      cr_proposer_user_id: 3,
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);
    expect(item.proposedPayload).toEqual({});
  });

  it('maps a time-off row with the synthetic TimeOff.Request change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      time_off_request_id: 9,
      tor_user_id: 4,
      tor_start_date: '2026-07-01',
      tor_end_date: '2026-07-03',
      tor_type: 'vacation',
      tor_reason: 'holidays',
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);

    expect(item.targetEntityType).toBe('time_off_request');
    expect(item.targetEntityId).toBe(9);
    expect(item.changeType).toBe('TimeOff.Request');
    expect(item.proposedPayload).toEqual({ startDate: '2026-07-01', endDate: '2026-07-03', type: 'vacation' });
    expect(item.proposerUserId).toBe(4);
    expect(item.justification).toBe('holidays');
  });

  it('maps an employee-loan row with the synthetic Loan.Request change type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      employee_loan_id: 13,
      el_user_id: 5,
      el_from_org_unit_id: 1,
      el_to_org_unit_id: 2,
      el_start_date: '2026-08-01',
      el_end_date: '2026-08-15',
      el_reason: 'coverage',
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);

    expect(item.targetEntityType).toBe('employee_loan');
    expect(item.targetEntityId).toBe(13);
    expect(item.changeType).toBe('Loan.Request');
    expect(item.proposedPayload).toEqual({ fromOrgUnitId: 1, toOrgUnitId: 2, startDate: '2026-08-01', endDate: '2026-08-15' });
    expect(item.justification).toBe('coverage');
  });

  it('maps a shift-swap row (the fall-through entity type) with its payload and notes', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{
      ...baseRow,
      shift_swap_request_id: 21,
      ssr_requester_user_id: 6,
      ssr_requester_assignment_id: 100,
      ssr_target_assignment_id: 200,
      ssr_notes: 'please',
      assigned_to_org_unit_id: 3,
      open_to_structure: 1,
      decided_by_user_id: 8,
      decision_note: 'ok',
    }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);

    expect(item.targetEntityType).toBe('shift_swap_request');
    expect(item.changeType).toBe('ShiftSwap.Request');
    expect(item.proposedPayload).toEqual({ requesterAssignmentId: 100, targetAssignmentId: 200 });
    expect(item.proposerUserId).toBe(6);
    expect(item.justification).toBe('please');
    // Nullable columns pass through, booleans normalize.
    expect(item.openToStructure).toBe(true);
    expect(item.assignedToOrgUnitId).toBe(3);
    expect(item.decidedByUserId).toBe(8);
    expect(item.decisionNote).toBe('ok');
  });

  it('degrades safely on a row with no entity id at all (defensive fall-through)', async () => {
    // Exactly one *_id column is set per row by construction, but the mapper
    // must not crash if a corrupt row slips through: it falls through to the
    // shift-swap branch with a null target id and null assignee.
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ ...baseRow, assigned_to_user_id: null }]]);

    const [item] = await new PendingApprovalService(pool).listForUser(7);

    expect(item.targetEntityType).toBe('shift_swap_request');
    expect(item.targetEntityId).toBeNull();
    expect(item.assignedToUserId).toBeNull();
    expect(item.changeType).toBe('ShiftSwap.Request');
  });
});

describe('PendingApprovalService.countForUser', () => {
  it('returns the count with userId bound twice', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 4 }]]);

    const count = await new PendingApprovalService(pool).countForUser(7);

    expect(count).toBe(4);
    expect(execute.mock.calls[0][1]).toEqual([7, 7]);
  });

  it('falls back to 0 when the count column is null', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: null }]]);

    const count = await new PendingApprovalService(pool).countForUser(7);
    expect(count).toBe(0);
  });
});
