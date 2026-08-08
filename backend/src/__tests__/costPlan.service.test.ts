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
});

describe('CostPlanService.findForPeriod', () => {
  it('returns null when no plan matches the exact period', async () => {
    const { pool, query } = makePool();
    query.mockResolvedValueOnce([[], undefined]);
    const plan = await new CostPlanService(pool).findForPeriod(2, '2026-08-01', '2026-08-31');
    expect(plan).toBeNull();
  });
});
