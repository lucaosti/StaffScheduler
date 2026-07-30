/**
 * The authority profile.
 *
 * The property worth testing is not the shape of the response — it is that this
 * service DELEGATES. A panel that names an approver by its own reasoning is
 * worse than no panel, because it is confidently wrong at exactly the moment
 * someone is relying on it. So the cases assert that the engine's own resolver
 * is what was called, and with the subject's real context.
 *
 * The other half is the gaps: a step nobody can decide must be visible as such,
 * since that is a broken configuration and the only place it would ever show.
 *
 * @author Luca Ostinelli
 */

import { AuthorityService } from '../services/AuthorityService';

export {};

const getManagerChain = jest.fn();
jest.mock('../services/OrgUnitService', () => ({
  OrgUnitService: jest.fn().mockImplementation(() => ({ getManagerChain })),
}));

const listWorkflows = jest.fn();
const resolveAllApproversForStep = jest.fn();
jest.mock('../services/ApprovalEngineService', () => ({
  ApprovalEngineService: jest.fn().mockImplementation(() => ({
    listWorkflows,
    resolveAllApproversForStep,
  })),
}));

const resolveResponsibleUsers = jest.fn();
jest.mock('../services/ResponsibilityRuleService', () => ({
  ResponsibilityRuleService: jest.fn().mockImplementation(() => ({ resolveResponsibleUsers })),
}));

const person = (id: number) => ({
  id,
  first_name: `First${id}`,
  last_name: `Last${id}`,
  email: `u${id}@x.y`,
});

/**
 * The pool double dispatches on a distinctive fragment of each statement.
 * Sequence-based doubles broke every time a query was added or reordered; a
 * statement this does not recognise throws rather than returning an empty set,
 * so a new query cannot silently look like "no results".
 */
const makePool = (over: Partial<Record<string, unknown[]>> = {}) => {
  const rows: Record<string, unknown[]> = {
    users: [person(1)],
    memberships: [{ org_unit_id: 10 }],
    departments: [{ department_id: 3 }],
    roles: [{ role_id: 7 }],
    roleAdmins: [],
    ...over,
  };
  const dispatch = (sql: string) => {
    if (sql.includes('FROM users WHERE id IN')) return rows.users;
    if (sql.includes('FROM user_org_units')) return rows.memberships;
    if (sql.includes('FROM user_departments')) return rows.departments;
    if (sql.includes('FROM user_roles ur')) return rows.roleAdmins;
    if (sql.includes('FROM user_roles')) return rows.roles;
    throw new Error(`Unexpected query: ${sql.slice(0, 90)}`);
  };
  const handler = jest.fn(async (sql: string) => [dispatch(sql), []]);
  return { query: handler, execute: handler, _handler: handler } as never;
};

const step = (over: Record<string, unknown> = {}) => ({
  id: 1,
  workflowId: 1,
  stepOrder: 1,
  approverScope: 'unit_manager',
  approverRoleId: null,
  approverUserId: null,
  approverPermissionCode: null,
  autoApproveForOwner: true,
  escalateAfterHours: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getManagerChain.mockResolvedValue([{ unitId: 10, unitName: 'Ward A', manager: null }]);
  listWorkflows.mockResolvedValue([]);
  resolveAllApproversForStep.mockResolvedValue([]);
  resolveResponsibleUsers.mockResolvedValue([]);
});

describe('getAuthorityProfile', () => {
  it('returns null for a user who does not exist', async () => {
    const pool = makePool({ users: [] });
    expect(await new AuthorityService(pool).getAuthorityProfile(1)).toBeNull();
  });

  it('reports the manager chain from the org-unit service, not its own walk', async () => {
    const profile = await new AuthorityService(makePool()).getAuthorityProfile(1);
    expect(getManagerChain).toHaveBeenCalledWith(1);
    expect(profile!.managerChain).toEqual([{ unitId: 10, unitName: 'Ward A', manager: null }]);
  });
});

