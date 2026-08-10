/**
 * ApprovalDecisionService — structure-vs-person decision delegation.
 *
 * Covers the generic machinery shared by change requests, time-off, loans,
 * and shift swaps: assigning a decision to a structure (org unit) instead of
 * a person, the structure head keeping/delegating/opening it, the resulting
 * chain-of-command record, and the updated "may this user decide it"
 * authorization check (assignee, or any member once opened).
 */

import { ApprovalDecisionService } from '../services/ApprovalDecisionService';

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

describe('ApprovalDecisionService.createPendingApprovalForStep', () => {
  it('assigns to the org unit and defaults assignee to its head for a unit_structure step', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple) // findUnitManager
      .mockResolvedValueOnce([{ insertId: 501 }, null] as Tuple) // INSERT pending_approvals
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple); // getPendingApprovalById

    const engine = new ApprovalDecisionService(pool);
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
    const engine = new ApprovalDecisionService(pool);
    await expect(
      engine.createPendingApprovalForStep(10, structureStep, { shiftSwapRequestId: 1 }, { actorUserId: 7 })
    ).rejects.toThrow(/requires an org unit/);
  });

  it('assigns directly to the resolved person for a non-structure step, with no org unit', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 502 }, null] as Tuple) // INSERT (company_user needs no resolve query)
      .mockResolvedValueOnce([[buildPaRow({ id: 502, assigned_to_user_id: 42 })], null] as Tuple);

    const engine = new ApprovalDecisionService(pool);
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
    const engine = new ApprovalDecisionService(pool);
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

describe('ApprovalDecisionService.decidePendingApproval — authorization', () => {
  it('allows the direct assignee to decide', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // guarded UPDATE
      .mockResolvedValueOnce([[], null] as Tuple) // next-step lookup -> none
      .mockResolvedValueOnce([[buildPaRow({ status: 'approved' })], null] as Tuple); // post-decision fetch

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
    const result = await engine.decidePendingApproval(501, 55, 'approved', null, async () => ({ actorUserId: 55 }));
    expect(result.isFinalStep).toBe(true);

    const updateCall = execute.mock.calls[2];
    expect(updateCall[1]).toContain(55); // decided_by_user_id passed to the guarded UPDATE
  });

  it('refuses a non-member when the decision is not open to the structure', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: 7, open_to_structure: 0 })], null] as Tuple);

    const engine = new ApprovalDecisionService(pool);
    await expect(
      engine.decidePendingApproval(501, 999, 'approved', null, async () => ({ actorUserId: 999 }))
    ).rejects.toThrow(/Not authorized/);
  });

  it('refuses a non-member even when opened to the structure', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_user_id: null, assigned_to_org_unit_id: 3, open_to_structure: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple); // membership check -> not a member

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
    await expect(
      engine.decidePendingApproval(501, 7, 'approved', null, async () => ({ actorUserId: 7 }))
    ).rejects.toThrow(/already approved/);
  });
});

describe('ApprovalDecisionService structure delegation actions', () => {
  it('keepForSelf requires the caller to be the structure head', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: 30 }], null] as Tuple); // org_units head lookup

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
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
    const engine = new ApprovalDecisionService(pool);
    await expect(engine.openToStructure(501, 999)).rejects.toThrow(/Forbidden/);
  });

  it('rejects reassignment once the decision is no longer pending', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3, assigned_to_user_id: 30, status: 'approved' })], null] as Tuple);
    const engine = new ApprovalDecisionService(pool);
    await expect(engine.keepForSelf(501, 30)).rejects.toThrow(/not assigned to a structure|Cannot reassign/);
  });
});

describe('ApprovalDecisionService.getDecisionChain', () => {
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

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
    await expect(engine.getDecisionChain(501, 999)).rejects.toThrow(/Forbidden/);
  });

  it('lets the original proposer view the chain even when not the current assignee', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null, assigned_to_user_id: 7 })], null] as Tuple) // getPendingApprovalById
      .mockResolvedValueOnce([[{ proposer_user_id: 55 }], null] as Tuple) // getProposerUserId -> matches caller
      .mockResolvedValueOnce([[], null] as Tuple); // decision_reassignments — none

    const engine = new ApprovalDecisionService(pool);
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

    const engine = new ApprovalDecisionService(pool);
    const chain = await engine.getDecisionChain(501, 999);
    expect(chain.assignedToOrgUnit?.id).toBe(3);
  });
});

