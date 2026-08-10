/**
 * Cost plan CRUD: the admin-set labor-cost target per department per period.
 *
 * The behaviour worth testing here is the uniqueness rule — one target per
 * department per period, enforced by the table's unique key and surfaced as
 * a named conflict rather than a raw MySQL error — and the period-overlap sum
 * `/dashboard/stats` reads for the current month's comparison.
 *
 * @author Luca Ostinelli
 */

import { CostPlanService } from '../services/CostPlanService';
import { ConflictError, NotFoundError } from '../errors';

export {};

const makePool = () => {
  const query = jest.fn();
  const execute = jest.fn();
  return { pool: { query, execute } as never, query, execute };
};

const planRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  department_id: 2,
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  target_amount: '10000.00',
  set_by_user_id: 7,
  created_at: new Date('2026-08-01T00:00:00Z'),
  updated_at: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

describe('CostPlanService.list', () => {
  it('lists every plan when no department is given', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[planRow(), planRow({ id: 2, department_id: 3 })], undefined]);

    const plans = await new CostPlanService(pool).list();

    expect(plans).toHaveLength(2);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('scopes the list to one department when given', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[planRow()], undefined]);

    const plans = await new CostPlanService(pool).list(2);

    expect(plans).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('WHERE department_id = ?');
    expect(params).toEqual([2]);
  });
});

describe('CostPlanService.getById', () => {
  it('404s when no plan has that id', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[], undefined]);
    await expect(new CostPlanService(pool).getById(99)).rejects.toThrow(NotFoundError);
  });

  it('maps Date-typed start/end columns (as returned by a real driver) to ISO date strings', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([
      [planRow({ start_date: new Date('2026-08-01T00:00:00Z'), end_date: new Date('2026-08-31T00:00:00Z') })],
      undefined,
    ]);
    const plan = await new CostPlanService(pool).getById(1);
    expect(plan.startDate).toBe('2026-08-01');
    expect(plan.endDate).toBe('2026-08-31');
  });
});

describe('CostPlanService.create', () => {
  it('inserts a row and returns it', async () => {
    const { pool, query, execute } = makePool();
    execute.mockResolvedValueOnce([{ insertId: 1 }, undefined]);
    query.mockResolvedValueOnce([[planRow()], undefined]);

    const plan = await new CostPlanService(pool).create({
      departmentId: 2,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      targetAmount: 10000,
      setByUserId: 7,
    });

    expect(plan.targetAmount).toBe(10000);
    expect(plan.departmentId).toBe(2);
  });

  it('rejects endDate before startDate before touching the database', async () => {
    const { pool, execute } = makePool();
    await expect(
      new CostPlanService(pool).create({
        departmentId: 2,
        startDate: '2026-08-31',
        endDate: '2026-08-01',
        targetAmount: 10000,
        setByUserId: 7,
      })
    ).rejects.toThrow(ConflictError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('turns a duplicate-key error into a named conflict', async () => {
    const { pool, execute } = makePool();
    const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    execute.mockRejectedValueOnce(dup);

    await expect(
      new CostPlanService(pool).create({
        departmentId: 2,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        targetAmount: 10000,
        setByUserId: 7,
      })
    ).rejects.toThrow(ConflictError);
  });

  it('re-throws any error that is not a duplicate-key conflict', async () => {
    const { pool, execute } = makePool();
    const dbError = new Error('connection reset');
    execute.mockRejectedValueOnce(dbError);

    await expect(
      new CostPlanService(pool).create({
        departmentId: 2,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        targetAmount: 10000,
        setByUserId: 7,
      })
    ).rejects.toBe(dbError);
  });
});

describe('CostPlanService.update', () => {
  it('404s when there is nothing to update', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    await expect(new CostPlanService(pool).update(99, 500)).rejects.toThrow(NotFoundError);
  });

  it('updates the target amount and returns the refreshed row', async () => {
    const { pool, execute, query } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    query.mockResolvedValueOnce([[planRow({ target_amount: '12000.00' })], undefined]);

    const plan = await new CostPlanService(pool).update(1, 12000);
    expect(plan.targetAmount).toBe(12000);
  });
});

describe('CostPlanService.remove', () => {
  it('404s when there is nothing to delete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
    await expect(new CostPlanService(pool).remove(99)).rejects.toThrow(NotFoundError);
  });

  it('deletes the row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    await expect(new CostPlanService(pool).remove(1)).resolves.toBeUndefined();
  });
});

describe('CostPlanService.sumTargetForWindow', () => {
  it('sums every plan whose period overlaps the window', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[{ total: '5000' }], undefined]);

    const total = await new CostPlanService(pool).sumTargetForWindow('2026-08-01', '2026-08-31');
    expect(total).toBe(5000);
  });

  it('scopes to one department when given', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[{ total: '2000' }], undefined]);

    await new CostPlanService(pool).sumTargetForWindow('2026-08-01', '2026-08-31', 2);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('department_id = ?');
    expect(params).toEqual(['2026-08-31', '2026-08-01', 2]);
  });

  it('falls back to zero when no plan overlaps the window (SUM returns NULL)', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[{ total: null }], undefined]);

    const total = await new CostPlanService(pool).sumTargetForWindow('2026-08-01', '2026-08-31');
    expect(total).toBe(0);
  });
});

describe('CostPlanService.findForPeriod', () => {
  it('returns null when no plan matches the exact period', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[], undefined]);
    const plan = await new CostPlanService(pool).findForPeriod(2, '2026-08-01', '2026-08-31');
    expect(plan).toBeNull();
  });

  it('returns the matching plan when one exists for the exact period', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[planRow()], undefined]);
    const plan = await new CostPlanService(pool).findForPeriod(2, '2026-08-01', '2026-08-31');
    expect(plan?.id).toBe(1);
  });
});
