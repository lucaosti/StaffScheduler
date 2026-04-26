/**
 * SkillService unit tests.
 *
 * Hits each public method's primary branch via the queueable-pool fake
 * pattern. Some methods take a connection from `pool.getConnection()` and
 * run inside a transaction; for those we expose a `conn` mock alongside
 * the pool's own `execute`.
 */

import { SkillService } from '../services/SkillService';

const buildSkill = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Triage',
  description: 'Initial assessment',
  is_active: 1,
  user_count: 4,
  shift_count: 3,
  created_at: '2026-04-26T12:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

describe('SkillService.createSkill', () => {
  it('rolls back when a skill with the same name already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 9 }], null]);
    const service = new SkillService(pool);
    await expect(service.createSkill({ name: 'Triage' } as never)).rejects.toThrow(/already exists/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('inserts the row, commits, and returns the persisted skill', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 42 }, null]);
    execute.mockResolvedValueOnce([[buildSkill({ id: 42 })], null]);

    const service = new SkillService(pool);
    const created = await service.createSkill({ name: 'Triage', description: 'desc' } as never);
    expect(created.id).toBe(42);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('SkillService.getSkillById', () => {
  it('returns null when no row matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new SkillService(pool);
    expect(await service.getSkillById(99)).toBeNull();
  });

  it('maps user_count and shift_count', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSkill()], null]);
    const service = new SkillService(pool);
    const skill = await service.getSkillById(1);
    expect(skill?.userCount).toBe(4);
    expect(skill?.shiftCount).toBe(3);
  });
});

describe('SkillService.getAllSkills', () => {
  it('appends an isActive filter when provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSkill()], null]);
    const service = new SkillService(pool);
    await service.getAllSkills({ isActive: true });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_active = \?/);
  });

  it('returns all skills with no filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSkill(), buildSkill({ id: 2, name: 'CPR' })], null]);
    const service = new SkillService(pool);
    const skills = await service.getAllSkills();
    expect(skills).toHaveLength(2);
  });
});

describe('SkillService.updateSkill', () => {
  it('throws when the skill does not exist', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]); // existing check
    execute.mockResolvedValueOnce([[], null]); // would refetch
    const service = new SkillService(pool);
    await expect(service.updateSkill(99, { name: 'X' } as never)).rejects.toThrow();
  });
});

describe('SkillService.deleteSkill', () => {
  it('soft-deletes and commits', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[buildSkill()], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[buildSkill({ is_active: 0 })], null]);
    const service = new SkillService(pool);
    const ok = await service.deleteSkill(1);
    expect(ok).toBe(true);
  });
});

describe('SkillService.assignSkillsToUser', () => {
  it('rejects when the user does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]); // user lookup empty
    const service = new SkillService(pool);
    await expect(service.assignSkillsToUser(7, [1])).rejects.toThrow(/User not found/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('replaces the existing user_skills set in a transaction', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 7 }], null]) // user exists
      .mockResolvedValueOnce([{ affectedRows: 3 }, null]) // DELETE
      .mockResolvedValueOnce([[{ id: 1 }], null]) // skill 1 valid
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // INSERT 1
      .mockResolvedValueOnce([[{ id: 2 }], null]) // skill 2 valid
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT 2
    const service = new SkillService(pool);
    const ok = await service.assignSkillsToUser(7, [1, 2]);
    expect(ok).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back when one of the skills is missing/inactive', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 7 }], null]) // user exists
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // DELETE (no prior skills)
      .mockResolvedValueOnce([[], null]); // skill 99 missing
    const service = new SkillService(pool);
    await expect(service.assignSkillsToUser(7, [99])).rejects.toThrow(/not found or inactive/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('SkillService.getUserSkills', () => {
  it('returns the join-table rows mapped to Skill objects', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { id: 1, name: 'Triage', description: 'd', is_active: 1, created_at: '2026-04-26' },
        { id: 2, name: 'CPR', description: '', is_active: 1, created_at: '2026-04-26' },
      ],
      null,
    ]);
    const service = new SkillService(pool);
    const out = await service.getUserSkills(7);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Triage');
  });
});

describe('SkillService.assignSkillsToShift', () => {
  it('replaces the existing shift_skills set in a transaction', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 10 }], null]) // shift exists
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // DELETE
      .mockResolvedValueOnce([[{ id: 3 }], null]) // skill valid
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT
    const service = new SkillService(pool);
    const ok = await service.assignSkillsToShift(10, [3]);
    expect(ok).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rejects when the shift does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const service = new SkillService(pool);
    await expect(service.assignSkillsToShift(99, [1])).rejects.toThrow(/Shift not found/);
  });
});

describe('SkillService.getSkillStatistics', () => {
  it('returns total + averages from the aggregate query', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ total: 10 }], null])
      .mockResolvedValueOnce([[{ active: 8 }], null])
      .mockResolvedValueOnce([
        [
          { name: 'Triage', user_count: 4 },
          { name: 'CPR', user_count: 6 },
        ],
        null,
      ]);
    const service = new SkillService(pool);
    const stats = await service.getSkillStatistics();
    expect(stats.totalSkills).toBe(10);
  });
});

describe('SkillService.findUsersWithAllSkills', () => {
  it('builds a HAVING COUNT() = N query', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { id: 1, first_name: 'A', last_name: 'B', email: 'a@b' },
      ],
      null,
    ]);
    const service = new SkillService(pool);
    const out = await service.findUsersWithAllSkills([1, 2, 3]);
    expect(out).toHaveLength(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/HAVING/);
  });
});
