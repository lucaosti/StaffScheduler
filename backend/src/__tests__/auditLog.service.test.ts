/**
 * AuditLogService unit tests (F10).
 */

import { AuditLogService } from '../services/AuditLogService';

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 5,
  action: 'login',
  entity_type: 'auth',
  entity_id: null,
  description: 'User signed in',
  ip_address: '127.0.0.1',
  user_agent: 'jest',
  created_at: '2026-04-26T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

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
    expect(execute.mock.calls[1][0]).toMatch(/LIMIT 100 OFFSET 0/);
  });

  it('clamps a huge limit to 500', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({ limit: 9999 });
    expect(execute.mock.calls[1][0]).toMatch(/LIMIT 500/);
  });

  it('builds the WHERE clause from supplied filters', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ c: 0 }], null])
      .mockResolvedValueOnce([[], null]);

    const service = new AuditLogService(pool);
    await service.list({
      userId: 5,
      action: 'login',
      entityType: 'auth',
      entityId: 99,
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
    });

    const sqlCount = execute.mock.calls[0][0] as string;
    expect(sqlCount).toMatch(/user_id = \?/);
    expect(sqlCount).toMatch(/action = \?/);
    expect(sqlCount).toMatch(/entity_type = \?/);
    expect(sqlCount).toMatch(/entity_id = \?/);
    expect(sqlCount).toMatch(/created_at >= \?/);
    expect(sqlCount).toMatch(/created_at <= \?/);
    expect(execute.mock.calls[0][1]).toEqual([5, 'login', 'auth', 99, '2026-04-01', '2026-04-30']);
  });
});

describe('AuditLogService.getById', () => {
  it('returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new AuditLogService(pool);
    expect(await service.getById(99)).toBeNull();
  });

  it('maps a row to a typed entry', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null]);
    const service = new AuditLogService(pool);
    const entry = await service.getById(1);
    expect(entry).toMatchObject({ id: 1, action: 'login', userId: 5 });
  });
});
