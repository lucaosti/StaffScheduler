/**
 * UserDirectoryService tests (F22).
 */

import { UserDirectoryService } from '../services/UserDirectoryService';

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

describe('UserDirectoryService.getProfile', () => {
  it('returns null when the user does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new UserDirectoryService(pool);
    expect(await service.getProfile(99)).toBeNull();
  });

  it('hydrates the user with their custom fields', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            email: 'a@x.com',
            first_name: 'Anna',
            last_name: 'Demo',
            role: 'employee',
            employee_id: 'E-001',
            phone: '+39 000',
            position: 'Nurse',
          },
        ],
        null,
      ])
      .mockResolvedValueOnce([
        [
          { field_key: 'birthday', field_value: '1990-01-01', is_public: 1 },
          { field_key: 'allergies', field_value: 'penicillin', is_public: 0 },
        ],
        null,
      ]);
    const service = new UserDirectoryService(pool);
    const profile = await service.getProfile(1);
    expect(profile?.fields).toHaveLength(2);
    expect(profile?.fields[0]).toMatchObject({ key: 'birthday', isPublic: true });
    expect(profile?.fields[1]).toMatchObject({ key: 'allergies', isPublic: false });
  });
});

describe('UserDirectoryService.setFields', () => {
  it('rejects keys with invalid characters', async () => {
    const { pool, conn } = makePool();
    const service = new UserDirectoryService(pool);
    await expect(
      service.setFields(7, [{ key: 'has space', value: 'x' }])
    ).rejects.toThrow(/Invalid field key/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('upserts every field in a single transaction', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);
    const service = new UserDirectoryService(pool);
    await service.setFields(7, [
      { key: 'birthday', value: '1990-01-01' },
      { key: 'badge', value: '#42', isPublic: false },
    ]);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.execute).toHaveBeenCalledTimes(2);
  });
});

describe('UserDirectoryService.exportVcf', () => {
  it('builds a .vcf with one VCARD per user with public fields included', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            email: 'a@x.com',
            first_name: 'Anna',
            last_name: 'Demo',
            role: 'employee',
            employee_id: 'E-001',
            phone: '+39 000',
            position: 'Nurse',
          },
        ],
        null,
      ])
      .mockResolvedValueOnce([
        [{ field_key: 'birthday', field_value: '1990-01-01', is_public: 1 }],
        null,
      ]);
    const service = new UserDirectoryService(pool);
    const vcf = await service.exportVcf([1]);
    expect(vcf).toContain('FN:Anna Demo');
    expect(vcf).toContain('X-EMPLOYEE-ID:E-001');
    expect(vcf).toContain('X-BIRTHDAY:1990-01-01');
  });

  it('omits private fields from the vCard', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            email: 'a@x.com',
            first_name: 'Anna',
            last_name: 'Demo',
            role: 'employee',
            employee_id: null,
            phone: null,
            position: null,
          },
        ],
        null,
      ])
      .mockResolvedValueOnce([
        [{ field_key: 'allergies', field_value: 'penicillin', is_public: 0 }],
        null,
      ]);
    const service = new UserDirectoryService(pool);
    const vcf = await service.exportVcf([1]);
    expect(vcf).not.toContain('penicillin');
  });
});

describe('UserDirectoryService.importVcf', () => {
  it('inserts a new user from a vCard, splitting given/family from FN if needed', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // duplicate-email check
      .mockResolvedValueOnce([{ insertId: 5 }, null]); // INSERT user
    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bruno Demo\r\nEMAIL:bruno@example.local\r\nEND:VCARD\r\n',
      { defaultPasswordHash: 'hash', createdBy: 1 }
    );
    expect(out.inserted).toBe(1);
    expect(out.skipped).toEqual([]);
  });

  it('skips cards whose email already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 99 }], null]);
    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:X\r\nEMAIL:dup@x.com\r\nEND:VCARD\r\n',
      { defaultPasswordHash: 'h', createdBy: 1 }
    );
    expect(out.inserted).toBe(0);
    expect(out.skipped[0]).toMatchObject({ email: 'dup@x.com', reason: 'email already exists' });
  });

  it('skips cards with no email', async () => {
    const { pool } = makePool();
    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:No Email\r\nEND:VCARD\r\n',
      { defaultPasswordHash: 'h', createdBy: 1 }
    );
    expect(out.inserted).toBe(0);
    expect(out.skipped[0].reason).toBe('missing email');
  });
});
