// Test setup for Staff Scheduler
//
// Safety net: default Redis to disabled in tests unless a suite opts in, so no
// test can leave a live ioredis client whose reconnection timer keeps Jest
// from exiting. Suites that exercise Redis mock config/redis or set the flag
// themselves (redis.config.test.ts), so this default never masks real coverage.
if (process.env.REDIS_ENABLED === undefined) process.env.REDIS_ENABLED = 'false';


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