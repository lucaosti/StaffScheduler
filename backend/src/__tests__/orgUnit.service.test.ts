/**
 * OrgUnitService unit tests.
 *
 * Uses a queueable mysql2 Pool fake. Each test queues the result tuples the
 * service is expected to consume and asserts the shape of the call sequence.
 */

import { OrgUnitService } from '../services/OrgUnitService';

type Tuple = [unknown, unknown];

const buildUnit = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Hospital',
  description: 'root',
  parent_id: null,
  manager_user_id: 10,
  is_active: 1,
  created_at: '2026-04-25T12:00:00.000Z',
  updated_at: '2026-04-25T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  const fakeConn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const getConnection = jest.fn().mockResolvedValue(fakeConn);
  return { pool: { execute, getConnection } as never, execute, conn: fakeConn };
};

describe('OrgUnitService.tree', () => {
  it('builds a forest from a flat list', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        buildUnit({ id: 1, parent_id: null, name: 'Hospital' }),
        buildUnit({ id: 2, parent_id: 1, name: 'Area A' }),
        buildUnit({ id: 3, parent_id: 2, name: 'Dept 1' }),
        buildUnit({ id: 4, parent_id: null, name: 'Other root' }),
      ],
      null,
    ] as Tuple);

    const service = new OrgUnitService(pool);
    const tree = await service.tree();
    expect(tree).toHaveLength(2);
    const hospital = tree.find((n) => n.id === 1)!;
    expect(hospital.children).toHaveLength(1);
    expect(hospital.children[0].children).toHaveLength(1);
    expect(hospital.children[0].children[0].name).toBe('Dept 1');
  });
});

describe('OrgUnitService.create', () => {
  it('rejects empty name', async () => {
    const { pool } = makePool();
    const service = new OrgUnitService(pool);
    await expect(service.create({ name: '' })).rejects.toThrow(/name is required/);
  });

  it('persists and returns the created unit', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 11 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[buildUnit({ id: 11, name: 'New' })], null] as Tuple); // SELECT

    const service = new OrgUnitService(pool);
    const created = await service.create({ name: 'New' });
    expect(created.id).toBe(11);
    expect(created.name).toBe('New');
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO org_units/);
  });
});

describe('OrgUnitService.update', () => {
  it('refuses self-parent', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildUnit({ id: 1 })], null] as Tuple);
    const service = new OrgUnitService(pool);
    await expect(service.update(1, { parentId: 1 })).rejects.toThrow(/cannot equal id/);
  });

  it('audits the RESOLVED before/after state, not the raw (possibly partial) patch — #327', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildUnit({ id: 1, manager_user_id: 10 })], null] as Tuple) // getById (existing)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[buildUnit({ id: 1, manager_user_id: 42 })], null] as Tuple); // getById (refresh)

    const service = new OrgUnitService(pool);
    // Only managerUserId is sent — an appointment — leaving name/description/
    // parentId/isActive untouched.
    await service.update(1, { managerUserId: 42 }, 99);

    const auditCall = execute.mock.calls.find((call) => String(call[0]).includes('INSERT INTO audit_logs'));
    expect(auditCall).toBeDefined();
    const [, params] = auditCall as [string, unknown[]];
    expect(params[2]).toBe('org_unit.update'); // action
    const before = JSON.parse(params[7] as string);
    const after = JSON.parse(params[8] as string);
    expect(before.managerUserId).toBe(10);
    expect(after.managerUserId).toBe(42);
    // The unresolved-in-the-patch fields still round-trip to their unchanged
    // value, so "what did this unit look like before/after" is answerable in
    // full from the trail alone, not just the touched field.
    expect(before.name).toBe(after.name);
  });
});

