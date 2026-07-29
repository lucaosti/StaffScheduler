/**
 * The skills catalogue.
 *
 * The behaviour worth pinning is the refusal to delete a skill in use. All
 * three tables referencing a skill cascade, so the delete would succeed and
 * quietly strip the skill from every employee holding it and every shift
 * requiring it — and a shift that stops requiring a qualification changes what
 * a legal schedule is, without anyone having decided to change it.
 *
 * @author Luca Ostinelli
 */

import { SkillService } from '../services/SkillService';
import { ConflictError, NotFoundError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

const skillRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Triage',
  description: null,
  is_active: 1,
  employee_count: 0,
  shift_requirement_count: 0,
  ...over,
});

describe('reading the catalogue', () => {
  it('carries usage counts with every skill', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[skillRow({ employee_count: 4, shift_requirement_count: 2 })], []]);

    const [skill] = await new SkillService(pool).list();

    // The counts are what make retiring a skill an informed decision; behind a
    // separate call, a caller decides without them.
    expect(skill).toMatchObject({ employeeCount: 4, shiftRequirementCount: 2 });
  });

  it('can hide retired skills for a picker', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await new SkillService(pool).list({ activeOnly: true });
    expect(String(execute.mock.calls[0][0])).toContain('s.is_active = 1');
  });

  it('lists everything by default', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await new SkillService(pool).list();
    expect(String(execute.mock.calls[0][0])).not.toContain('is_active = 1');
  });

  it('throws NotFoundError for an unknown skill', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await expect(new SkillService(pool).getById(99)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('creating and updating', () => {
  it('creates a skill', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], []]) // name free
      .mockResolvedValueOnce([{ insertId: 5 }, []])
      .mockResolvedValueOnce([[skillRow({ id: 5 })], []]);

    const created = await new SkillService(pool).create({ name: 'Triage' });
    expect(created.id).toBe(5);
    expect(execute.mock.calls[1][1]).toEqual(['Triage', null]);
  });

  it('refuses a duplicate name rather than letting the unique key 500', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 2 }], []]);
    await expect(new SkillService(pool).create({ name: 'Triage' })).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('does not treat keeping its own name as a duplicate', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow()], []]) // current
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[skillRow({ description: 'x' })], []]);

    await new SkillService(pool).update(1, { name: 'Triage', description: 'x' });
    // No uniqueness lookup at all: the name did not change.
    expect(execute.mock.calls).toHaveLength(3);
  });

  it('checks the new name is free when it changes', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow()], []]) // current
      .mockResolvedValueOnce([[], []]) // the new name is free
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[skillRow({ name: 'Triage nurse' })], []]);

    const updated = await new SkillService(pool).update(1, { name: 'Triage nurse' });
    expect(updated.name).toBe('Triage nurse');
    expect(String(execute.mock.calls[1][0])).toContain('WHERE name = ?');
  });

  it('refuses a rename onto an existing name', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow()], []])
      .mockResolvedValueOnce([[{ id: 9 }], []]); // taken

    await expect(
      new SkillService(pool).update(1, { name: 'Taken' })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('distinguishes clearing a description from omitting it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow({ description: 'old' })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[skillRow()], []]);

    await new SkillService(pool).update(1, { description: null });
    // `?? current` would keep the old text and make the field impossible to
    // unset — the trap the contract update had to be fixed for.
    expect(execute.mock.calls[1][1][1]).toBeNull();
  });

  it('retires a skill through the ordinary update', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow()], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[skillRow({ is_active: 0 })], []]);

    const updated = await new SkillService(pool).update(1, { isActive: false });
    expect(updated.isActive).toBe(false);
  });
});

describe('deleting', () => {
  it('deletes a skill nothing references', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[skillRow()], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    // Refusing this too would make a typo permanent.
    await expect(new SkillService(pool).remove(1)).resolves.toBeUndefined();
  });

  it.each([
    ['held by employees', { employee_count: 3 }],
    ['required by shifts', { shift_requirement_count: 1 }],
  ])('refuses to delete a skill %s', async (_name, counts) => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[skillRow(counts)], []]);

    // The foreign keys cascade, so the delete would succeed and take the
    // requirement with it — a shift silently stops needing a qualification.
    await expect(new SkillService(pool).remove(1)).rejects.toBeInstanceOf(ConflictError);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('names the numbers and the alternative in the refusal', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([[skillRow({ employee_count: 3, shift_requirement_count: 2 })], []]);

    // "Cannot delete" without the counts leaves the caller to go and find out
    // what would have been affected, and without the alternative it reads as
    // "you cannot do this" rather than "do this other thing".
    await expect(new SkillService(pool).remove(1)).rejects.toThrow(/3 employee\(s\), 2 shift/);
    await expect(new SkillService(pool).remove(1)).rejects.toThrow(/Deactivate it instead/);
  });
});
