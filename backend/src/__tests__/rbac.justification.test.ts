/**
 * RbacService justification tests.
 *
 * Verifies that assignRole() and removeRole() propagate the optional
 * justification string into the audit log write call.
 */

import { RbacService } from '../services/RbacService';
import { AuditLogService } from '../services/AuditLogService';

jest.mock('../services/AuditLogService');

const MockedAuditLogService = AuditLogService as jest.MockedClass<typeof AuditLogService>;

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute, getConnection: jest.fn() } as unknown as import('mysql2/promise').Pool, execute };
};

beforeEach(() => {
  MockedAuditLogService.mockClear();
  MockedAuditLogService.prototype.write = jest.fn().mockResolvedValue(undefined);
});

describe('RbacService.assignRole — justification', () => {
  it('writes the justification to the audit log when provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.assignRole(5, 2, null, null, 1, 'Covering sabbatical leave');

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ justification: 'Covering sabbatical leave' })
    );
  });

  it('writes null justification when not provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.assignRole(5, 2, null, null, 1);

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ justification: null })
    );
  });

  it('includes action role.grant regardless of justification', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.assignRole(5, 2);

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.grant' })
    );
  });
});

describe('RbacService.removeRole — justification', () => {
  it('writes the justification to the audit log when provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(5, 2, null, 1, 'Role no longer applicable');

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ justification: 'Role no longer applicable' })
    );
  });

  it('writes null justification when not provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(5, 2);

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ justification: null })
    );
  });

  it('includes action role.revoke regardless of justification', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(5, 2, null, 1);

    expect(MockedAuditLogService.prototype.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.revoke' })
    );
  });

  it('uses a scoped DELETE query when scopeOrgUnitId is set', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const svc = new RbacService(pool);
    await svc.removeRole(5, 2, 10, 1, 'Scope reduced');

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('scope_org_unit_id = ?');
  });
});