describe('OrgUnitService.setPrimary', () => {
  it('demotes existing primaries and promotes the target', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // demote
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // promote

    const service = new OrgUnitService(pool);
    await service.setPrimary(7, 11);
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.execute.mock.calls[0][0]).toMatch(/SET is_primary = 0/);
    expect(conn.execute.mock.calls[1][0]).toMatch(/SET is_primary = 1/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back when membership is missing', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    const service = new OrgUnitService(pool);
    await expect(service.setPrimary(7, 11)).rejects.toThrow(/Membership not found/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('OrgUnitService.listMembersDetailed', () => {
  it('joins users for display-ready member rows', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, first_name: 'Mario', last_name: 'Rossi', email: 'mario@demo.local', position: 'Nurse', is_primary: 1 },
      ],
      null,
    ] as Tuple);
    execute.mockResolvedValueOnce([[], null] as Tuple); // listActiveLoansInto: none

    const service = new OrgUnitService(pool);
    const members = await service.listMembersDetailed(11);

    expect(members).toEqual([
      { userId: 7, firstName: 'Mario', lastName: 'Rossi', email: 'mario@demo.local', position: 'Nurse', isPrimary: true, onLoan: false },
    ]);
    expect(execute.mock.calls[0][0]).toMatch(/JOIN users u ON u\.id = uou\.user_id/);
  });

  it('appends loaned-in staff, flagged onLoan, after real members', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, first_name: 'Mario', last_name: 'Rossi', email: 'mario@demo.local', position: 'Nurse', is_primary: 1 },
      ],
      null,
    ] as Tuple); // real membership
    execute.mockResolvedValueOnce([
      [{ user_id: 9, start_date: '2026-08-01', end_date: '2026-08-14' }],
      null,
    ] as Tuple); // listActiveLoansInto
    execute.mockResolvedValueOnce([
      [{ user_id: 9, first_name: 'Anna', last_name: 'Bianchi', email: 'anna@demo.local', position: null }],
      null,
    ] as Tuple); // user lookup for the loaned-in id

    const service = new OrgUnitService(pool);
    const members = await service.listMembersDetailed(11);

    expect(members).toEqual([
      { userId: 7, firstName: 'Mario', lastName: 'Rossi', email: 'mario@demo.local', position: 'Nurse', isPrimary: true, onLoan: false },
      { userId: 9, firstName: 'Anna', lastName: 'Bianchi', email: 'anna@demo.local', position: null, isPrimary: false, onLoan: true },
    ]);
  });

  it('does not duplicate a user who is both a real member and on loan', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 7, first_name: 'Mario', last_name: 'Rossi', email: 'mario@demo.local', position: 'Nurse', is_primary: 1 },
      ],
      null,
    ] as Tuple);
    execute.mockResolvedValueOnce([
      [{ user_id: 7, start_date: '2026-08-01', end_date: '2026-08-14' }],
      null,
    ] as Tuple); // same user id already a member — should be filtered out before the user lookup

    const service = new OrgUnitService(pool);
    const members = await service.listMembersDetailed(11);

    expect(members).toEqual([
      { userId: 7, firstName: 'Mario', lastName: 'Rossi', email: 'mario@demo.local', position: 'Nurse', isPrimary: true, onLoan: false },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('OrgUnitService.getManagerChain', () => {
  it('returns an empty chain when the user has no primary unit', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // getPrimaryUnitForUser

    const service = new OrgUnitService(pool);
    expect(await service.getManagerChain(5)).toEqual([]);
  });

  it('walks from the primary unit up to the root, resolving each manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildUnit({ id: 3, name: 'Ward A', parent_id: 2, manager_user_id: 20 })], null] as Tuple) // getPrimaryUnitForUser
      .mockResolvedValueOnce([[{ id: 20, first_name: 'Head', last_name: 'Nurse', email: 'head@demo.local' }], null] as Tuple) // manager of unit 3
      .mockResolvedValueOnce([[buildUnit({ id: 2, name: 'Department', parent_id: 1, manager_user_id: 10 })], null] as Tuple) // getById(2)
      .mockResolvedValueOnce([[{ id: 10, first_name: 'General', last_name: 'Manager', email: 'gm@demo.local' }], null] as Tuple) // manager of unit 2
      .mockResolvedValueOnce([[buildUnit({ id: 1, name: 'Hospital', parent_id: null, manager_user_id: null })], null] as Tuple); // getById(1), no manager

    const service = new OrgUnitService(pool);
    const chain = await service.getManagerChain(7);

    expect(chain).toEqual([
      { unitId: 3, unitName: 'Ward A', manager: { id: 20, firstName: 'Head', lastName: 'Nurse', email: 'head@demo.local' } },
      { unitId: 2, unitName: 'Department', manager: { id: 10, firstName: 'General', lastName: 'Manager', email: 'gm@demo.local' } },
      { unitId: 1, unitName: 'Hospital', manager: null },
    ]);
  });
});
