/**
 * PersonHistoryService — as-of projection from the audit trail (#600).
 *
 * `getSnapshot` runs its three dimensions (roles, membership, headship)
 * concurrently via `Promise.all`, and headship additionally goes through the
 * real `OrgUnitService.list()` on the same pool — so mocks are dispatched by
 * query fragment, not call order, exactly like AutoScheduleService's suite.
 * A statement this doesn't recognise throws rather than returning an empty
 * set, so a new query cannot silently look like "no results".
 */

import { PersonHistoryService } from '../services/PersonHistoryService';

type Rows = Array<Record<string, unknown>>;

interface Fixtures {
  roles?: Rows;
  membership?: Rows;
  units?: Rows;
  headshipBackfill?: Rows;
}

const MATCHERS: Array<[keyof Fixtures, string]> = [
  ['roles', "'role.grant', 'role.revoke'"],
  ['membership', "'org_unit.member_add'"],
  ['headshipBackfill', 'MIN(created_at)'],
  ['units', 'FROM org_units ORDER BY'],
];

const makePool = (fixtures: Fixtures = {}) => {
  const table: Fixtures = { roles: [], membership: [], units: [], headshipBackfill: [], ...fixtures };
  const execute = jest.fn(async (sql: string) => {
    const hit = MATCHERS.find(([, fragment]) => sql.includes(fragment));
    if (!hit) throw new Error(`no fixture matches this query:\n${sql}`);
    return [table[hit[0]] ?? [], null];
  });
  return { pool: { execute } as never, execute };
};

const roleEvent = (overrides: Record<string, unknown> = {}) => ({
  action: 'role.grant',
  before_snapshot: null,
  after_snapshot: JSON.stringify({ roleId: 5, scopeOrgUnitId: null, expiresAt: null }),
  created_at: '2026-01-01 00:00:00',
  ...overrides,
});

const membershipEvent = (overrides: Record<string, unknown> = {}) => ({
  action: 'org_unit.member_add',
  before_snapshot: null,
  after_snapshot: JSON.stringify({ userId: 7, orgUnitId: 3, isPrimary: true }),
  created_at: '2026-01-01 00:00:00',
  ...overrides,
});

const orgUnitRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Unit',
  description: null,
  parent_id: null,
  manager_user_id: null,
  is_active: 1,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

describe('PersonHistoryService.getSnapshot — roles', () => {
  it('reduces grant/revoke events into currently-held roles', async () => {
    const { pool } = makePool({
      roles: [
        roleEvent({ after_snapshot: JSON.stringify({ roleId: 5, scopeOrgUnitId: null, expiresAt: null }) }),
        roleEvent({
          action: 'role.revoke',
          before_snapshot: JSON.stringify({ roleId: 5, scopeOrgUnitId: null }),
          after_snapshot: null,
          created_at: '2026-01-05 00:00:00',
        }),
        roleEvent({ after_snapshot: JSON.stringify({ roleId: 9, scopeOrgUnitId: 2, expiresAt: null }) }),
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.rolesHeld).toEqual([{ roleId: 9, scopeOrgUnitId: 2, expiresAt: null }]);
  });

  it('excludes a role that had already expired as of the snapshot date', async () => {
    const { pool } = makePool({
      roles: [
        roleEvent({ after_snapshot: JSON.stringify({ roleId: 5, scopeOrgUnitId: null, expiresAt: '2026-02-01 00:00:00' }) }),
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.rolesHeld).toEqual([]);
  });

  it('ignores an event whose grant snapshot did not parse', async () => {
    const { pool } = makePool({
      roles: [roleEvent({ after_snapshot: 'not json' })],
    });
    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.rolesHeld).toEqual([]);
  });
});

describe('PersonHistoryService.getSnapshot — org-unit membership', () => {
  it('reduces add/remove/primary_set events into current membership', async () => {
    const { pool } = makePool({
      membership: [
        membershipEvent({ after_snapshot: JSON.stringify({ userId: 7, orgUnitId: 3, isPrimary: true }) }),
        membershipEvent({
          after_snapshot: JSON.stringify({ userId: 7, orgUnitId: 4, isPrimary: false }),
          created_at: '2026-01-02 00:00:00',
        }),
        membershipEvent({
          action: 'org_unit.primary_set',
          after_snapshot: JSON.stringify({ userId: 7, orgUnitId: 4, isPrimary: true }),
          created_at: '2026-01-03 00:00:00',
        }),
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.orgUnitsBelongedTo).toEqual(
      expect.arrayContaining([
        { orgUnitId: 3, isPrimary: false },
        { orgUnitId: 4, isPrimary: true },
      ])
    );
    // Exclusive: only one unit is primary once primary_set moved it.
    expect(snapshot.orgUnitsBelongedTo.filter((u) => u.isPrimary)).toHaveLength(1);
  });

  it('drops a unit once member_remove is replayed', async () => {
    const { pool } = makePool({
      membership: [
        membershipEvent({ after_snapshot: JSON.stringify({ userId: 7, orgUnitId: 3, isPrimary: false }) }),
        membershipEvent({
          action: 'org_unit.member_remove',
          before_snapshot: JSON.stringify({ userId: 7, orgUnitId: 3 }),
          after_snapshot: null,
          created_at: '2026-01-02 00:00:00',
        }),
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.orgUnitsBelongedTo).toEqual([]);
  });
});

describe('PersonHistoryService.getSnapshot — org-unit headship', () => {
  it('uses the CURRENT manager when the unit was never updated', async () => {
    const { pool } = makePool({
      units: [orgUnitRow({ id: 1, manager_user_id: 7 }), orgUnitRow({ id: 2, manager_user_id: 9 })],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.orgUnitsHeaded).toEqual([1]);
  });

  it('walks back to the pre-update manager when the unit changed after the snapshot date', async () => {
    // Unit 1 is CURRENTLY headed by user 9, but the earliest update after
    // the snapshot date shows the manager was 7 immediately before it.
    const { pool } = makePool({
      units: [orgUnitRow({ id: 1, manager_user_id: 9 })],
      headshipBackfill: [
        { entity_id: 1, before_snapshot: JSON.stringify({ managerUserId: 7 }) },
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.orgUnitsHeaded).toEqual([1]);
  });

  it('reports no headship when neither the current nor the reconstructed manager matches', async () => {
    const { pool } = makePool({
      units: [orgUnitRow({ id: 1, manager_user_id: 9 })],
      headshipBackfill: [
        { entity_id: 1, before_snapshot: JSON.stringify({ managerUserId: 11 }) },
      ],
    });

    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.orgUnitsHeaded).toEqual([]);
  });
});

describe('PersonHistoryService.getSnapshot — envelope', () => {
  it('echoes userId and asOf back verbatim', async () => {
    const { pool } = makePool();
    const snapshot = await new PersonHistoryService(pool).getSnapshot(7, '2026-06-01 23:59:59');
    expect(snapshot.userId).toBe(7);
    expect(snapshot.asOf).toBe('2026-06-01 23:59:59');
  });
});
