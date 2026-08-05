/**
 * PolicyService + PolicyExceptionService unit tests.
 */

import { PolicyService } from '../services/PolicyService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';

type Tuple = [unknown, unknown];

const policyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  scope_type: 'global',
  scope_id: null,
  policy_key: 'min_rest_hours',
  policy_value: '{"hours":11}',
  description: 'Min rest',
  imposed_by_user_id: 1,
  is_active: 1,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
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
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as never, execute };
};

describe('PolicyService', () => {
  it('parses JSON policy_value when listing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[policyRow()], null] as Tuple);

    const service = new PolicyService(pool);
    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0].policyValue).toEqual({ hours: 11 });
  });

  it('listApplicable filters by scope', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        policyRow({ id: 1, scope_type: 'global' }),
        policyRow({ id: 2, scope_type: 'org_unit', scope_id: 5 }),
        policyRow({ id: 3, scope_type: 'org_unit', scope_id: 6 }),
        policyRow({ id: 4, scope_type: 'schedule', scope_id: 9 }),
      ],
      null,
    ] as Tuple);

    const service = new PolicyService(pool);
    const result = await service.listApplicable({ orgUnitId: 5, scheduleId: null });
    const ids = result.map((p) => p.id).sort();
    expect(ids).toEqual([1, 2]);
  });
});

describe('PolicyExceptionService', () => {
  it('auto-approves when actor is the policy owner', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[policyRow({ imposed_by_user_id: 7 })], null] as Tuple) // PolicyService.getById
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[exceptionRow({ id: 5, status: 'approved', reviewer_user_id: 7 })], null] as Tuple);

    const service = new PolicyExceptionService(pool);
    // Auto-approve path — see services.extended.test.ts for the dedicated
    // workflow-attachment/decision-arm suite.
    const workflow = { id: 1, changeType: 'Policy.Exception', requireAll: false, description: null, steps: [{ id: 1, workflowId: 1, stepOrder: 1, approverScope: 'policy_owner' }] };
    jest.spyOn(
      (service as unknown as { engine: { resolveFirstStepAutoApprove: (t: string, c: unknown) => unknown } }).engine,
      'resolveFirstStepAutoApprove'
    ).mockResolvedValue({ workflow, approverUserId: 7, autoApprove: true } as never);

    const created = await service.create({
      policyId: 1,
      targetType: 'shift_assignment',
      targetId: 100,
      requestedByUserId: 7,
    });
    expect(created.status).toBe('approved');
    expect(created.reviewerUserId).toBe(7);
  });

  it('hasApproved returns true when count > 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 1 }], null] as Tuple);
    const service = new PolicyExceptionService(pool);
    const ok = await service.hasApproved(1, 'shift_assignment', 100);
    expect(ok).toBe(true);
  });
});
