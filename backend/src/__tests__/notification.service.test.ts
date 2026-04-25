/**
 * NotificationService tests (F03).
 */

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
  it('inserts and returns the persisted row', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 9 }, null])
      .mockResolvedValueOnce([[buildRow({ id: 9 })], null]);
    const service = new NotificationService(pool);
    const out = await service.notify({
      userId: 7,
      type: 'shift.created',
      title: 'New shift assigned',
      body: 'You are on tomorrow',
      link: '/shifts/42',
    });
    expect(out.id).toBe(9);
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO notifications/);
  });
});

describe('NotificationService.listForUser', () => {
  it('clamps limit to [1, 200]', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new NotificationService(pool);
    await service.listForUser(7, { limit: 9999 });
    expect(execute.mock.calls[0][0]).toMatch(/LIMIT 200/);
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