// ── Structure-head guard arms and small read-side helpers ────────────────────

describe('requireStructureHead guard arms (via keepForSelf)', () => {
  it('rejects a decision that is not assigned to any structure', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: null })], null]);

    await expect(new ApprovalDecisionService(pool).keepForSelf(501, 9)).rejects.toThrow(
      'This decision is not assigned to a structure'
    );
  });

  it('rejects reassignment of an already-decided approval', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [buildPaRow({ assigned_to_org_unit_id: 3, status: 'approved' })],
      null,
    ]);

    await expect(new ApprovalDecisionService(pool).keepForSelf(501, 9)).rejects.toThrow(
      /Cannot reassign a decision in 'approved' status/
    );
  });

  it('rejects a caller when the unit has no manager at all', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildPaRow({ assigned_to_org_unit_id: 3 })], null]) // getPendingApprovalById
      .mockResolvedValueOnce([[{ manager_user_id: null }], null]); // org_units head lookup

    await expect(new ApprovalDecisionService(pool).keepForSelf(501, 9)).rejects.toThrow('Forbidden');
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

    await expect(new ApprovalDecisionService(pool).keepForSelf(501, 9)).rejects.toThrow(
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

    await expect(new ApprovalDecisionService(pool).delegateToPerson(501, 9, 5)).rejects.toThrow(
      'Cannot reassign a decision that was decided concurrently'
    );
  });

  it('openToStructure diagnoses a concurrent decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce(paAssigned() as never)
      .mockResolvedValueOnce(headOk() as never)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    await expect(new ApprovalDecisionService(pool).openToStructure(501, 9)).rejects.toThrow(
      'Cannot reassign a decision that was decided concurrently'
    );
  });
});

describe('read-side helpers', () => {
  it('wouldBeFinalStep: 404 for a missing approval, then true/false by next-step presence', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(new ApprovalDecisionService(pool).wouldBeFinalStep(999)).rejects.toThrow(
      'Pending approval not found'
    );

    const { pool: p2, execute: e2 } = makePool();
    e2.mockResolvedValueOnce([[buildPaRow()], null]).mockResolvedValueOnce([[{ id: 21 }], null]);
    await expect(new ApprovalDecisionService(p2).wouldBeFinalStep(501)).resolves.toBe(false);

    const { pool: p3, execute: e3 } = makePool();
    e3.mockResolvedValueOnce([[buildPaRow()], null]).mockResolvedValueOnce([[], null]);
    await expect(new ApprovalDecisionService(p3).wouldBeFinalStep(501)).resolves.toBe(true);
  });

  it('entityRefFromPendingApproval maps each entity kind and rejects an unlinked row', () => {
    const svc = new ApprovalDecisionService(makePool().pool) as unknown as {
      entityRefFromPendingApproval: (pa: Record<string, unknown>) => unknown;
    };
    const base = {
      changeRequestId: null, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
      policyExceptionId: null,
    };
    expect(svc.entityRefFromPendingApproval({ ...base, changeRequestId: 1 })).toEqual({ changeRequestId: 1 });
    expect(svc.entityRefFromPendingApproval({ ...base, timeOffRequestId: 2 })).toEqual({ timeOffRequestId: 2 });
    expect(svc.entityRefFromPendingApproval({ ...base, employeeLoanId: 3 })).toEqual({ employeeLoanId: 3 });
    expect(svc.entityRefFromPendingApproval({ ...base, shiftSwapRequestId: 4 })).toEqual({ shiftSwapRequestId: 4 });
    expect(svc.entityRefFromPendingApproval({ ...base, policyExceptionId: 5 })).toEqual({ policyExceptionId: 5 });
    expect(() => svc.entityRefFromPendingApproval(base)).toThrow('Pending approval has no linked entity');
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

    await new ApprovalDecisionService(pool).keepForSelf(501, 9);

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

    await new ApprovalDecisionService(pool).delegateToPerson(501, 9, 5);

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

    await new ApprovalDecisionService(pool).openToStructure(501, 9);

    const update = execute.mock.calls[2];
    expect(String(update[0])).toContain('open_to_structure = TRUE');
  });

  it('decidePendingApproval rejects an unknown pending approval id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(
      new ApprovalDecisionService(pool).decidePendingApproval(999, 1, 'approved', null, async () => ({ actorUserId: 1 }))
    ).rejects.toThrow('Pending approval not found');
  });
});