describe('who would decide this person\'s requests', () => {
  it('asks the approval engine, with the subject\'s own context', async () => {
    listWorkflows.mockResolvedValue([
      { id: 1, changeType: 'time_off', description: 'Leave', steps: [step()] },
    ]);
    resolveAllApproversForStep.mockResolvedValue([2]);

    const pool = makePool({ users: [person(1), person(2)] });
    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    // The context is what routes the decision; resolving it differently here is
    // exactly how the panel would come to disagree with reality.
    expect(resolveAllApproversForStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepOrder: 1 }),
      expect.objectContaining({
        actorUserId: 1,
        orgUnitId: 10,
        subjectDepartmentIds: [3],
        subjectRoleIds: [7],
      })
    );
    expect(profile!.approvals[0].steps[0].approvers).toEqual([
      { id: 2, firstName: 'First2', lastName: 'Last2', email: 'u2@x.y' },
    ]);
  });

  it('marks a step nobody can decide as unresolved instead of dropping it', async () => {
    listWorkflows.mockResolvedValue([
      { id: 1, changeType: 'time_off', description: null, steps: [step()] },
    ]);
    resolveAllApproversForStep.mockResolvedValue([]);

    const profile = await new AuthorityService(makePool()).getAuthorityProfile(1);

    // An org unit with no manager means time-off requests have no one to decide
    // them. Omitting the row would make that look like a working configuration.
    expect(profile!.approvals[0].steps[0]).toMatchObject({
      unresolved: true,
      approverScope: 'unit_manager',
      approvers: [],
    });
  });

  it('names every approver when a step resolves to several', async () => {
    listWorkflows.mockResolvedValue([
      {
        id: 1,
        changeType: 'change_request',
        description: null,
        steps: [step({ approverScope: 'responsibility_rule', approverPermissionCode: 'change.approve' })],
      },
    ]);
    resolveAllApproversForStep.mockResolvedValue([2, 3]);

    const pool = makePool({ users: [person(1), person(2), person(3)] });
    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    // "Either of these two" is the honest answer for a responsibility rule; the
    // engine picks one at filing time, but both are genuinely able to decide.
    expect(profile!.approvals[0].steps[0].approvers.map((p) => p.id)).toEqual([2, 3]);
    expect(profile!.approvals[0].steps[0].permissionCode).toBe('change.approve');
  });

  it('orders the steps as they will be taken', async () => {
    listWorkflows.mockResolvedValue([
      {
        id: 1,
        changeType: 'time_off',
        description: null,
        steps: [step({ id: 2, stepOrder: 2 }), step({ id: 1, stepOrder: 1 })],
      },
    ]);

    const profile = await new AuthorityService(makePool()).getAuthorityProfile(1);
    expect(profile!.approvals[0].steps.map((s) => s.stepOrder)).toEqual([1, 2]);
  });
});

describe('who can change this person\'s roles', () => {
  it('resolves responsibility rules against the subject, not globally', async () => {
    resolveResponsibleUsers.mockResolvedValue([2]);
    const pool = makePool({ users: [person(1), person(2)] });

    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    expect(resolveResponsibleUsers).toHaveBeenCalledWith({
      permissionCode: 'role.manage',
      orgUnitId: 10,
      departmentIds: [3],
      roleIds: [7],
    });
    expect(profile!.roleAdministrators).toEqual([
      expect.objectContaining({ id: 2, via: 'responsibility_rule' }),
    ]);
  });

  it('also names plain permission holders, labelled differently', async () => {
    resolveResponsibleUsers.mockResolvedValue([]);
    const pool = makePool({ users: [person(1), person(4)], roleAdmins: [{ user_id: 4 }] });

    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    // True but a different statement: they can do it everywhere, rather than
    // having been made responsible for this person.
    expect(profile!.roleAdministrators).toEqual([expect.objectContaining({ id: 4, via: 'permission' })]);
  });

  it('lists someone named by both sources once, as the more specific one', async () => {
    resolveResponsibleUsers.mockResolvedValue([2]);
    const pool = makePool({ users: [person(1), person(2)], roleAdmins: [{ user_id: 2 }] });

    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    expect(profile!.roleAdministrators).toHaveLength(1);
    expect(profile!.roleAdministrators[0].via).toBe('responsibility_rule');
  });

  it('never answers with the subject themselves', async () => {
    resolveResponsibleUsers.mockResolvedValue([1]);
    const pool = makePool({ users: [person(1)], roleAdmins: [{ user_id: 1 }] });

    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    // Someone administering their own roles restates the question rather than
    // answering it.
    expect(profile!.roleAdministrators).toEqual([]);
  });
});

describe('a person with no org unit', () => {
  it('still produces a profile, with no unit context to resolve against', async () => {
    const pool = makePool({ memberships: [] });
    const profile = await new AuthorityService(pool).getAuthorityProfile(1);

    expect(profile).not.toBeNull();
    expect(resolveResponsibleUsers).toHaveBeenCalledWith(expect.objectContaining({ orgUnitId: null }));
    // `orgUnitId` is omitted rather than passed as null: the engine's context
    // treats an absent unit and a null one differently.
    expect(resolveAllApproversForStep).not.toHaveBeenCalled();
  });
});
