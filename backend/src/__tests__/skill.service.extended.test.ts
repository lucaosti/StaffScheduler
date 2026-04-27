/**
 * Extended SkillService coverage:
 *   - getSkillById/getAllSkills error paths + getAllSkills isActive=false
 *   - createSkill happy path with refetch failure
 *   - updateSkill (every branch + name dedupe + skip UPDATE + missing post-update)
 *   - deleteSkill missing path
 *   - assignSkillsToUser empty list + delete-only path
 *   - getUserSkills error path
 *   - getUsersWithSkill mapping + error
 *   - getShiftRequiredSkills mapping + error
 *   - assignSkillsToShift empty list + skill missing
 *   - getSkillStatistics with empty aggregate + bubbles errors
 *   - findUsersWithAllSkills empty + departmentId branch + bubbles errors
 *
 * @author Luca Ostinelli
 */

import { SkillService } from '../services/SkillService';

type Tuple = [unknown, unknown];

const buildSkill = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Triage',
  description: 'd',
  is_active: 1,
  user_count: 0,
  shift_count: 0,
  created_at: 't',
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
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

describe('SkillService.createSkill error paths', () => {
  it('throws when post-insert fetch is empty', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new SkillService(pool);
    await expect(svc.createSkill({ name: 'X' } as never)).rejects.toThrow(
      /Failed to retrieve created skill/
    );
  });
});

describe('SkillService.getSkillById / getAllSkills error paths', () => {
  it('bubbles getSkillById errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new SkillService(pool);
    await expect(svc.getSkillById(1)).rejects.toThrow(/boom/);
  });

  it('isActive=false branch + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildSkill()], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new SkillService(pool);
    expect((await svc.getAllSkills({ isActive: false })).length).toBe(1);
    await expect(svc.getAllSkills()).rejects.toThrow(/boom/);
  });
});

describe('SkillService.updateSkill paths', () => {
  it('rejects when name already in use', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 9 }], null]);
    const svc = new SkillService(pool);
    await expect(svc.updateSkill(1, { name: 'X' } as never)).rejects.toThrow(/already exists/);
  });

  it('persists every branch, throws on missing post-update', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // name lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new SkillService(pool);
    await expect(
      svc.updateSkill(1, { name: 'X', description: 'd', isActive: false } as never)
    ).rejects.toThrow(/Skill not found after update/);
  });

  it('skips UPDATE when nothing to change', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildSkill()], null] as Tuple);
    const svc = new SkillService(pool);
    expect((await svc.updateSkill(1, {})).id).toBe(1);
  });
});

describe('SkillService.deleteSkill missing path', () => {
  it('throws when no rows affected', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const svc = new SkillService(pool);
    await expect(svc.deleteSkill(1)).rejects.toThrow(/Skill not found/);
  });
});

describe('SkillService.assignSkillsToUser extra paths', () => {
  it('handles empty skill list (delete-only)', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 7 }], null]) // user exists
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // DELETE
    const svc = new SkillService(pool);
    expect(await svc.assignSkillsToUser(7, [])).toBe(true);
  });
});

describe('SkillService.getUserSkills / getUsersWithSkill / getShiftRequiredSkills', () => {
  it('all error paths bubble', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ id: 1, first_name: 'A', last_name: 'B', email: 'a@b', role: 'employee' }],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([[buildSkill()], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom2'))
      .mockRejectedValueOnce(new Error('boom3'));
    const svc = new SkillService(pool);
    expect((await svc.getUsersWithSkill(1)).length).toBe(1);
    expect((await svc.getShiftRequiredSkills(1)).length).toBe(1);
    await expect(svc.getUserSkills(1)).rejects.toThrow(/boom/);
    await expect(svc.getUsersWithSkill(1)).rejects.toThrow(/boom2/);
    await expect(svc.getShiftRequiredSkills(1)).rejects.toThrow(/boom3/);
  });
});

describe('SkillService.assignSkillsToShift extra paths', () => {
  it('handles empty skill list', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const svc = new SkillService(pool);
    expect(await svc.assignSkillsToShift(1, [])).toBe(true);
  });

  it('rejects when a skill is missing', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([[], null]);
    const svc = new SkillService(pool);
    await expect(svc.assignSkillsToShift(1, [99])).rejects.toThrow(/not found or inactive/);
  });
});

describe('SkillService.getSkillStatistics edge cases', () => {
  it('handles empty aggregate + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ total: 0, active: 0, inactive: 0 }], null] as Tuple)
      .mockResolvedValueOnce([[{ avg_users: null }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new SkillService(pool);
    const stats = await svc.getSkillStatistics();
    expect(stats.totalSkills).toBe(0);
    expect(stats.averageUsersPerSkill).toBe(0);
    await expect(svc.getSkillStatistics()).rejects.toThrow(/boom/);
  });
});

describe('SkillService.findUsersWithAllSkills', () => {
  it('returns [] when no skills passed', async () => {
    const { pool } = makePool();
    const svc = new SkillService(pool);
    expect(await svc.findUsersWithAllSkills([])).toEqual([]);
  });

  it('joins user_departments when departmentId given + bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [{ id: 1, first_name: 'A', last_name: 'B', email: 'a@b', role: 'employee' }],
        null,
      ] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new SkillService(pool);
    const out = await svc.findUsersWithAllSkills([1, 2], 3);
    expect(out.length).toBe(1);
    expect((execute.mock.calls[0][0] as string)).toMatch(/JOIN user_departments/);
    await expect(svc.findUsersWithAllSkills([1])).rejects.toThrow(/boom/);
  });
});
