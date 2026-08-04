/**
 * KioskService unit tests.
 */

import { KioskService } from '../services/KioskService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Break room tablet',
  department_id: 10,
  is_active: 1,
  created_at: '2026-07-10T08:00:00.000Z',
  last_used_at: null,
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('KioskService.listForDepartment', () => {
  it('maps rows into KioskDevice objects', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);

    const [device] = await new KioskService(pool).listForDepartment(10);
    expect(device).toEqual({
      id: 1,
      name: 'Break room tablet',
      departmentId: 10,
      isActive: true,
      createdAt: '2026-07-10T08:00:00.000Z',
      lastUsedAt: null,
    });
  });
});

describe('KioskService.create', () => {
  it('issues a raw token and returns it alongside the created device', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 5 })], null] as Tuple);

    const { device, token } = await new KioskService(pool).create(10, 'Break room tablet', 1);

    expect(device.id).toBe(5);
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
    // The stored value is a hash, never the raw token.
    expect(execute.mock.calls[0][1][2]).not.toBe(token);
    expect(execute.mock.calls[0][1]).toEqual(['Break room tablet', 10, execute.mock.calls[0][1][2], 1]);
  });
});

describe('KioskService.revoke', () => {
  it('deactivates the device', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await expect(new KioskService(pool).revoke(1)).resolves.toBeUndefined();
    expect(execute.mock.calls[0][0]).toContain('is_active = 0');
  });

  it('throws NotFoundError when no device matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);

    await expect(new KioskService(pool).revoke(999)).rejects.toThrow(/not found/i);
  });
});

describe('KioskService.resolveEmployee', () => {
  it('resolves an active employee within the given department', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 7, first_name: 'Ada', last_name: 'Lovelace' }], null] as Tuple);

    const employee = await new KioskService(pool).resolveEmployee('E-007', 10);
    expect(employee).toEqual({ id: 7, name: 'Ada Lovelace' });
    expect(execute.mock.calls[0][1]).toEqual(['E-007', 10]);
  });

  it('returns null when the employee id does not resolve to anyone in that department', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    const employee = await new KioskService(pool).resolveEmployee('unknown', 10);
    expect(employee).toBeNull();
  });
});

describe('KioskService.authenticate', () => {
  it('returns null for an unknown or revoked token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    const device = await new KioskService(pool).authenticate('deadbeef');
    expect(device).toBeNull();
  });

  it('returns the device and records last_used_at for a valid token', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildRow()], null] as Tuple)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    const device = await new KioskService(pool).authenticate('sometoken');
    expect(device?.id).toBe(1);
    expect(execute.mock.calls[1][0]).toContain('last_used_at = CURRENT_TIMESTAMP');
  });

  it('only matches active devices (the query itself is scoped, not filtered after)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    await new KioskService(pool).authenticate('sometoken');
    expect(execute.mock.calls[0][0]).toContain('is_active = 1');
  });
});
