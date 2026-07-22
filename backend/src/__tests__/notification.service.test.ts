/**
 * NotificationService tests (F03).
 */

const isEmailConfigured = jest.fn().mockReturnValue(false);
jest.mock('../services/MailerService', () => ({ isEmailConfigured: () => isEmailConfigured() }));

import { NotificationService } from '../services/NotificationService';

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  type: 'shift.created',
  title: 'New shift assigned',
  body: 'You are on tomorrow',
  link: '/shifts/42',
  is_read: 0,
  created_at: '2026-04-26T12:00:00.000Z',
  read_at: null,
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('NotificationService.notify', () => {
  it('inserts inside a transaction and returns the persisted row', async () => {
    // notify() now writes in a transaction (for the outbox pattern); email is
    // not configured in tests, so no outbox row is written.
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValueOnce([{ insertId: 9 }, null]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const execute = jest.fn().mockResolvedValueOnce([[buildRow({ id: 9 })], null]); // getById
    const pool = { getConnection: jest.fn().mockResolvedValue(conn), execute } as never;

    const service = new NotificationService(pool);
    const out = await service.notify({
      userId: 7,
      type: 'shift.created',
      title: 'New shift assigned',
      body: 'You are on tomorrow',
      link: '/shifts/42',
    });

    expect(out.id).toBe(9);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.execute.mock.calls[0][0]).toMatch(/INSERT INTO notifications/);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('enqueues an email in the outbox when email is configured and the user has an address', async () => {
    isEmailConfigured.mockReturnValueOnce(true);
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest
        .fn()
        .mockResolvedValueOnce([{ insertId: 9 }, null]) // INSERT notifications
        .mockResolvedValueOnce([[{ email: 'user@example.com' }], null]) // SELECT email
        .mockResolvedValueOnce([{ insertId: 1 }, null]), // INSERT email_outbox
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const execute = jest.fn().mockResolvedValueOnce([[buildRow({ id: 9 })], null]); // getById
    const pool = { getConnection: jest.fn().mockResolvedValue(conn), execute } as never;

    await new NotificationService(pool).notify({ userId: 7, type: 't', title: 'Subj', body: 'Msg' });

    const outboxCall = conn.execute.mock.calls.find((c) => /INSERT INTO email_outbox/.test(c[0]));
    expect(outboxCall).toBeDefined();
    expect(outboxCall![1]).toEqual([9, 'user@example.com', 'Subj', 'Msg']);
  });

  it('rolls back and rethrows when the insert fails', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockRejectedValueOnce(new Error('insert failed')),
      commit: jest.fn(),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const pool = { getConnection: jest.fn().mockResolvedValue(conn), execute: jest.fn() } as never;
    const service = new NotificationService(pool);
    await expect(service.notify({ userId: 7, type: 't', title: 'x' })).rejects.toThrow(/insert failed/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe('NotificationService.listForUser', () => {
  it('clamps limit to [1, 200]', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new NotificationService(pool);
    await service.listForUser(7, { limit: 9999 });
    expect(execute.mock.calls[0][1]).toContain(200);
  });

  it('filters unread only when requested', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new NotificationService(pool);
    await service.listForUser(7, { unreadOnly: true });
    expect(execute.mock.calls[0][0]).toMatch(/is_read = 0/);
  });
});

describe('NotificationService.markRead', () => {
  it('returns false when no row matched (already read or wrong user)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const service = new NotificationService(pool);
    expect(await service.markRead(1, 7)).toBe(false);
  });

  it('returns true on a successful mark', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const service = new NotificationService(pool);
    expect(await service.markRead(1, 7)).toBe(true);
  });
});

describe('NotificationService.markAllRead', () => {
  it('returns the count of rows touched', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 5 }, null]);
    const service = new NotificationService(pool);
    expect(await service.markAllRead(7)).toBe(5);
  });
});

describe('NotificationService.unreadCount', () => {
  it('returns the COUNT(*) value', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ c: 12 }], null]);
    const service = new NotificationService(pool);
    expect(await service.unreadCount(7)).toBe(12);
  });
});
