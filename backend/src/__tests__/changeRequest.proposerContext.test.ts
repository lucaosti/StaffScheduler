/**
 * ChangeRequestService.create — proposer context resolution.
 *
 * Split out of the former approval-escalation test file: this pins that
 * `create` resolves the proposer's org unit, departments, and roles (used to
 * scope the first approval step), independent of the escalation suite it
 * used to share a file with.
 */

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
