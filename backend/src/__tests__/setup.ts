// Test setup for Staff Scheduler
//
// The env-var default guard itself lives in testEnvDefaults.ts, split out so
// it can be unit-tested directly (see testEnvDefaults.test.ts for why this
// file cannot be re-required mid-test to exercise it).
import { applyTestEnvDefault } from './testEnvDefaults';

// Safety net: default Redis to disabled in tests unless a suite opts in, so no
// test can leave a live ioredis client whose reconnection timer keeps Jest
// from exiting. Suites that exercise Redis mock config/redis or set the flag
// themselves (redis.config.test.ts), so this default never masks real coverage.
applyTestEnvDefault('REDIS_ENABLED', 'false');

// Same reasoning, for email. `config.notifications.emailEnabled` defaults to
// true (it is only false when EMAIL_NOTIFICATIONS_ENABLED is explicitly
// 'false'), and `config.email.host` always has a fallback value — so whether
// isEmailConfigured() is true in a test run depends entirely on whether
// EMAIL_USER/EMAIL_PASSWORD happen to be set, which they often are in a
// developer's local .env for manual SMTP testing. With them set,
// startOutboxWorker() is no longer a no-op: it schedules a real 30-second
// setInterval, and a bug in index.ts once let that path run against a pool
// double with no getConnection(), crashing an unrelated suite ~30s later,
// deterministically on a machine with local SMTP creds and never in CI (#394).
// Set here (dotenv leaves an already-defined var alone), before config/index.ts
// loads .env, so a local .env's credentials never leak into a test run.
applyTestEnvDefault('EMAIL_USER', '');
applyTestEnvDefault('EMAIL_PASSWORD', '');


export const mockDatabase = {
  query: jest.fn(),
  close: jest.fn()
};

export const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

export const resetAllMocks = () => {
  jest.clearAllMocks();
  mockDatabase.query.mockClear();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
};

// Extended Jest matchers
expect.extend({
  toBeOneOf(received, values) {
    const pass = values.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${values}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${values}`,
        pass: false,
      };
    }
  },
});

// Setup before each test
beforeEach(() => {
  resetAllMocks();
});