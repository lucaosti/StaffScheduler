/**
 * Audit log hardening tests — immutability enforcement + export.
 *
 * B1 — Immutability:
 *   - AuditLogService exposes no delete/update public methods
 *   - write() is insert-only and never calls UPDATE or DELETE
 *
 * B4 — Export:
 *   - exportAll() returns all entries matching filters (no limit/offset)
 *   - exportAll() uses ASC ordering (chronological for compliance)
 *   - AuditLogService.toCsv() produces correct CSV output
 *   - AuditLogService.toCsv() escapes fields containing commas/quotes
 *   - exportAll() with format validation (route-level tested separately)
 */

import { AuditLogService } from '../services/AuditLogService';
import { ValidationError } from '../errors';

// Shared pool helper
const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as unknown as import('mysql2/promise').Pool, execute };
};

// ---------------------------------------------------------------------------
// B1 — Immutability
// ---------------------------------------------------------------------------

describe('AuditLogService — immutability enforcement (application layer)', () => {
  it('does not expose a delete() method', () => {
    const { pool } = makePool();
    const svc = new AuditLogService(pool);
    expect((svc as any).delete).toBeUndefined();
    expect((svc as any).deleteById).toBeUndefined();
  });

  it('does not expose an update() method', () => {
    const { pool } = makePool();
    const svc = new AuditLogService(pool);
    expect((svc as any).update).toBeUndefined();
    expect((svc as any).updateById).toBeUndefined();
  });

  it('write() only issues INSERT statements, never UPDATE or DELETE', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ insertId: 1 }, null]);

    const svc = new AuditLogService(pool);
    await svc.write({ actorId: 1, action: 'test.action' });

    for (const [sql] of execute.mock.calls as [string, ...unknown[]][]) {
      expect(sql.toUpperCase()).not.toMatch(/^\s*(UPDATE|DELETE)\s/);
    }
    expect(execute.mock.calls[0][0]).toContain('INSERT INTO audit_logs');
  });
});

// ---------------------------------------------------------------------------
// B4 — Export
// ---------------------------------------------------------------------------

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 10,
  on_behalf_of_user_id: null,
  action: 'role.grant',
  entity_type: 'user',
  entity_id: 5,
  description: 'Role 2 granted',
  justification: 'Team restructuring',
  before_snapshot: null,
  after_snapshot: JSON.stringify({ roleId: 2 }),
  ip_address: '127.0.0.1',
  user_agent: 'test-agent',
  request_id: 'req-abc',
  created_at: '2026-06-01T10:00:00.000Z',
  ...overrides,
});

describe('AuditLogService.exportAll', () => {
  it('returns every matching entry, with no paging offset, under a safety cap', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[entry(), entry({ id: 2 }), entry({ id: 3 })], null]);

    const svc = new AuditLogService(pool);
    const result = await svc.exportAll({});

    expect(result).toHaveLength(3);
    const [sql] = execute.mock.calls[0] as [string, ...unknown[]];
    // Paging must not apply to an export...
    expect(sql.toUpperCase()).not.toContain('OFFSET');
    // ...but the query is bounded so one unscoped export cannot exhaust memory.
    // The cap is fetched + 1 purely to detect overflow.
    expect(sql.toUpperCase()).toContain('LIMIT 100001');
  });

  it('refuses (rather than silently truncating) when the export exceeds the cap', async () => {
    const { pool, execute } = makePool();
    // One row past the 100_000 cap is enough to signal overflow.
    const overflow = Array.from({ length: 100_001 }, (_, i) => entry({ id: i + 1 }));
    execute.mockResolvedValue([overflow, null]); // both assertions below re-query

    const svc = new AuditLogService(pool);
    // A partial audit export that looks complete would be worse than an error.
    await expect(svc.exportAll({})).rejects.toThrow(ValidationError);
    await expect(svc.exportAll({})).rejects.toThrow(/more than 100000 entries/i);
  });

  it('uses ASC ordering for chronological compliance record', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new AuditLogService(pool);
    await svc.exportAll({});

    const [sql] = execute.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('ORDER BY created_at ASC');
  });

  it('applies userId filter to the query', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new AuditLogService(pool);
    await svc.exportAll({ userId: 42 });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_id = ?');
    expect(params).toContain(42);
  });

  it('applies fromDate and toDate filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);

    const svc = new AuditLogService(pool);
    await svc.exportAll({ fromDate: '2026-01-01', toDate: '2026-12-31' });

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-12-31');
  });
});

describe('AuditLogService.toCsv', () => {
  it('produces a header row plus one data row per entry', () => {
    const entries = [entry(), entry({ id: 2 })].map((e) => ({
      id: e.id as number,
      userId: e.user_id as number | null,
      onBehalfOfUserId: e.on_behalf_of_user_id as number | null,
      action: e.action as string,
      entityType: e.entity_type as string | null,
      entityId: e.entity_id as number | null,
      description: e.description as string | null,
      justification: e.justification as string | null,
      beforeSnapshot: null,
      afterSnapshot: { roleId: 2 },
      ipAddress: e.ip_address as string | null,
      userAgent: e.user_agent as string | null,
      requestId: e.request_id as string | null,
      createdAt: e.created_at as string,
    }));

    const csv = AuditLogService.toCsv(entries);
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines).toHaveLength(3); // 1 header + 2 data rows
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('action');
    expect(lines[0]).toContain('justification');
  });

  it('wraps fields containing commas in double quotes', () => {
    const e = {
      id: 1,
      userId: null, onBehalfOfUserId: null,
      action: 'test',
      entityType: null, entityId: null,
      description: 'Changed name, title',
      justification: null,
      beforeSnapshot: null, afterSnapshot: null,
      ipAddress: null, userAgent: null, requestId: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const csv = AuditLogService.toCsv([e]);
    expect(csv).toContain('"Changed name, title"');
  });

  it('escapes internal double quotes by doubling them', () => {
    const e = {
      id: 1,
      userId: null, onBehalfOfUserId: null,
      action: 'test',
      entityType: null, entityId: null,
      description: 'He said "approved"',
      justification: null,
      beforeSnapshot: null, afterSnapshot: null,
      ipAddress: null, userAgent: null, requestId: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const csv = AuditLogService.toCsv([e]);
    expect(csv).toContain('"He said ""approved"""');
  });

  it('returns only the header row for an empty entry array', () => {
    const csv = AuditLogService.toCsv([]);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
