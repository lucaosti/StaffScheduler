/**
 * The role assignment timeline.
 *
 * The cases that matter are the ones about what the audit log CANNOT tell you.
 * Current grants live in `user_roles`, events live in the audit log, and neither
 * is derivable from the other: a grant made before auditing existed has no
 * event, and a grant that reached its `expires_at` produced no event at all when
 * it lapsed. A view that quietly presented the events as the whole history would
 * state that someone never received a role they demonstrably hold, and would
 * show a lapsed grant as live.
 *
 * @author Luca Ostinelli
 */

import { RoleTimelineService } from '../services/RoleTimelineService';

export {};

/**
 * Dispatches on a distinctive fragment of each statement rather than on call
 * order, and THROWS on anything unrecognised — a sequence-based double turns a
 * newly added query into a silent empty result.
 */
const makePool = (rows: {
  audit?: unknown[];
  grants?: unknown[];
  users?: unknown[];
  roles?: unknown[];
  units?: unknown[];
}) => {
  const captured: string[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    captured.push(sql);
    if (sql.includes('FROM audit_logs')) return [rows.audit ?? [], []];
    if (sql.includes('FROM user_roles')) return [rows.grants ?? [], []];
    if (sql.includes('FROM users')) return [rows.users ?? [], []];
    if (sql.includes('FROM roles')) return [rows.roles ?? [], []];
    if (sql.includes('FROM org_units')) return [rows.units ?? [], []];
    throw new Error(`Unexpected query: ${sql.slice(0, 80)} / ${JSON.stringify(params)}`);
  });
  return { pool: { query } as never, captured };
};

const auditRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 99,
  action: 'role.grant',
  entity_id: 5,
  justification: 'new hire',
  before_snapshot: null,
  after_snapshot: { userId: 5, roleId: 3, scopeOrgUnitId: null, expiresAt: null },
  created_at: new Date('2026-03-01T10:00:00Z'),
  ...over,
});

const grantRow = (over: Record<string, unknown> = {}) => ({
  user_id: 5,
  role_id: 3,
  scope_org_unit_id: null,
  expires_at: null,
  ...over,
});

const names = {
  users: [{ id: 5, label: 'Anna Rossi' }, { id: 99, label: 'Carla Neri' }],
  roles: [{ id: 3, label: 'Manager' }],
  units: [{ id: 7, label: 'Ward A' }],
};

describe('the timeline for one person', () => {
  it('reads the grant payload out of the after-snapshot', async () => {
    const { pool } = makePool({ audit: [auditRow()], grants: [grantRow()], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.entries[0]).toMatchObject({
      action: 'granted',
      userId: 5,
      roleId: 3,
      roleName: 'Manager',
      actorId: 99,
      actorName: 'Carla Neri',
      justification: 'new hire',
      derived: false,
    });
  });

  it('reads a revocation out of the BEFORE-snapshot', async () => {
    // A revoke writes `before`, a grant writes `after`. Reading only one of
    // them is how half the timeline comes back with a null role.
    const { pool } = makePool({
      audit: [
        auditRow({
          id: 2,
          action: 'role.revoke',
          after_snapshot: null,
          before_snapshot: { userId: 5, roleId: 3, scopeOrgUnitId: 7 },
        }),
      ],
      grants: [],
      ...names,
    });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.entries[0]).toMatchObject({
      action: 'revoked',
      roleId: 3,
      roleName: 'Manager',
      scopeOrgUnitId: 7,
      scopeOrgUnitName: 'Ward A',
    });
  });

  it('parses a snapshot the driver handed back as a string', async () => {
    const { pool } = makePool({
      audit: [auditRow({ after_snapshot: JSON.stringify({ userId: 5, roleId: 3 }) })],
      grants: [],
      ...names,
    });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });
    expect(timeline.entries[0].roleId).toBe(3);
  });

  it('survives a snapshot that is not valid JSON', async () => {
    const { pool } = makePool({ audit: [auditRow({ after_snapshot: '{broken' })], grants: [], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });
    // A corrupt payload loses the role, not the entry: the fact that something
    // happened, and who did it, is still worth showing.
    expect(timeline.entries[0].roleId).toBeNull();
    expect(timeline.entries[0].actorId).toBe(99);
  });

  it('uses the indexed entity columns rather than scanning the snapshot', async () => {
    const { pool, captured } = makePool({ audit: [], grants: [], ...names });
    await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    const sql = captured.find((s) => s.includes('FROM audit_logs'))!;
    expect(sql).toContain("al.entity_type = 'user'");
    expect(sql).not.toContain('JSON_EXTRACT');
  });
});

