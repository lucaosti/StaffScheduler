/**
 * Logger configuration tests.
 *
 * The logger is deliberately silent under Jest (no transports, silent: true)
 * so suites stay readable and no file handle keeps the process alive. That
 * also means its construction branches and the request-id format injector
 * never run in ordinary suites — this file covers them explicitly:
 *
 * - the format pipeline stamps `requestId` only inside a request context
 *   (AsyncLocalStorage), leaving logs from startup/cron paths clean;
 * - test env → silent with zero transports;
 * - production → file transport only (JSON, no console noise in containers);
 * - development → file plus colorized console.
 *
 * Env-dependent construction is exercised through jest.isolateModules so each
 * variant gets a freshly evaluated config + logger without polluting the
 * ambient test environment.
 */

import { logger } from '../config/logger';
import { requestStorage } from '../middleware/requestContext';

describe('request-id log format', () => {
  it('stamps no requestId before requestContext has registered its resolver', () => {
    // The logger no longer imports requestContext — that cycle put the
    // lowest-level module downstream of middleware. It exposes a hook the
    // middleware fills in, so this asserts the unregistered default: startup
    // and cron paths, which run outside any request, log without an id.
    jest.isolateModules(() => {
      const { logger: fresh } = require('../config/logger') as typeof import('../config/logger');
      const info = fresh.format!.transform({ level: 'info', message: 'hi' } as never) as Record<
        string,
        unknown
      >;
      expect(info.requestId).toBeUndefined();
    });
  });

  it('stamps requestId when logging inside a request context', () => {
    const info = requestStorage.run(
      { requestId: 'rid-123', ipAddress: null, userAgent: null },
      () => logger.format!.transform({ level: 'info', message: 'hello' } as never)
    ) as Record<string, unknown>;

    expect(info.requestId).toBe('rid-123');
  });

  it('leaves requestId unset outside a request context', () => {
    const info = logger.format!.transform({ level: 'info', message: 'hello' } as never) as Record<
      string,
      unknown
    >;

    expect(info.requestId).toBeUndefined();
  });
});

describe('environment-specific construction', () => {
  const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'DB_PASSWORD', 'LOG_FILE'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const loadLogger = (env: string) => {
    process.env.NODE_ENV = env;
    // Production config refuses placeholder secrets at load time; provide
    // real-looking values so the logger module can be evaluated.
    process.env.JWT_SECRET = 'construction-test-secret-0123456789';
    process.env.DB_PASSWORD = 'construction-test-password';
    // Keep any lazily-created log file out of the repo.
    process.env.LOG_FILE = `${process.env.TMPDIR || '/tmp'}/staffscheduler-logger-test.log`;

    let mod: typeof import('../config/logger') | undefined;
    jest.isolateModules(() => {
      mod = require('../config/logger');
    });
    return mod!.logger;
  };

  it('is silent with no transports under test', () => {
    const testLogger = loadLogger('test');
    expect(testLogger.silent).toBe(true);
    expect(testLogger.transports).toHaveLength(0);
  });

  it('logs to the file transport only in production', () => {
    const prodLogger = loadLogger('production');
    try {
      expect(prodLogger.silent).toBeFalsy();
      expect(prodLogger.transports).toHaveLength(1);
      expect(prodLogger.transports[0].constructor.name).toBe('File');
    } finally {
      prodLogger.close();
    }
  });

  it('adds a console transport in development', () => {
    const devLogger = loadLogger('development');
    try {
      const names = devLogger.transports.map((t) => t.constructor.name).sort();
      expect(names).toEqual(['Console', 'File']);
    } finally {
      devLogger.close();
    }
  });
});
