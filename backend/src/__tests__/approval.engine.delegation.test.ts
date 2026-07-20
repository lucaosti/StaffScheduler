/**
 * ApprovalEngineService — structure-vs-person decision delegation.
 *
 * Covers the generic machinery shared by change requests, time-off, loans,
 * and shift swaps: assigning a decision to a structure (org unit) instead of
 * a person, the structure head keeping/delegating/opening it, the resulting
 * chain-of-command record, and the updated "may this user decide it"
 * authorization check (assignee, or any member once opened).
 */

import { ApprovalEngineService } from '../services/ApprovalEngineService';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

const buildPaRow = (overrides: Record<string, unknown> = {}) => ({
  id: 501,
  change_request_id: null,
  time_off_request_id: null,
  employee_loan_id: null,
  shift_swap_request_id: 1,
  workflow_id: 10,
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
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const structureStep = {
  id: 20,
  workflowId: 10,
  stepOrder: 1,
  approverScope: 'unit_structure' as const,
  approverRoleId: null,
  approverUserId: null,
  approverPermissionCode: null,
  autoApproveForOwner: false,
  escalateAfterHours: null,
};

const personStep = {
  ...structureStep,
  approverScope: 'company_user' as const,
  approverUserId: 42,
};

describe('ApprovalEngineService.createPendingApprovalForStep', () => {
  it('assigns to the org unit and defaults assignee to its head for a unit_structure step', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // findUnitManager
      .mockResolvedValueOnce([{ insertId: 501 }, null] as Tuple) // INSERT pending_approvals
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple); // getPendingApprovalById

    const engine = new ApprovalEngineService(pool);
    const pa = await engine.createPendingApprovalForStep(
      10,
      structureStep,
      { shiftSwapRequestId: 1 },
      { actorUserId: 7, orgUnitId: 3 }
    );

    expect(pa?.assignedToOrgUnitId).toBe(3);
    expect(pa?.assignedToUserId).toBe(30);
    const insertCall = execute.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO pending_approvals');
    expect(insertCall[1]).toContain(3); // assigned_to_org_unit_id
    expect(insertCall[1]).toContain(30); // assigned_to_user_id (defaulted to head)
  });

  it('throws when a unit_structure step has no org unit context', async () => {
    const { pool } = makePool();
    const engine = new ApprovalEngineService(pool);
    await expect(
      engine.createPendingApprovalForStep(10, structureStep, { shiftSwapRequestId: 1 }, { actorUserId: 7 })
    ).rejects.toThrow(/requires an org unit/);
  });

  it('assigns directly to the resolved person for a non-structure step, with no org unit', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 502 }, null] as Tuple) // INSERT (company_user needs no resolve query)
      .mockResolvedValueOnce([[buildPaRow({ id: 502, assigned_to_user_id: 42 })], null] as Tuple);

    const engine = new ApprovalEngineService(pool);
    const pa = await engine.createPendingApprovalForStep(
      10,
      personStep,
      { shiftSwapRequestId: 1 },
      { actorUserId: 7 }
    );

    expect(pa?.assignedToOrgUnitId).toBeNull();
    expect(pa?.assignedToUserId).toBe(42);
  });

  it('returns null when a person-scoped step resolves to nobody', async () => {
    const { pool } = makePool();
    const engine = new ApprovalEngineService(pool);
    const unresolvedStep = { ...personStep, approverScope: 'policy_owner' as const };
    const pa = await engine.createPendingApprovalForStep(
      10,
      unresolvedStep,
      { shiftSwapRequestId: 1 },
      { actorUserId: 7 } // no policyOwnerId in context
    );
    expect(pa).toBeNull();
  });
});

