/**
 * Pairing rules: the validation, which is the whole of this service.
 *
 * The CRUD is unremarkable. What is worth pinning down is which combinations
 * are refused and which are deliberately allowed — the second half matters as
 * much as the first, because the shape that reads most like a mistake (a
 * mutual `requires`) is the schema's documented way of saying two people always
 * work together, and a later reader tempted to "fix" it should find a test
 * saying so.
 *
 * @author Luca Ostinelli
 */

import { EmployeePairingService } from '../services/EmployeePairingService';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

/** Both users exist, and no rule between them yet. */
const noExistingRules = (execute: jest.Mock) =>
  execute
    .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]) // user existence
    .mockResolvedValueOnce([[], []]); // rules between the pair

const readBackRow = {
  id: 10,
  user_id: 1,
  other_user_id: 2,
  kind: 'apart',
  reason: null,
  user_name: 'A B',
  other_user_name: 'C D',
};

describe('create', () => {
  it('rejects a rule between someone and themself', async () => {
    const { pool, execute } = makePool();
    await expect(
      new EmployeePairingService(pool).create({ userId: 1, otherUserId: 1, kind: 'apart' })
    ).rejects.toBeInstanceOf(ValidationError);
    // Refused before any query: nothing about the database can make this
    // meaningful.
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a rule naming someone who does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 1 }], []]); // only one of the two

    await expect(
      new EmployeePairingService(pool).create({ userId: 1, otherUserId: 999, kind: 'apart' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores the rule and reads it back', async () => {
    const { pool, execute } = makePool();
    noExistingRules(execute)
      .mockResolvedValueOnce([{ insertId: 10 }, []])
      .mockResolvedValueOnce([[readBackRow], []]);

    const created = await new EmployeePairingService(pool).create({
      userId: 1,
      otherUserId: 2,
      kind: 'apart',
    });
    expect(created).toMatchObject({ id: 10, userId: 1, otherUserId: 2, kind: 'apart' });
    // A missing reason is stored as NULL, not as the string "undefined".
    expect(execute.mock.calls[2][1]).toEqual([1, 2, 'apart', null]);
  });

  it('looks for existing rules in both directions', async () => {
    const { pool, execute } = makePool();
    noExistingRules(execute)
      .mockResolvedValueOnce([{ insertId: 10 }, []])
      .mockResolvedValueOnce([[readBackRow], []]);

    await new EmployeePairingService(pool).create({ userId: 1, otherUserId: 2, kind: 'apart' });

    // A one-directional lookup would miss the reverse row, which is what every
    // check below depends on seeing.
    expect(execute.mock.calls[1][1]).toEqual([1, 2, 2, 1]);
  });

  it('rejects an exact duplicate', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []])
      .mockResolvedValueOnce([[{ user_id: 1, other_user_id: 2, kind: 'requires' }], []]);

    await expect(
      new EmployeePairingService(pool).create({ userId: 1, otherUserId: 2, kind: 'requires' })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  /**
   * The unique key is on the ORDERED pair, so the database would store this.
   * `apart` reads the same in either direction, which makes the reverse row a
   * duplicate the schema cannot express.
   */
  it('rejects the same `apart` rule recorded in reverse', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []])
      .mockResolvedValueOnce([[{ user_id: 2, other_user_id: 1, kind: 'apart' }], []]);

    await expect(
      new EmployeePairingService(pool).create({ userId: 1, otherUserId: 2, kind: 'apart' })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  /**
   * `requires` is directional, so the reverse is a DIFFERENT statement: "A may
   * only work with B" and "B may only work with A" together mean `a == b` —
   * both on the shift or neither. That is what a symmetric pairing is, and the
   * migration names two rows as the way to express it.
   */
  it('allows a reverse `requires`, which is a symmetric pairing', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []])
      .mockResolvedValueOnce([[{ user_id: 2, other_user_id: 1, kind: 'requires' }], []])
      .mockResolvedValueOnce([{ insertId: 11 }, []])
      .mockResolvedValueOnce([[{ ...readBackRow, id: 11, kind: 'requires' }], []]);

    const created = await new EmployeePairingService(pool).create({
      userId: 1,
      otherUserId: 2,
      kind: 'requires',
    });
    expect(created.id).toBe(11);
  });

  /**
   * The genuinely broken combination: one rule says A may only work shifts B
   * works, the other says A may never share a shift with B. Together, A can
   * never be assigned — and neither engine would report why, because each rule
   * is individually satisfiable.
   */
  it.each([
    ['forward', { user_id: 1, other_user_id: 2, kind: 'requires' }, 'apart' as const],
    ['reverse', { user_id: 2, other_user_id: 1, kind: 'apart' }, 'requires' as const],
  ])('rejects the opposite rule between the same pair (%s)', async (_name, existing, kind) => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []])
      .mockResolvedValueOnce([[existing], []]);

    await expect(
      new EmployeePairingService(pool).create({ userId: 1, otherUserId: 2, kind })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('read, update and delete', () => {
  it('lists every rule when no user is given, without a WHERE clause', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[readBackRow], []]);

    const all = await new EmployeePairingService(pool).list();
    expect(all).toHaveLength(1);
    expect(execute.mock.calls[0][0]).not.toContain('WHERE');
    expect(execute.mock.calls[0][1]).toEqual([]);
  });

  it('matches a filtered user on either side of the rule', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);

    await new EmployeePairingService(pool).list(2);
    expect(execute.mock.calls[0][0]).toContain('p.user_id = ? OR p.other_user_id = ?');
    expect(execute.mock.calls[0][1]).toEqual([2, 2]);
  });

  it('throws NotFoundError for an unknown id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], []]);
    await expect(new EmployeePairingService(pool).getById(99)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('clears a reason rather than treating null as no change', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[readBackRow], []]);

    const updated = await new EmployeePairingService(pool).updateReason(10, null);
    expect(execute.mock.calls[0][1]).toEqual([null, 10]);
    expect(updated.reason).toBeNull();
  });

  it('reports a missing rule on update rather than silently succeeding', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    await expect(
      new EmployeePairingService(pool).updateReason(99, 'x')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes a rule', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await expect(new EmployeePairingService(pool).remove(10)).resolves.toBeUndefined();
  });

  it('reports a missing rule on delete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    await expect(new EmployeePairingService(pool).remove(99)).rejects.toBeInstanceOf(NotFoundError);
  });
});
