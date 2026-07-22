/**
 * AuditLogService unit tests.
 *
 * Covers: list (filters, pagination, clamping), getById, write
 * (new fields: justification, onBehalfOfUserId, request_id auto-pull from context).
 *
 * @author Luca Ostinelli
 */

import { AuditLogService } from '../services/AuditLogService';
import * as requestContext from '../middleware/requestContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 5,
  on_behalf_of_user_id: null,
  action: 'login',
  entity_type: 'auth',
  entity_id: null,
  description: 'User signed in',
  justification: null,
  before_snapshot: null,
  after_snapshot: null,
  ip_address: '127.0.0.1',
  user_agent: 'jest',
  request_id: 'req-abc-123',
  created_at: '2026-04-26T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('AuditLogService.list', () => {
  it('returns total + items with default limit/offset', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 2 }], null])
      .mockResolvedValueOnce([[buildRow(), buildRow({ id: 2 })], null]);

    const service = new AuditLogService(pool);
    const page = await service.list({});
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);

    // LIMIT/OFFSET are inlined, not bound: MySQL's prepared-statement protocol
    // rejects placeholders there, which made every call fail. The clamping is
    // still what is under test — it just has to be read from the SQL now.
    const listSql = execute.mock.calls[1][0] as string;
    expect(listSql).toMatch(/LIMIT 100 OFFSET 0/);
  });

  it('clamps a huge limit to 500', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({ limit: 9999 });
    expect(execute.mock.calls[1][0] as string).toMatch(/LIMIT 500/);
  });

  it('clamps a zero limit to 1', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({ limit: 0 });
    expect(execute.mock.calls[1][0] as string).toMatch(/LIMIT 1 /);
  });

  it('clamps a negative offset to 0', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({ offset: -5 });
    expect(execute.mock.calls[1][0] as string).toMatch(/OFFSET 0/);
  });

  it('builds WHERE clause from all supported filters', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({
      userId: 5,
      onBehalfOfUserId: 7,
      action: 'login',
      entityType: 'auth',
      entityId: 99,
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      requestId: 'req-xyz',
    });

    const sqlCount = execute.mock.calls[0][0] as string;
    expect(sqlCount).toMatch(/user_id = \?/);
    expect(sqlCount).toMatch(/on_behalf_of_user_id = \?/);
    expect(sqlCount).toMatch(/action = \?/);
    expect(sqlCount).toMatch(/entity_type = \?/);
    expect(sqlCount).toMatch(/entity_id = \?/);
    expect(sqlCount).toMatch(/created_at >= \?/);
    expect(sqlCount).toMatch(/created_at <= \?/);
    expect(sqlCount).toMatch(/request_id = \?/);
    expect(execute.mock.calls[0][1]).toEqual([
      5, 7, 'login', 'auth', 99, '2026-04-01', '2026-04-30', 'req-xyz',
    ]);
  });

  it('maps all new fields in the returned items', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow({
        on_behalf_of_user_id: 7,
        justification: 'approved by manager',
        request_id: 'req-123',
        before_snapshot: JSON.stringify({ status: 'pending' }),
        after_snapshot: JSON.stringify({ status: 'approved' }),
      })], null]);

    const service = new AuditLogService(pool);
    const { items } = await service.list({});
    const [entry] = items;

    expect(entry.onBehalfOfUserId).toBe(7);
    expect(entry.justification).toBe('approved by manager');
    expect(entry.requestId).toBe('req-123');
    expect(entry.beforeSnapshot).toEqual({ status: 'pending' });
    expect(entry.afterSnapshot).toEqual({ status: 'approved' });
  });

  it('tolerates malformed JSON in snapshots', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 1 }], null])
      .mockResolvedValueOnce([[buildRow({ before_snapshot: 'not-json', after_snapshot: '{bad' })], null]);

    const service = new AuditLogService(pool);
    const { items } = await service.list({});
    expect(items[0].beforeSnapshot).toBeNull();
    expect(items[0].afterSnapshot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe('AuditLogService.getById', () => {
  it('returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new AuditLogService(pool);
    expect(await service.getById(99)).toBeNull();
  });

  it('maps all fields including new ones', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow({
      on_behalf_of_user_id: 3,
      justification: 'emergency override',
      request_id: 'req-456',
    })], null]);
    const service = new AuditLogService(pool);
    const entry = await service.getById(1);

    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(1);
    expect(entry!.action).toBe('login');
    expect(entry!.userId).toBe(5);
    expect(entry!.onBehalfOfUserId).toBe(3);
    expect(entry!.justification).toBe('emergency override');
    expect(entry!.requestId).toBe('req-456');
    expect(entry!.ipAddress).toBe('127.0.0.1');
    expect(entry!.userAgent).toBe('jest');
  });
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

describe('AuditLogService.write', () => {
  it('inserts all basic fields', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);

    const service = new AuditLogService(pool);
    await service.write({ actorId: 5, action: 'user.update', entityType: 'user', entityId: 10 });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO audit_logs/);
    expect(params[0]).toBe(5);      // user_id
    expect(params[2]).toBe('user.update'); // action
    expect(params[3]).toBe('user');  // entity_type
    expect(params[4]).toBe(10);     // entity_id
  });

  it('writes justification and onBehalfOfUserId', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);

    const service = new AuditLogService(pool);
    await service.write({
      actorId: 2,
      action: 'timeoff.approve',
      onBehalfOfUserId: 9,
      justification: 'within authority',
    });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(9);                    // on_behalf_of_user_id
    expect(params[6]).toBe('within authority');    // justification
  });

  it('serialises before/after snapshots as JSON', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);

    const service = new AuditLogService(pool);
    await service.write({
      actorId: 1,
      action: 'role.update',
      before: { name: 'Manager' },
      after: { name: 'Senior Manager' },
    });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(JSON.parse(params[7] as string)).toEqual({ name: 'Manager' });
    expect(JSON.parse(params[8] as string)).toEqual({ name: 'Senior Manager' });
  });

  it('auto-pulls ip_address, user_agent and request_id from request context', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);

    jest.spyOn(requestContext, 'getRequestIp').mockReturnValue('10.0.0.1');
    jest.spyOn(requestContext, 'getRequestUserAgent').mockReturnValue('Mozilla/5.0');
    jest.spyOn(requestContext, 'getRequestId').mockReturnValue('req-ctx-id');

    const service = new AuditLogService(pool);
    await service.write({ actorId: 1, action: 'login' });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[9]).toBe('10.0.0.1');       // ip_address
    expect(params[10]).toBe('Mozilla/5.0');   // user_agent
    expect(params[11]).toBe('req-ctx-id');    // request_id
  });

  it('uses null for context fields when no request context is active', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, null]);

    jest.spyOn(requestContext, 'getRequestIp').mockReturnValue(null);
    jest.spyOn(requestContext, 'getRequestUserAgent').mockReturnValue(null);
    jest.spyOn(requestContext, 'getRequestId').mockReturnValue(undefined);

    const service = new AuditLogService(pool);
    await service.write({ actorId: 1, action: 'cron.run' });

    const params = execute.mock.calls[0][1] as unknown[];
    expect(params[9]).toBeNull();
    expect(params[10]).toBeNull();
    expect(params[11]).toBeNull();
  });

  it('swallows DB errors silently', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('DB down'));

    const service = new AuditLogService(pool);
    await expect(service.write({ actorId: 1, action: 'login' })).resolves.toBeUndefined();
  });
});
