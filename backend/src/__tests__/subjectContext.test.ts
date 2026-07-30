/**
 * The subject context an approval is routed against.
 *
 * This exists because there were two of these and they disagreed: the
 * change-request path took the LOWEST org-unit membership id, the approval
 * engine read `is_primary`. For anyone in exactly one unit the two agree, which
 * is why it went unnoticed — so the decisive case here is a person in two, where
 * the primary is NOT the lowest id. Against the old change-request query that
 * case fails.
 *
 * @author Luca Ostinelli
 */

import { resolveSubjectContext } from '../services/subjectContext';

export {};

const makePool = (rows: { memberships: unknown[]; departments?: unknown[]; roles?: unknown[] }) => {
  const execute = jest.fn(async (sql: string) => {
    if (sql.includes('FROM user_org_units')) return [rows.memberships, []];
    if (sql.includes('FROM user_departments')) return [rows.departments ?? [], []];
    if (sql.includes('FROM user_roles')) return [rows.roles ?? [], []];
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  });
  return { execute, _execute: execute } as never;
};

describe('resolveSubjectContext', () => {
  it('takes the primary membership, not the lowest id', async () => {
    // The membership ordering the query imposes is what makes this row first;
    // the double returns whatever the SQL asked for, so the assertion is that
    // the SQL asks for `is_primary DESC` at all.
    const pool = makePool({ memberships: [{ org_unit_id: 20 }] });
    const ctx = await resolveSubjectContext(pool, 1);

    expect(ctx.orgUnitId).toBe(20);
    const sql = (pool as unknown as { _execute: jest.Mock })._execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY is_primary DESC/);
  });

  it('falls back to the lowest id when no primary is flagged', async () => {
    // Data predating the single-primary enforcement. Returning null here would
    // route those people's requests to nobody, which is worse than the previous
    // behaviour — so the previous behaviour is exactly what the fallback is.
    const sql = await (async () => {
      const pool = makePool({ memberships: [{ org_unit_id: 5 }] });
      await resolveSubjectContext(pool, 1);
      return (pool as unknown as { _execute: jest.Mock })._execute.mock.calls[0][0] as string;
    })();
    expect(sql).toMatch(/is_primary DESC, org_unit_id ASC/);
  });

  it('reports no unit for someone with no membership at all', async () => {
    const ctx = await resolveSubjectContext(makePool({ memberships: [] }), 1);
    expect(ctx.orgUnitId).toBeNull();
  });

  it('collects departments and unexpired roles', async () => {
    const ctx = await resolveSubjectContext(
      makePool({
        memberships: [{ org_unit_id: 1 }],
        departments: [{ department_id: 3 }, { department_id: 4 }],
        roles: [{ role_id: 7 }],
      }),
      1
    );
    expect(ctx.subjectDepartmentIds).toEqual([3, 4]);
    expect(ctx.subjectRoleIds).toEqual([7]);
  });

  it('excludes an expired role grant', async () => {
    const pool = makePool({ memberships: [{ org_unit_id: 1 }] });
    await resolveSubjectContext(pool, 1);
    const roleSql = (pool as unknown as { _execute: jest.Mock })._execute.mock.calls
      .map((c) => c[0] as string)
      .find((s) => s.includes('FROM user_roles'))!;
    // An expired grant must not route an approval, or someone keeps deciding
    // after their authority has lapsed.
    expect(roleSql).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/);
  });
});