describe('what the audit log cannot explain', () => {
  it('marks a current grant with no matching event', async () => {
    // Granted before auditing existed, or written by the seed. Saying nothing
    // would imply the person never received a role they demonstrably hold.
    const { pool } = makePool({ audit: [], grants: [grantRow()], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.current[0]).toMatchObject({ roleId: 3, roleName: 'Manager', hasHistory: false });
  });

  it('marks a current grant the timeline does explain', async () => {
    const { pool } = makePool({ audit: [auditRow()], grants: [grantRow()], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });
    expect(timeline.current[0].hasHistory).toBe(true);
  });

  it('synthesises an expiry, which nothing ever recorded', async () => {
    const expired = '2026-01-15T00:00:00.000Z';
    const { pool } = makePool({
      audit: [],
      grants: [grantRow({ expires_at: new Date(expired) })],
      ...names,
    });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    // Nobody revoked it — it simply stopped applying, and a timeline that only
    // showed the grant would present a lapsed role as live.
    expect(timeline.entries).toEqual([
      expect.objectContaining({ action: 'expired', derived: true, auditId: null, at: expired }),
    ]);
  });

  it('does not synthesise an expiry that has not happened yet', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { pool } = makePool({ audit: [], grants: [grantRow({ expires_at: future })], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.entries).toEqual([]);
    expect(timeline.current[0].expiresAt).toBe(future.toISOString());
  });

  it('leaves an open-ended grant alone', async () => {
    const { pool } = makePool({ audit: [], grants: [grantRow({ expires_at: null })], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });
    expect(timeline.entries).toEqual([]);
  });
});

describe('ordering and bounds', () => {
  it('returns the newest event first, derived entries included', async () => {
    const { pool } = makePool({
      audit: [
        auditRow({ id: 2, created_at: new Date('2026-05-01T00:00:00Z') }),
        auditRow({ id: 1, created_at: new Date('2026-01-01T00:00:00Z') }),
      ],
      grants: [grantRow({ expires_at: new Date('2026-03-01T00:00:00Z') })],
      ...names,
    });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    // The synthesised expiry has to sort into place, not be appended.
    expect(timeline.entries.map((e) => e.at)).toEqual([
      '2026-05-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('reports truncation instead of presenting a window as the whole story', async () => {
    const many = Array.from({ length: 501 }, (_, i) =>
      auditRow({ id: i + 1, created_at: new Date(2026, 0, 1, 0, 0, i) })
    );
    const { pool } = makePool({ audit: many, grants: [], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.truncated).toBe(true);
    expect(timeline.entries).toHaveLength(500);
  });

  it('is not truncated at exactly the cap', async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      auditRow({ id: i + 1, created_at: new Date(2026, 0, 1, 0, 0, i) })
    );
    const { pool } = makePool({ audit: many, grants: [], ...names });
    const timeline = await new RoleTimelineService(pool).getTimeline({ userId: 5 });

    expect(timeline.truncated).toBe(false);
  });
});

describe('the timeline for one role', () => {
  it('matches the role id inside either snapshot', async () => {
    const { pool, captured } = makePool({ audit: [auditRow()], grants: [grantRow()], ...names });
    await new RoleTimelineService(pool).getTimeline({ roleId: 3 });

    const sql = captured.find((s) => s.includes('FROM audit_logs'))!;
    // A grant records the role in `after`, a revoke in `before`; matching only
    // one would show half the role's history.
    expect(sql).toContain("JSON_EXTRACT(al.after_snapshot, '$.roleId')");
    expect(sql).toContain("JSON_EXTRACT(al.before_snapshot, '$.roleId')");
  });

  it('narrows by date when asked, which is what bounds the scan', async () => {
    const { pool, captured } = makePool({ audit: [], grants: [], ...names });
    await new RoleTimelineService(pool).getTimeline({ roleId: 3, since: '2026-01-01' });

    expect(captured.find((s) => s.includes('FROM audit_logs'))).toContain('al.created_at >= ?');
  });

  it('lists everyone currently holding the role', async () => {
    const { pool } = makePool({
      audit: [],
      grants: [grantRow(), grantRow({ user_id: 99 })],
      ...names,
    });
    const timeline = await new RoleTimelineService(pool).getTimeline({ roleId: 3 });

    expect(timeline.current.map((g) => g.userName)).toEqual(['Anna Rossi', 'Carla Neri']);
  });
});

describe('the argument contract', () => {
  it('refuses a call with neither a user nor a role', async () => {
    // Without one of the two this is a full scan of a table that only grows.
    const { pool } = makePool({});
    await expect(new RoleTimelineService(pool).getTimeline({})).rejects.toThrow(/userId or a roleId/);
  });
});