describe('missing pending approval guards', () => {
  it.each([
    ['keepForSelf', (s: ApprovalDecisionService) => s.keepForSelf(999, 9)],
    ['delegateToPerson', (s: ApprovalDecisionService) => s.delegateToPerson(999, 9, 5)],
    ['openToStructure', (s: ApprovalDecisionService) => s.openToStructure(999, 9)],
    ['getDecisionChain', (s: ApprovalDecisionService) => s.getDecisionChain(999, 9)],
  ])('%s rejects an unknown pending approval', async (_name, call) => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(call(new ApprovalDecisionService(pool))).rejects.toThrow('Pending approval not found');
  });

  it('getProposerUserId degrades to null for a row with no linked entity', async () => {
    const svc = new ApprovalDecisionService(makePool().pool) as unknown as {
      getProposerUserId: (pa: Record<string, unknown>) => Promise<number | null>;
    };
    await expect(
      svc.getProposerUserId({
        changeRequestId: null, timeOffRequestId: null, employeeLoanId: null, shiftSwapRequestId: null,
        policyExceptionId: null,
      })
    ).resolves.toBeNull();
  });
});
describe('ApprovalDecisionService.decidePendingApproval — webhook dispatch (#315)', () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    change_request_id: null,
    time_off_request_id: null,
    employee_loan_id: null,
    shift_swap_request_id: null,
    workflow_id: 1,
    step_id: 1,
    step_order: 1,
    // Deciding user IS the assignee — isAuthorizedToDecide's cheap path, no extra query.
    assigned_to_user_id: 9,
    assigned_to_org_unit_id: null,
    open_to_structure: 0,
    decided_by_user_id: null,
    status: 'pending',
    decided_at: null,
    decision_note: null,
    escalated_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  it('dispatches an approval.decided webhook event on a rejection, given an organization', async () => {
    const { pool, execute } = makePool();
    // dispatch() is called without `await` (fire-and-forget, same as the
    // schedule/assignment call sites) — its own SELECT is issued
    // synchronously before decidePendingApproval continues to its final
    // getPendingApprovalById, but the resulting INSERT only happens once
    // that SELECT's promise resolves, in a later microtask. The mock queue
    // order below reflects the actual call ORDER, not dispatch's logical
    // position in the source.
    execute
      .mockResolvedValueOnce([[pendingRow()], null]) // getPendingApprovalById (initial)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE pending_approvals
      .mockResolvedValueOnce([[{ id: 1, event_types: 'approval.decided' }], null]) // dispatch: matching subscriptions
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]) // getPendingApprovalById (updated)
      .mockResolvedValueOnce([{ insertId: 1 }, null]); // INSERT webhook_deliveries (resolves after the method returns)

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never, 'Acme');
    // Flush the microtask queue so dispatch's continuation (the INSERT) runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(result.decision).toBe('rejected');
    const dispatchInsert = execute.mock.calls.find((c) => /INSERT INTO webhook_deliveries/.test(c[0]));
    expect(dispatchInsert).toBeDefined();
    expect(dispatchInsert![1][1]).toBe('approval.decided');
    expect(JSON.parse(dispatchInsert![1][2])).toMatchObject({ pendingApprovalId: 1, decision: 'rejected' });
  });

  it('does not let a webhook dispatch failure surface — the decision already resolved', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[pendingRow()], null]) // getPendingApprovalById (initial)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // UPDATE pending_approvals
      .mockRejectedValueOnce(new Error('subscriptions table unavailable')) // dispatch's own SELECT
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]); // getPendingApprovalById (updated)

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never, 'Acme');
    await Promise.resolve();
    await Promise.resolve();

    expect(result.decision).toBe('rejected');
  });

  it('does not dispatch when no organization is given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[pendingRow()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[pendingRow({ status: 'rejected' })], null]);

    await new ApprovalDecisionService(pool).decidePendingApproval(1, 9, 'rejected', null, async () => ({}) as never);
    await Promise.resolve();

    expect(execute.mock.calls.some((c) => /webhook_deliveries|webhook_subscriptions/.test(c[0]))).toBe(false);
  });
});