describe('ApprovalEngineService.decidePendingApproval — authorization', () => {
  it('allows the direct assignee to decide', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[buildPaRow({ status: 'approved' })], null] as Tuple); // post-decision fetch

    const engine = new ApprovalEngineService(pool);
    const result = await engine.decidePendingApproval(501, 7, 'approved', null, async () => ({ actorUserId: 7 }));
    expect(result.isFinalStep).toBe(true);
    expect(result.decision).toBe('approved');
  });

  it('allows any member of the structure to decide once opened, and records decided_by_user_id', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: null, assigned_to_org_unit_id: 3, open_to_structure: 1 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple) // membership check -> user IS a member
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup
      .mockResolvedValueOnce([[buildPaRow({ status: 'approved', decided_by_user_id: 55 })], null] as Tuple); // post-decision fetch

    const engine = new ApprovalEngineService(pool);
    const result = await engine.decidePendingApproval(501, 55, 'approved', null, async () => ({ actorUserId: 55 }));
    expect(result.isFinalStep).toBe(true);

    const updateCall = execute.mock.calls[2];
    expect(updateCall[1]).toContain(55); // decided_by_user_id passed to the guarded UPDATE
  });

  it('refuses a non-member when the decision is not open to the structure', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7, open_to_structure: 0 })], null] as Tuple);

    const engine = new ApprovalEngineService(pool);
    await expect(
      engine.decidePendingApproval(501, 999, 'approved', null, async () => ({ actorUserId: 999 }))
    ).rejects.toThrow(/Not authorized/);
  });

  it('refuses a non-member even when opened to the structure', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: null, assigned_to_org_unit_id: 3, open_to_structure: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple); // membership check -> not a member

    const engine = new ApprovalEngineService(pool);
    await expect(
      engine.decidePendingApproval(501, 999, 'approved', null, async () => ({ actorUserId: 999 }))
    ).rejects.toThrow(/Not authorized/);
  });

  it('throws when the guarded UPDATE matches nothing (already decided)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7 })], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7, status: 'approved' })], null] as Tuple);

    const engine = new ApprovalEngineService(pool);
    await expect(
      engine.decidePendingApproval(501, 7, 'approved', null, async () => ({ actorUserId: 7 }))
    ).rejects.toThrow(/already approved/);
  });
});

describe('ApprovalEngineService structure delegation actions', () => {
  it('keepForSelf requires the caller to be the structure head', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple); // org_units head lookup

    const engine = new ApprovalEngineService(pool);
    await expect(engine.keepForSelf(501, 999)).rejects.toThrow(/Forbidden/);
  });

  it('keepForSelf is idempotent and logs a single "kept" reassignment', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // head lookup
      .mockResolvedValueOnce([[], null] as Tuple) // no existing decision_reassignments row
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE pending_approvals
      .mockResolvedValueOnce([{ insertId: 1 }, null] as Tuple) // INSERT decision_reassignments
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple); // final refresh

    const engine = new ApprovalEngineService(pool);
    const result = await engine.keepForSelf(501, 30);
    expect(result.assignedToUserId).toBe(30);
    const insertCall = execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO decision_reassignments')
    );
    expect(insertCall[0]).toContain("'kept'");
    expect(insertCall[1]).toEqual([501, 30]);
  });

  it('delegateToPerson refuses a target who is not a member of the structure', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // head lookup — caller IS head
      .mockResolvedValueOnce([[], null] as Tuple); // membership check -> target not a member

    const engine = new ApprovalEngineService(pool);
    await expect(engine.delegateToPerson(501, 30, 12)).rejects.toThrow(/must be a member/);
  });

  it('delegateToPerson reassigns to the target and logs the delegation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // head lookup
      .mockResolvedValueOnce([[{ id: 1 }], null] as Tuple) // membership check -> target IS a member
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE pending_approvals
      .mockResolvedValueOnce([{ insertId: 2 }, null] as Tuple) // INSERT decision_reassignments
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 12 })], null] as Tuple); // final refresh

    const engine = new ApprovalEngineService(pool);
    const result = await engine.delegateToPerson(501, 30, 12);
    expect(result.assignedToUserId).toBe(12);

    const updateCall = execute.mock.calls[3];
    expect(updateCall[1]).toEqual([12, 501]);
    const insertCall = execute.mock.calls[4];
    expect(insertCall[0]).toContain("'delegated_to_person'");
    expect(insertCall[1]).toEqual([501, 30, 12]);
  });

  it('openToStructure clears the assignee and flips open_to_structure', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // head lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE pending_approvals
      .mockResolvedValueOnce([{ insertId: 3 }, null] as Tuple) // INSERT decision_reassignments
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: null, open_to_structure: 1 })], null] as Tuple); // final refresh

    const engine = new ApprovalEngineService(pool);
    const result = await engine.openToStructure(501, 30);
    expect(result.assignedToUserId).toBeNull();
    expect(result.openToStructure).toBe(true);

    const updateCall = execute.mock.calls[2];
    expect(updateCall[1]).toEqual([501]);
    const insertCall = execute.mock.calls[3];
    expect(insertCall[0]).toContain("'opened_to_structure'");
    expect(insertCall[1]).toEqual([501, 30]);
  });

  it('rejects delegate/open/keep from anyone but the structure head', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple)
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple);
    const engine = new ApprovalEngineService(pool);
    await expect(engine.openToStructure(501, 999)).rejects.toThrow(/Forbidden/);
  });

  it('rejects reassignment once the decision is no longer pending', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30, status: 'approved' })], null] as Tuple);
    const engine = new ApprovalEngineService(pool);
    await expect(engine.keepForSelf(501, 30)).rejects.toThrow(/not assigned to a structure|Cannot reassign/);
  });
});

