// Test setup for Staff Scheduler

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