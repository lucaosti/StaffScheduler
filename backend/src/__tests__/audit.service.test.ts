/**
 * AuditLogService unit tests (issue #92).
 *
 * Covers:
 *   - write: inserts an audit row with correct columns
 *   - write: silently swallows errors without throwing
 *   - write: serialises before/after snapshots as JSON
 *   - list: returns paginated results with total count
 *   - getById: returns null for unknown id
 *
 * @author Luca Ostinelli
 */

import { AuditLogService } from '../services/AuditLogService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

// INSERT column order:
// [0]  user_id (actorId)
// [1]  on_behalf_of_user_id
// [2]  action
// [3]  entity_type
// [4]  entity_id
// [5]  description
// [6]  justification
// [7]  before_snapshot
// [8]  after_snapshot
// [9]  ip_address
// [10] user_agent
// [11] request_id

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
      expect.arrayContaining([5, 'user.create', 'user', 10, 'test'])
    );
    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(5);               // user_id
    expect(params[2]).toBe('user.create');   // action
    expect(params[3]).toBe('user');          // entity_type
    expect(params[4]).toBe(10);             // entity_id
    expect(params[5]).toBe('test');          // description
    expect(params[8]).toBe(JSON.stringify({ email: 'x@x.com' })); // after_snapshot
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
    expect(callArgs[7]).toBe(JSON.stringify(before));  // before_snapshot
    expect(callArgs[8]).toBe(JSON.stringify(after));   // after_snapshot
  });

  it('passes null for before/after when not provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 3 }, null]);

    const svc = new AuditLogService(pool);
    await svc.write({ actorId: 2, action: 'user.delete', entityType: 'user', entityId: 99 });

    const callArgs = execute.mock.calls[0][1] as unknown[];
    expect(callArgs[7]).toBeNull();  // before_snapshot
    expect(callArgs[8]).toBeNull();  // after_snapshot
  });
});

describe('AuditLogService.list', () => {
  it('returns total and items from paginated query', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 3 }], null])
      .mockResolvedValueOnce([[
        {
          id: 1, user_id: 5, on_behalf_of_user_id: null, action: 'user.create',
          entity_type: 'user', entity_id: 10, description: null, justification: null,
          before_snapshot: null, after_snapshot: null,
          ip_address: null, user_agent: null, request_id: null,
          created_at: '2026-01-01T00:00:00Z',
        },
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
