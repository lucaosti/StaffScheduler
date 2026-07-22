/**
 * OutboxWorker tests — batch delivery, retry/failure accounting, and the
 * start/stop gate. MailerService is mocked so no real SMTP is touched.
 */

export {};

const sendEmail = jest.fn();
const isEmailConfigured = jest.fn();
jest.mock('../services/MailerService', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => isEmailConfigured(),
}));

import {
  processOutboxOnce,
  startOutboxWorker,
  stopOutboxWorker,
} from '../services/OutboxWorker';

const makeConn = (rows: unknown[]) => ({
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([rows, null]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
});

const poolWith = (conn: ReturnType<typeof makeConn>) =>
  ({ getConnection: jest.fn().mockResolvedValue(conn) }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  stopOutboxWorker();
});

describe('processOutboxOnce', () => {
  it('marks a row sent on successful delivery', async () => {
    const conn = makeConn([{ id: 1, recipient_email: 'a@b.c', subject: 's', body: 't', attempts: 0 }]);
    sendEmail.mockResolvedValueOnce(undefined);

    const count = await processOutboxOnce(poolWith(conn));

    expect(count).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith({ to: 'a@b.c', subject: 's', text: 't' });
    expect(conn.execute.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('keeps a row pending and records the error on a transient failure', async () => {
    const conn = makeConn([{ id: 2, recipient_email: 'a@b.c', subject: 's', body: null, attempts: 1 }]);
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));

    await processOutboxOnce(poolWith(conn));

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 5
    expect(params[1]).toBe(2);
    expect(params[2]).toMatch(/smtp down/);
  });

  it('marks a row failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([{ id: 3, recipient_email: 'a@b.c', subject: 's', body: 't', attempts: 4 }]);
    sendEmail.mockRejectedValueOnce(new Error('still down'));

    await processOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed'); // attempts 5 >= MAX 5
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startOutboxWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopOutboxWorker();
    jest.useRealTimers();
  });

  it('does not start (schedules no poll) when email is not configured', () => {
    isEmailConfigured.mockReturnValue(false);
    const pool = poolWith(makeConn([]));
    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection).not.toHaveBeenCalled();
  });

  it('schedules polls when email is configured, and stop halts them', () => {
    isEmailConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopOutboxWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });
});