describe('ApprovalEngineService.getDecisionChain', () => {
  it('assembles the structure, reassignment history, and final decider', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({
        assigned_to_org_unit_id: 3, assigned_to_user_id: 12, status: 'approved', decided_by_user_id: 12,
      })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ id: 3, name: 'Emergency Department', manager_user_id: 30, head_name: 'Mara Demo' }], null] as Tuple) // org unit + head
      .mockResolvedValueOnce([[
        { id: 1, pending_approval_id: 501, action: 'delegated_to_person', actor_user_id: 30, target_user_id: 12, created_at: 't', actor_name: 'Mara Demo', target_name: 'Anna Demo' },
      ], null] as Tuple) // decision_reassignments
      .mockResolvedValueOnce([[{ name: 'Anna Demo' }], null] as Tuple); // decidedByName lookup

    const engine = new ApprovalEngineService(pool);
    const chain = await engine.getDecisionChain(501, 12);

    expect(chain.assignedToOrgUnit).toEqual({ id: 3, name: 'Emergency Department', headUserId: 30, headName: 'Mara Demo' });
    expect(chain.reassignments).toHaveLength(1);
    expect(chain.reassignments[0].action).toBe('delegated_to_person');
    expect(chain.currentAssigneeUserId).toBe(12);
    expect(chain.decidedByUserId).toBe(12);
    expect(chain.decidedByName).toBe('Anna Demo');
  });

  it('returns a null structure and empty history for a person-assigned decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null, assigned_to_user_id: 7 })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple); // decision_reassignments — none

    const engine = new ApprovalEngineService(pool);
    const chain = await engine.getDecisionChain(501, 7);
    expect(chain.assignedToOrgUnit).toBeNull();
    expect(chain.reassignments).toEqual([]);
    expect(chain.decidedByName).toBeNull();
  });

  it('rejects a caller with no relation to the decision (not assignee, structure member, or proposer)', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null, assigned_to_user_id: 7 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ proposer_user_id: 55 }], null] as Tuple); // getProposerUserId -> shift_swap_requests, not the caller

    const engine = new ApprovalEngineService(pool);
    await expect(engine.getDecisionChain(501, 999)).rejects.toThrow(/Forbidden/);
  });

  it('lets the original proposer view the chain even when not the current assignee', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null, assigned_to_user_id: 7 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ proposer_user_id: 55 }], null] as Tuple) // getProposerUserId -> matches caller
      .mockResolvedValueOnce([[], null] as Tuple); // decision_reassignments — none

    const engine = new ApprovalEngineService(pool);
    const chain = await engine.getDecisionChain(501, 55);
    expect(chain.assignedToOrgUnit).toBeNull();
  });

  it('lets any member of the assigned structure view the chain, even before it is opened to the whole team', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30, open_to_structure: 0 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ dummy: 1 }], null] as Tuple) // user_org_units membership check -> found
      .mockResolvedValueOnce([[{ id: 3, name: 'Emergency Department', manager_user_id: 30, head_name: 'Mara Demo' }], null] as Tuple) // org unit + head
      .mockResolvedValueOnce([[], null] as Tuple); // decision_reassignments — none

    const engine = new ApprovalEngineService(pool);
    const chain = await engine.getDecisionChain(501, 999);
    expect(chain.assignedToOrgUnit?.id).toBe(3);
  });
});

