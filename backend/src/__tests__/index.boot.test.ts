/**
 * startServer() boot tests.
 *
 * Three branches, each pinned by its own case:
 *  - the DB-connectivity check fails (the inner try/catch) — startServer must
 *    log, exit(1), and not fall through to building the app or starting any
 *    background worker (#394: it once did, because process.exit is mocked
 *    here so the test can observe the call without killing the runner, which
 *    means it does not stop execution the way it does in production);
 *  - a step AFTER the DB check succeeds fails (the outer try/catch) —
 *    startServer must log, exit(1), and not reach app.listen or the
 *    background workers. buildApp() itself DOES run before this point, so
 *    asserting it was skipped would be the wrong pin here; the right one is
 *    that nothing past the failure point runs;
 *  - everything succeeds (the happy path) — startServer must build the app,
 *    start listening, and start both background workers with the pool.
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

const mockListen = jest.fn();
// buildApp is real Express wiring; mocked everywhere in this file so no suite
// here needs it, and so its own import-time side effects never run.
jest.mock('../app', () => ({
  buildApp: jest.fn(() => ({ listen: mockListen })),
}));

// The remaining four mocks stand in for startServer's post-DB-check steps.
// Failure and success cases are both exercised below, so each is a fresh
// jest.fn() reset per test rather than a fixed resolved/rejected value.
const mockEventBusInit = jest.fn();
jest.mock('../services/EventBus', () => ({
  eventBus: { init: (...args: unknown[]) => mockEventBusInit(...args) },
}));

const mockInitModuleCacheInvalidation = jest.fn();
jest.mock('../services/moduleCache', () => ({
  initModuleCacheInvalidation: (...args: unknown[]) => mockInitModuleCacheInvalidation(...args),
}));

const mockInitOptimizationWorker = jest.fn();
const mockCloseOptimizationQueue = jest.fn();
jest.mock('../services/OptimizationQueue', () => ({
  initOptimizationWorker: (...args: unknown[]) => mockInitOptimizationWorker(...args),
  closeOptimizationQueue: (...args: unknown[]) => mockCloseOptimizationQueue(...args),
}));

const mockStartOutboxWorker = jest.fn();
const mockStopOutboxWorker = jest.fn();
jest.mock('../services/OutboxWorker', () => ({
  startOutboxWorker: (...args: unknown[]) => mockStartOutboxWorker(...args),
  stopOutboxWorker: (...args: unknown[]) => mockStopOutboxWorker(...args),
}));

const mockStartPushWorker = jest.fn();
const mockStopPushWorker = jest.fn();
jest.mock('../services/PushWorker', () => ({
  startPushWorker: (...args: unknown[]) => mockStartPushWorker(...args),
  stopPushWorker: (...args: unknown[]) => mockStopPushWorker(...args),
}));

const mockStartWebhookWorker = jest.fn();
const mockStopWebhookWorker = jest.fn();
jest.mock('../services/WebhookWorker', () => ({
  startWebhookWorker: (...args: unknown[]) => mockStartWebhookWorker(...args),
  stopWebhookWorker: (...args: unknown[]) => mockStopWebhookWorker(...args),
}));

// Left unmocked once before (this is the exact #394 pattern, for a worker
// added later): the happy path would otherwise call the REAL
// startPayrollExportWorker(pool) against mockPool, which has no
// getConnection(), arming a real 60-second setInterval that fires against
// this fixture from an unrelated suite later in the same --runInBand run.
const mockStartPayrollExportWorker = jest.fn();
const mockStopPayrollExportWorker = jest.fn();
jest.mock('../services/PayrollExportWorker', () => ({
  startPayrollExportWorker: (...args: unknown[]) => mockStartPayrollExportWorker(...args),
  stopPayrollExportWorker: (...args: unknown[]) => mockStopPayrollExportWorker(...args),
}));

import { startServer } from '../index';
import { logger } from '../config/logger';
import { buildApp } from '../app';

describe('startServer()', () => {
  let exitSpy: jest.SpyInstance;
  let processOnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockExecute.mockReset();
    mockListen.mockReset();
    mockEventBusInit.mockReset().mockResolvedValue(undefined);
    mockInitModuleCacheInvalidation.mockReset().mockResolvedValue(undefined);
    mockInitOptimizationWorker.mockReset();
    mockCloseOptimizationQueue.mockReset().mockResolvedValue(undefined);
    mockStartOutboxWorker.mockReset();
    mockStopOutboxWorker.mockReset();
    mockStartPushWorker.mockReset();
    mockStopPushWorker.mockReset();
    mockStartWebhookWorker.mockReset();
    mockStopWebhookWorker.mockReset();
    mockStartPayrollExportWorker.mockReset();
    mockStopPayrollExportWorker.mockReset();

    // Prevent process.exit from terminating the test runner.
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null | undefined) => undefined as never);

    // The happy path registers real SIGTERM/SIGINT handlers on the actual
    // process object. --runInBand runs this whole file (and every other
    // suite) in ONE Node process, so without this, every happy-path run would
    // permanently add two more listeners that are never removed — eventually
    // tripping Node's MaxListenersExceededWarning, and leaving handlers that
    // could fire startServer's real shutdown logic on a signal meant for
    // something else entirely later in the run. Exactly the class of leaked
    // process-level state #394 was about, for listeners instead of a timer.
    processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  describe('DB connection failure', () => {
    it('calls process.exit(1) when the DB connection test fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB down'));

      await startServer();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect((logger.error as jest.Mock).mock.calls.some(
        (args: unknown[]) => String(args[0]).includes('Database connection test failed')
      )).toBe(true);
    });

    /**
     * The regression this pins: `process.exit(1)` is mocked here specifically so
     * the test can observe the call without killing the runner — which means it
     * does NOT stop execution the way it does in production. Before `index.ts`
     * had an explicit `return` after that call, this fallthrough went on to
     * `buildApp()` and then to `startOutboxWorker()` with the pool that had just
     * failed its connectivity check, arming a real 30-second `setInterval` that
     * later crashed an unrelated suite (#394). `buildApp` is the first thing
     * reached on the fallthrough path, so asserting it was never called is the
     * most direct pin on "startup stopped where it was supposed to".
     */
    it('does not proceed to build the app after the DB check fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB down'));

      await startServer();

      expect(buildApp).not.toHaveBeenCalled();
    });
  });

  describe('a step after the DB check succeeds fails', () => {
    /**
     * Everything from buildApp() onward runs inside startServer's OUTER
     * try/catch, whose own process.exit(1) is already the last statement in
     * that block — confirmed safe by an independent review — so there is
     * nothing to fall through to there. What was never pinned by a test is
     * that startServer actually STOPS at the failure point rather than
     * continuing to whichever unguarded step comes next. eventBus.init() is
     * the first async step after buildApp(), so failing it is the most direct
     * way to reach this branch.
     */
    it('exits and does not reach app.listen or any background worker', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);
      mockEventBusInit.mockRejectedValueOnce(new Error('redis unreachable'));

      await startServer();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect((logger.error as jest.Mock).mock.calls.some(
        (args: unknown[]) => String(args[0]).includes('Failed to start server')
      )).toBe(true);

      // buildApp DOES run — it happens before eventBus.init() — so it is not
      // useful evidence here. What must not happen is anything after the
      // failure point.
      expect(mockInitModuleCacheInvalidation).not.toHaveBeenCalled();
      expect(mockInitOptimizationWorker).not.toHaveBeenCalled();
      expect(mockStartOutboxWorker).not.toHaveBeenCalled();
      expect(mockStartPushWorker).not.toHaveBeenCalled();
      expect(mockStartWebhookWorker).not.toHaveBeenCalled();
      expect(mockStartPayrollExportWorker).not.toHaveBeenCalled();
      expect(mockListen).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    /**
     * Without this case, the existing suite could pass in full even if
     * startServer ALWAYS took an early-exit path (or only ever exercised a
     * failure branch) — every other test in this file asserts what does NOT
     * happen on a failure path, and none of them proves the success path
     * actually does what it is supposed to.
     */
    it('builds the app, starts listening, and starts all background workers', async () => {
      mockExecute.mockResolvedValueOnce([[], []]);

      await startServer();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(buildApp).toHaveBeenCalledWith(mockPool, { readPool: mockPool });
      expect(mockListen).toHaveBeenCalled();
      expect(mockInitOptimizationWorker).toHaveBeenCalledWith(mockPool);
      expect(mockStartOutboxWorker).toHaveBeenCalledWith(mockPool);
      expect(mockStartPushWorker).toHaveBeenCalledWith(mockPool);
      expect(mockStartWebhookWorker).toHaveBeenCalledWith(mockPool);
      expect(mockStartPayrollExportWorker).toHaveBeenCalledWith(mockPool);
    });
  });
});
