/**
 * AuditLogService unit tests (issue #92).
 *
 * Covers:
 *   - write: inserts an audit row with correct columns
 *   - write: silently swallows errors without throwing
 *   - write: serialises before/after snapshots as JSON
 *   - list: returns paginated results with total count
 *   - getById: returns null for unknown id
 */

import { AuditLogService } from '../services/AuditLogService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('AuditLogService.write', () => {
  it('inserts a row with the supplied fields', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]);

    const svc = new AuditLogService(pool);
    await svc.write({
      actorId: 5,
      action: 'user.create',
      entityType: 'user',
      entityId: 10,
      description: 'test',
      after: { email: 'x@x.com' },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [5, 'user.create', 'user', 10, 'test', null, JSON.stringify({ email: 'x@x.com' })]
    );
  });

  it('silently swallows DB errors without throwing', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('DB down'));

    const svc = new AuditLogService(pool);
    await expect(svc.write({ actorId: 1, action: 'test.action' })).resolves.toBeUndefined();
  });

  it('serialises both before and after snapshots as JSON strings', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 2 }, null]);

    const before = { status: 'draft' };
    const after = { status: 'published' };

    const svc = new AuditLogService(pool);
    await svc.write({ actorId: 1, action: 'schedule.publish', before, after });

    const callArgs = execute.mock.calls[0][1] as unknown[];
    expect(callArgs[5]).toBe(JSON.stringify(before));
    expect(callArgs[6]).toBe(JSON.stringify(after));
  });

  it('passes null for before/after when not provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 3 }, null]);

    const svc = new AuditLogService(pool);
    await svc.write({ actorId: 2, action: 'user.delete', entityType: 'user', entityId: 99 });

    const callArgs = execute.mock.calls[0][1] as unknown[];
    expect(callArgs[5]).toBeNull();
    expect(callArgs[6]).toBeNull();
  });
});

describe('AuditLogService.list', () => {
  it('returns total and items from paginated query', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 3 }], null])  // COUNT query
      .mockResolvedValueOnce([[
        { id: 1, user_id: 5, action: 'user.create', entity_type: 'user', entity_id: 10,
          description: null, before_snapshot: null, after_snapshot: null,
          ip_address: null, user_agent: null, created_at: '2026-01-01T00:00:00Z' },
      ], null]);

    const svc = new AuditLogService(pool);
    const page = await svc.list({ entityType: 'user' });

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].action).toBe('user.create');
  });
});

describe('AuditLogService.getById', () => {
  it('returns null when no row matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new AuditLogService(pool);
    const result = await svc.getById(999);
    expect(result).toBeNull();
  });
});