// ── Structure-head guard arms and small read-side helpers ────────────────────

describe('requireStructureHead guard arms (via keepForSelf)', () => {
  it('rejects a decision that is not assigned to any structure', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null })], null]);

    await expect(new ApprovalEngineService(pool).keepForSelf(501, 9)).rejects.toThrow(
      'This decision is not assigned to a structure'
    );
  });

  it('rejects reassignment of an already-decided approval', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [buildPaRow({ assigned_to_org_unit_id: 3, status: 'approved' })],
      null,
    ]);

    await expect(new ApprovalEngineService(pool).keepForSelf(501, 9)).rejects.toThrow(
      /Cannot reassign a decision in 'approved' status/
    );
  });

  it('rejects a caller when the unit has no manager at all', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3 })], null]) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: null }], null]); // org_units head lookup

    await expect(new ApprovalEngineService(pool).keepForSelf(501, 9)).rejects.toThrow('Forbidden');
  });
});

describe('reassignment concurrency conflicts', () => {
  const paAssigned = () => [[buildPaRow({ assigned_to_org_unit_id: 3 })], null];
  const headOk = () => [[{ manager_user_id: 9 }], null];

  it('keepForSelf diagnoses a concurrent decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([[], null]) // no prior reassignment
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // guarded UPDATE misses

    await expect(new ApprovalEngineService(pool).keepForSelf(501, 9)).rejects.toThrow(
      'Cannot reassign a decision that was decided concurrently'
    );
  });

  it('delegateToPerson diagnoses a concurrent decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([[{ 1: 1 }], null]) // membership ok
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    await expect(new ApprovalEngineService(pool).delegateToPerson(501, 9, 5)).rejects.toThrow(
      'Cannot reassign a decision that was decided concurrently'
    );
  });

  it('openToStructure diagnoses a concurrent decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    await expect(new ApprovalEngineService(pool).openToStructure(501, 9)).rejects.toThrow(
      'Cannot reassign a decision that was decided concurrently'
    );
  });
});

