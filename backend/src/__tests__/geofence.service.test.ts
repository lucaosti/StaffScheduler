/**
 * GeofenceService unit tests.
 */

import { GeofenceService } from '../services/GeofenceService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  department_id: 10,
  name: 'Main office',
  polygon: JSON.stringify([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }]),
  is_active: 1,
  created_at: '2026-07-10T08:00:00.000Z',
  updated_at: '2026-07-10T08:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('GeofenceService.listForDepartment', () => {
  it('parses the stored JSON polygon back into points', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);

    const [fence] = await new GeofenceService(pool).listForDepartment(10);
    expect(fence.polygon).toEqual([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }]);
    expect(fence.isActive).toBe(true);
  });
});

describe('GeofenceService.create', () => {
  it('stores the polygon as JSON and re-reads the created row', async () => {
    const { pool, execute } = makePool();
    const polygon = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }];
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 5, polygon: JSON.stringify(polygon) })], null] as Tuple);

    const created = await new GeofenceService(pool).create(10, { name: 'Main office', polygon });

    expect(created.id).toBe(5);
    expect(execute.mock.calls[0][1]).toEqual([10, 'Main office', JSON.stringify(polygon), true]);
  });

  it('defaults isActive to true when not given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 5 })], null] as Tuple);

    await new GeofenceService(pool).create(10, { name: 'X', polygon: [] });
    expect(execute.mock.calls[0][1][3]).toBe(true);
  });
});

describe('GeofenceService.update', () => {
  it('updates only the provided fields', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ name: 'Renamed' })], null] as Tuple);

    const updated = await new GeofenceService(pool).update(1, { name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(execute.mock.calls[0][0]).toContain('name = ?');
    expect(execute.mock.calls[0][0]).not.toContain('polygon = ?');
  });

  it('updates only the polygon when that is the only field given', async () => {
    const { pool, execute } = makePool();
    const polygon = [{ lat: 5, lng: 5 }, { lat: 5, lng: 6 }, { lat: 6, lng: 6 }];
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ polygon: JSON.stringify(polygon) })], null] as Tuple);

    const updated = await new GeofenceService(pool).update(1, { polygon });

    expect(updated.polygon).toEqual(polygon);
    expect(execute.mock.calls[0][0]).toContain('polygon = ?');
    expect(execute.mock.calls[0][0]).not.toContain('name = ?');
  });

  it('updates only isActive when that is the only field given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ is_active: 0 })], null] as Tuple);

    const updated = await new GeofenceService(pool).update(1, { isActive: false });

    expect(updated.isActive).toBe(false);
    expect(execute.mock.calls[0][0]).toContain('is_active = ?');
    expect(execute.mock.calls[0][1]).toEqual([0, 1]);
  });

  it('throws NotFoundError when no row matches the id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);

    await expect(new GeofenceService(pool).update(999, { name: 'X' })).rejects.toThrow(/not found/i);
  });

  it('is a no-op re-read when no fields are given', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);

    const updated = await new GeofenceService(pool).update(1, {});
    expect(updated.id).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1); // only the re-read, no UPDATE issued
  });
});

describe('GeofenceService.delete', () => {
  it('deletes and returns true', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await expect(new GeofenceService(pool).delete(1)).resolves.toBe(true);
  });

  it('throws NotFoundError when nothing was deleted', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple);

    await expect(new GeofenceService(pool).delete(999)).rejects.toThrow(/not found/i);
  });
});

describe('GeofenceService.isCallerWithinAllowedGeofence', () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }];

  it('is not required when the caller has no active geofence', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    const result = await new GeofenceService(pool).isCallerWithinAllowedGeofence(5, null);
    expect(result).toEqual({ required: false, allowed: true });
  });

  it('is required and disallowed with no point when a fence exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ polygon: JSON.stringify(square) }], null] as Tuple);

    const result = await new GeofenceService(pool).isCallerWithinAllowedGeofence(5, null);
    expect(result).toEqual({ required: true, allowed: false });
  });

  it('allows a point inside the fence', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ polygon: JSON.stringify(square) }], null] as Tuple);

    const result = await new GeofenceService(pool).isCallerWithinAllowedGeofence(5, { lat: 0.5, lng: 0.5 });
    expect(result).toEqual({ required: true, allowed: true });
  });

  it('disallows a point outside every fence', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ polygon: JSON.stringify(square) }], null] as Tuple);

    const result = await new GeofenceService(pool).isCallerWithinAllowedGeofence(5, { lat: 50, lng: 50 });
    expect(result).toEqual({ required: true, allowed: false });
  });

  it('scopes the lookup to the given user and only active fences', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    await new GeofenceService(pool).isCallerWithinAllowedGeofence(5, null);
    expect(execute.mock.calls[0][0]).toContain('g.is_active = 1');
    expect(execute.mock.calls[0][1]).toEqual([5]);
  });
});
