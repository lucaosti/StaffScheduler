/**
 * RefreshTokenService tests — the rotation and reuse-detection logic that the
 * whole session-security model rests on.
 *
 * The pool is mocked, so these pin the exact SQL decisions rather than DB
 * behaviour: a valid token rotates (old revoked + linked to successor, new
 * issued in the same family); an already-revoked token triggers a family-wide
 * revocation (reuse response); an unknown or expired token yields null. The
 * raw token is asserted to never equal its stored hash.
 */

import { createHash } from 'crypto';
import { RefreshTokenService } from '../services/RefreshTokenService';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('RefreshTokenService.issue', () => {
  it('stores only the hash and returns a raw token in a new family', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ insertId: 1 }, null]);

    const { token } = await new RefreshTokenService(pool).issue(7);

    const insert = execute.mock.calls[0];
    expect(insert[0]).toMatch(/INSERT INTO refresh_tokens/);
    const [userId, familyId, tokenHash] = insert[1];
    expect(userId).toBe(7);
    expect(typeof familyId).toBe('string'); // a fresh family
    expect(tokenHash).toBe(sha256(token)); // stored hash matches the raw token
    expect(tokenHash).not.toBe(token); // never the raw token itself
  });
});

describe('RefreshTokenService.rotate', () => {
  const validRow = {
    id: 10,
    user_id: 7,
    family_id: 'fam-1',
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
  };

  it('returns null for an unknown token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]); // lookup: none
    await expect(new RefreshTokenService(pool).rotate('nope')).resolves.toBeNull();
  });

  it('returns null and revokes the family when a spent token is replayed', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ ...validRow, revoked_at: new Date() }], null]) // already revoked
      .mockResolvedValueOnce([{ affectedRows: 2 }, null]); // revokeFamily UPDATE

    const result = await new RefreshTokenService(pool).rotate('replayed');

    expect(result).toBeNull();
    const familyRevoke = execute.mock.calls[1];
    expect(familyRevoke[0]).toMatch(/UPDATE refresh_tokens SET revoked_at.*family_id = \?/s);
    expect(familyRevoke[1]).toEqual(['fam-1']);
  });

  it('returns null for an expired token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ ...validRow, expires_at: new Date(Date.now() - 1) }], null]);
    await expect(new RefreshTokenService(pool).rotate('expired')).resolves.toBeNull();
  });

  it('rotates a valid token: issues a successor in the same family and revokes the old', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[validRow], null]) // lookup
      .mockResolvedValueOnce([{ insertId: 11 }, null]) // create successor INSERT
      .mockResolvedValueOnce([[{ id: 11 }], null]) // successor id lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // revoke old + link

    const result = await new RefreshTokenService(pool).rotate('current');

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(7);
    expect(typeof result!.issued.token).toBe('string');
    // The successor is created in the SAME family as the presented token.
    expect(execute.mock.calls[1][1][1]).toBe('fam-1');
    // The old row is revoked and linked to its replacement (id 11).
    const revoke = execute.mock.calls[3];
    expect(revoke[0]).toMatch(/revoked_at = CURRENT_TIMESTAMP, replaced_by = \?/);
    expect(revoke[1]).toEqual([11, 10]);
  });
});

describe('RefreshTokenService revocation helpers', () => {
  it('revoke hashes the presented token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 1 }, null]);
    await new RefreshTokenService(pool).revoke('tok');
    expect(execute.mock.calls[0][1]).toEqual([sha256('tok')]);
  });

  it('revokeAllForUser revokes every active token for the user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 3 }, null]);
    await new RefreshTokenService(pool).revokeAllForUser(7);
    expect(execute.mock.calls[0][0]).toMatch(/user_id = \? AND revoked_at IS NULL/);
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it('pruneExpired deletes expired and long-revoked rows and returns the count', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 5 }, null]);
    await expect(new RefreshTokenService(pool).pruneExpired()).resolves.toBe(5);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM refresh_tokens/);
  });
});