describe('ApprovalDecisionService.processEscalations', () => {
  it('escalates overdue pending approvals and returns a summary', async () => {
    const { pool, execute } = makePool();
    // SELECT overdue rows
    execute.mockResolvedValueOnce([[
      { id: 1, change_request_id: 10, workflow_id: 2, step_id: 3, step_order: 1,
        assigned_to_user_id: 5, escalate_after_hours: 24, manager_id: 7 },
    ], null]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);  // UPDATE
    execute.mockResolvedValueOnce([{ insertId: 50 }, null]);     // INSERT

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(1);
    expect(result.items[0]).toMatchObject({
      pendingApprovalId: 1,
      entityRef: { changeRequestId: 10 },
      escalatedToUserId: 7,
    });
  });

  it('returns { escalated: 0, items: [] } when nothing is overdue', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});
describe('ApprovalDecisionService.processEscalations — default now', () => {
  it('returns empty result when no overdue items exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(0);
    expect(result.items).toHaveLength(0);
    // Uses NOW() in SQL so no timestamp param is needed
    expect(execute.mock.calls[0][1]).toEqual([]);
  });

  it('returns multiple overdue items', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[
        { id: 1, change_request_id: 5, workflow_id: 1, step_id: 1, step_order: 1, assigned_to_user_id: 10, escalate_after_hours: 24, manager_id: 11 },
        { id: 2, change_request_id: 6, workflow_id: 2, step_id: 3, step_order: 1, assigned_to_user_id: 20, escalate_after_hours: 48, manager_id: null },
      ], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE row 1
      .mockResolvedValueOnce([{ insertId: 10 }, null])     // INSERT escalated for row 1
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // UPDATE row 2 (no manager → no INSERT)

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].pendingApprovalId).toBe(1);
    expect(result.items[1].pendingApprovalId).toBe(2);
  });
});

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

describe('ApprovalDecisionService.processEscalations', () => {
  it('returns empty result when no overdue pending approvals exist', async () => {
    const { pool, execute } = makePool();
    // The SELECT query returns empty.
    execute.mockResolvedValueOnce([[], null]);

    const svc = new ApprovalDecisionService(pool);
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

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(1);
    expect(result.items[0]).toMatchObject({
      pendingApprovalId: 1,
      entityRef: { changeRequestId: 10 },
      escalatedToUserId: 7,
    });

    // UPDATE must set the escalated status — now supplied as a bound parameter
    // derived from the approval state machine, not an inline literal.
    const updateCall = execute.mock.calls[1];
    expect(updateCall[0]).toContain('SET status = ?');
    expect(updateCall[0]).toContain("AND status = 'pending'");
    expect(updateCall[1][0]).toBe('escalated'); // state machine: pending --escalate--> escalated
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

    const svc = new ApprovalDecisionService(pool);
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

    const svc = new ApprovalDecisionService(pool);
    const result = await svc.processEscalations();

    expect(result.escalated).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(3); // 1 SELECT + 1 batch UPDATE + 1 batch INSERT
  });

  it.each([
    ['time_off_request_id', 'timeOffRequestId'],
    ['employee_loan_id', 'employeeLoanId'],
    ['shift_swap_request_id', 'shiftSwapRequestId'],
  ])('classifies an overdue %s decision under the right entity ref', async (column, refKey) => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          overdueRow({
            change_request_id: null,
            time_off_request_id: null,
            employee_loan_id: null,
            shift_swap_request_id: null,
            [column]: 33,
          }),
        ],
        null,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ insertId: 99 }, null]);

    const result = await new ApprovalDecisionService(pool).processEscalations();

    expect(result.items[0].entityRef).toEqual({ [refKey]: 33 });
  });
});