describe('read-side helpers', () => {
  it('wouldBeFinalStep: 404 for a missing approval, then true/false by next-step presence', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(new ApprovalEngineService(pool).wouldBeFinalStep(999)).rejects.toThrow(
      'Pending approval not found'
    );

    const { pool: p2, execute: e2 } = makePool();
    e2.mockResolvedValueOnce([[buildPaRow()], null]).mockResolvedValueOnce([[{ id: 21 }], null]);
    await expect(new ApprovalEngineService(p2).wouldBeFinalStep(501)).resolves.toBe(false);

    const { pool: p3, execute: e3 } = makePool();
    e3.mockResolvedValueOnce([[buildPaRow()], null]).mockResolvedValueOnce([[], null]);
    await expect(new ApprovalEngineService(p3).wouldBeFinalStep(501)).resolves.toBe(true);
  });

  it('resolveApproverForStep returns null for an unknown step and resolves a known one', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(
      new ApprovalEngineService(pool).resolveApproverForStep(999, { actorUserId: 1 })
    ).resolves.toBeNull();

    const { pool: p2, execute: e2 } = makePool();
    e2.mockResolvedValueOnce([
      [
        {
          id: 20, workflow_id: 10, step_order: 1, approver_scope: 'company_user',
          approver_role_id: null, approver_user_id: 42, approver_permission_code: null,
          auto_approve_for_owner: 0, escalate_after_hours: null,
        },
      ],
      null,
    ]);
    await expect(
      new ApprovalEngineService(p2).resolveApproverForStep(20, { actorUserId: 1 })
    ).resolves.toBe(42);
  });

  it('entityRefFromPendingApproval maps each entity kind and rejects an unlinked row', () => {
    const svc = new ApprovalEngineService(makePool().pool) as unknown as {
      entityRefFromPendingApproval: (pa: Record<string, unknown>) => unknown;
    };
    const base = {
      changeRequestId: null, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
    };
    expect(svc.entityRefFromPendingApproval({ ...base, changeRequestId: 1 })).toEqual({ changeRequestId: 1 });
    expect(svc.entityRefFromPendingApproval({ ...base, timeOffRequestId: 2 })).toEqual({ timeOffRequestId: 2 });
    expect(svc.entityRefFromPendingApproval({ ...base, employeeLoanId: 3 })).toEqual({ employeeLoanId: 3 });
    expect(svc.entityRefFromPendingApproval({ ...base, shiftSwapRequestId: 4 })).toEqual({ shiftSwapRequestId: 4 });
    expect(() => svc.entityRefFromPendingApproval(base)).toThrow('Pending approval has no linked entity');
  });

  it('createWorkflow translates a duplicate change type into a ConflictError', async () => {
    const execute = jest.fn();
    const conn = {
      execute: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })),
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never;

    await expect(
      new ApprovalEngineService(pool).createWorkflow({
        changeType: 'TimeOff.Request',
        steps: [{ stepOrder: 1, approverScope: 'company_user', approverUserId: 42 }],
      } as never)
    ).rejects.toThrow('Workflow for this change type already exists');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('reassignment happy paths (first time)', () => {
  const paAssigned = () => [[buildPaRow({ assigned_to_org_unit_id: 3 })], null];
  const headOk = () => [[{ manager_user_id: 9 }], null];

  it('keepForSelf assigns to the head and records the kept action once', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([[], null]) // no prior reassignment
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // INSERT decision_reassignments
      .mockResolvedValueOnce(paAssigned() as never); // refetch

    await new ApprovalEngineService(pool).keepForSelf(501, 9);

    const insert = execute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO decision_reassignments'))!;
    expect(insert[1]).toEqual([501, 9]);
  });

  it('delegateToPerson reassigns to the member and records the delegation', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([[{ 1: 1 }], null]) // membership ok
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // INSERT
      .mockResolvedValueOnce(paAssigned() as never); // refetch

    await new ApprovalEngineService(pool).delegateToPerson(501, 9, 5);

    const insert = execute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO decision_reassignments'))!;
    expect(insert[1]).toEqual([501, 9, 5]);
  });

  it('openToStructure clears the assignee and records the opening', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE
      .mockResolvedValueOnce([{ insertId: 1 }, null]) // INSERT
      .mockResolvedValueOnce(paAssigned() as never); // refetch

    await new ApprovalEngineService(pool).openToStructure(501, 9);

    const update = execute.mock.calls[2];
    expect(String(update[0])).toContain('open_to_structure = TRUE');
  });

  it('decidePendingApproval rejects an unknown pending approval id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(
      new ApprovalEngineService(pool).decidePendingApproval(999, 1, 'approved', null, async () => ({ actorUserId: 1 }))
    ).rejects.toThrow('Pending approval not found');
  });
});
