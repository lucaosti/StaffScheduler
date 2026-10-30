/**
 * RefreshTokenService tests — the rotation and reuse-detection logic that the
 * whole session-security model rests on.
 *
 * The pool is mocked, so these pin the exact SQL decisions rather than DB
 * behaviour: a valid token is claimed first and only then rotated (successor
 * in the same family, linked to its predecessor); a token another rotation
 * claimed moments ago is `superseded`; an older spent token triggers a
 * family-wide revocation (reuse response); an unknown or expired token is
 * `invalid`. The raw token is asserted to never equal its stored hash. The
 * real concurrency — two claims racing on one row lock — is exercised against
 * MySQL in the integration suite.
 */

import { createHash } from 'crypto';
import { RefreshTokenService, CONCURRENT_REFRESH_GRACE_SECONDS } from '../services/RefreshTokenService';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
  const row = { id: 10, user_id: 7, family_id: 'fam-1', revoked: 0, within_grace: null };

  it('claims before it issues, then links the successor, all in one transaction', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // claim
      .mockResolvedValueOnce([[{ ...row, revoked: 1, within_grace: 0 }], null]) // locking read
      .mockResolvedValueOnce([{ insertId: 11 }, null]) // successor INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // link

    const result = await new RefreshTokenService(pool).rotate('current');

    expect(result.status).toBe('rotated');
    if (result.status !== 'rotated') throw new Error('unreachable');
    expect(result.userId).toBe(7);
    expect(typeof result.issued.token).toBe('string');
    const [claimSql, claimParams] = conn.execute.mock.calls[0];
    expect(claimSql).toMatch(/UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP\s+WHERE token_hash = \? AND revoked_at IS NULL AND expires_at > \?/);
    expect(claimParams[0]).toBe(sha256('current'));
    expect(conn.execute.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(conn.execute.mock.calls[1][1]).toEqual([CONCURRENT_REFRESH_GRACE_SECONDS, sha256('current')]);
    // The successor is created in the SAME family, on the transaction's connection.
    expect(conn.execute.mock.calls[2][1][1]).toBe('fam-1');
    expect(conn.execute.mock.calls[3]).toEqual(['UPDATE refresh_tokens SET replaced_by = ? WHERE id = ?', [11, 10]]);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('is invalid for an unknown token', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]).mockResolvedValueOnce([[], null]);
    await expect(new RefreshTokenService(pool).rotate('nope')).resolves.toEqual({ status: 'invalid' });
    expect(conn.execute).toHaveBeenCalledTimes(2);
  });

  it('is invalid, and revokes nothing, for an expired token that was never spent', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]).mockResolvedValueOnce([[row], null]);
    await expect(new RefreshTokenService(pool).rotate('expired')).resolves.toEqual({ status: 'invalid' });
    expect(conn.execute).toHaveBeenCalledTimes(2);
  });

  it('is superseded, issuing and revoking nothing, when another rotation claimed it moments ago', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([[{ ...row, revoked: 1, within_grace: 1 }], null]);
    await expect(new RefreshTokenService(pool).rotate('raced')).resolves.toEqual({ status: 'superseded' });
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('is invalid and revokes the family when a token spent outside the grace window is replayed', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([[{ ...row, revoked: 1, within_grace: 0 }], null])
      .mockResolvedValueOnce([{ affectedRows: 2 }, null]); // revokeFamily UPDATE

    await expect(new RefreshTokenService(pool).rotate('replayed')).resolves.toEqual({ status: 'invalid' });

    const familyRevoke = conn.execute.mock.calls[2];
    expect(familyRevoke[0]).toMatch(/UPDATE refresh_tokens SET revoked_at.*family_id = \?/s);
    expect(familyRevoke[1]).toEqual(['fam-1']);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('rolls back the claim and rethrows when issuing the successor fails', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([[row], null])
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(new RefreshTokenService(pool).rotate('current')).rejects.toThrow('insert failed');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe('RefreshTokenService revocation helpers', () => {
  it('revokeFamilyOf revokes the family the presented token belongs to', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ family_id: 'fam-9' }], null]).mockResolvedValueOnce([{ affectedRows: 2 }, null]);
    await new RefreshTokenService(pool).revokeFamilyOf('tok');
    expect(execute.mock.calls[0][1]).toEqual([sha256('tok')]);
    expect(execute.mock.calls[1][0]).toMatch(/family_id = \? AND revoked_at IS NULL/);
    expect(execute.mock.calls[1][1]).toEqual(['fam-9']);
  });

  it('revokeFamilyOf is silent for an unknown token', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    await expect(new RefreshTokenService(pool).revokeFamilyOf('unknown')).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('revokeAllForUser revokes every active token for the user', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 3 }, null]);
    await new RefreshTokenService(pool).revokeAllForUser(7);
    expect(execute.mock.calls[0][0]).toMatch(/user_id = \? AND revoked_at IS NULL/);
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it('revokeAllForUser runs on the executor it is given, so it can join a transaction', async () => {
    const { pool, execute } = makePool();
    const connection = { execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]) };
    await new RefreshTokenService(pool).revokeAllForUser(7, connection as never);
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('pruneExpired deletes expired and long-revoked rows and returns the count', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([{ affectedRows: 5 }, null]);
    await expect(new RefreshTokenService(pool).pruneExpired()).resolves.toBe(5);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM refresh_tokens/);
  });
});
