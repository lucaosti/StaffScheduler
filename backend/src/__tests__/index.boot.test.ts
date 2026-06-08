/**
 * startServer() boot tests.
 *
 * Exercises the DB-failure branch: when pool.execute('SELECT 1') rejects,
 * startServer must log the error and call process.exit(1).
 *
 * @author Luca Ostinelli
 */

const mockExecute = jest.fn();
const mockPool = { execute: mockExecute };

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => mockPool),
}));

jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// buildApp is called only after the DB check passes; mock it to avoid full
// Express wiring. Since this test targets the failure branch, buildApp is
// never reached — but the mock prevents import-time side-effects.
jest.mock('../app', () => ({
  buildApp: jest.fn(() => ({ listen: jest.fn() })),
}));

import { startServer } from '../index';
import { logger } from '../config/logger';

describe('startServer() — DB connection failure', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    mockExecute.mockReset();
    // Prevent process.exit from terminating the test runner.
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null | undefined) => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('calls process.exit(1) when the DB connection test fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB down'));

    await startServer();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect((logger.error as jest.Mock).mock.calls.some(
      (args: unknown[]) => String(args[0]).includes('Database connection test failed')
    )).toBe(true);
  });
});
