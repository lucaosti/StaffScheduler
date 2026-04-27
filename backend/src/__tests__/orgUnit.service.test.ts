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
