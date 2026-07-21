/**
 * Configuration module tests.
 *
 * The config is a plain object evaluated once at import, so every branch is
 * an env-var default (`process.env.X || fallback`) or a secret-validation
 * path that only fires under NODE_ENV=production. Ordinary suites therefore
 * exercise exactly one arm of each branch — whichever the developer's .env
 * happens to pick. This file loads the module repeatedly through
 * jest.isolateModules with dotenv mocked out (so the on-disk .env cannot
 * repopulate deleted variables) and pins:
 *
 * - the bare profile: every variable unset → every documented default;
 * - the full profile: every variable set → every explicit value, including
 *   the parsing of numeric and boolean-ish strings;
 * - requireSecret / requireProductionSecret: fail-fast on missing or
 *   placeholder secrets in production, permissive fallback in development;
 * - parseDurationMs: every accepted unit, bare seconds, default unit and
 *   the unrecognized-format fallback.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

const ENV_KEYS = [
  'PORT', 'NODE_ENV',
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_POOL_LIMIT', 'DB_QUEUE_LIMIT',
  'JWT_SECRET', 'JWT_EXPIRES_IN', 'AUTH_PERMISSION_CACHE_TTL_MS',
  'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_SECURE', 'EMAIL_USER', 'EMAIL_PASSWORD',
  'EMAIL_FROM_NAME', 'EMAIL_FROM_ADDRESS',
  'UPLOAD_MAX_SIZE', 'UPLOAD_ALLOWED_TYPES',
  'REPORT_STORAGE_PATH', 'REPORT_CLEANUP_DAYS',
  'OPTIMIZATION_ENGINE', 'OPTIMIZATION_TIMEOUT', 'OPTIMIZATION_MAX_ITERATIONS',
  'OPTIMIZATION_POPULATION_SIZE', 'OPTIMIZATION_MUTATION_RATE', 'OPTIMIZATION_CROSSOVER_RATE',
  'LOG_LEVEL', 'LOG_FILE', 'LOG_MAX_SIZE', 'LOG_MAX_FILES',
  'BCRYPT_ROUNDS', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS',
  'CORS_ORIGIN', 'NOTIFICATIONS_ENABLED', 'EMAIL_NOTIFICATIONS_ENABLED', 'IN_APP_NOTIFICATIONS_ENABLED',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const loadConfig = (env: Record<string, string> = {}) => {
  Object.assign(process.env, env);
  let mod: typeof import('../config') | undefined;
  jest.isolateModules(() => {
    mod = require('../config');
  });
  return mod!.config;
};

describe('defaults (bare environment)', () => {
  it('falls back to every documented default', () => {
    const config = loadConfig();

    expect(config.server.port).toBe(3001);
    expect(config.server.env).toBe('development');
    expect(config.database).toMatchObject({
      host: 'localhost', port: 3306, database: 'staff_scheduler', user: 'scheduler_user',
      password: 'scheduler_password', connectionLimit: 30, queueLimit: 100,
    });
    expect(config.jwt.secret).toBe('fallback-jwt_secret');
    expect(config.jwt.expiresIn).toBe('15m');
    expect(config.jwt.expiresInMs).toBe(15 * 60 * 1000);
    expect(config.jwt.refreshExpiresInMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.auth.permissionCacheTtlMs).toBe(0);
    expect(config.email.host).toBe('smtp.gmail.com');
    expect(config.email.port).toBe(587);
    expect(config.email.secure).toBe(false);
    expect(config.email.from).toEqual({ name: 'Staff Scheduler', address: 'noreply@staffscheduler.com' });
    expect(config.upload.maxSize).toBe(10485760);
    expect(config.upload.allowedTypes).toEqual(['image/jpeg', 'image/png', 'application/pdf']);
    expect(config.reports).toEqual({ storagePath: './reports', cleanupDays: 30 });
    expect(config.optimization).toMatchObject({
      engine: 'javascript', timeout: 300000, maxIterations: 10000,
      populationSize: 100, mutationRate: 0.1, crossoverRate: 0.8,
    });
    expect(config.logging).toEqual({ level: 'info', file: './logs/app.log', maxSize: '10m', maxFiles: 5 });
    expect(config.security).toEqual({ bcryptRounds: 12, rateLimitWindow: 60000, rateLimitMax: 200 });
    expect(config.cors.origin).toBe('http://localhost:3000');
    expect(config.notifications).toEqual({ enabled: false, emailEnabled: true, inAppEnabled: true });
  });
});

describe('explicit environment (full profile)', () => {
  it('honours every provided variable', () => {
    const config = loadConfig({
      PORT: '4000', NODE_ENV: 'staging',
      DB_HOST: 'db', DB_PORT: '3307', DB_NAME: 'ss', DB_USER: 'u', DB_PASSWORD: 'p',
      DB_POOL_LIMIT: '5', DB_QUEUE_LIMIT: '9',
      JWT_SECRET: 'real-secret', JWT_EXPIRES_IN: '15m', AUTH_PERMISSION_CACHE_TTL_MS: '5000',
      EMAIL_HOST: 'mail', EMAIL_PORT: '2525', EMAIL_SECURE: 'true', EMAIL_USER: 'mu', EMAIL_PASSWORD: 'mp',
      EMAIL_FROM_NAME: 'Ops', EMAIL_FROM_ADDRESS: 'ops@x.io',
      UPLOAD_MAX_SIZE: '1024', UPLOAD_ALLOWED_TYPES: 'text/csv',
      REPORT_STORAGE_PATH: '/tmp/r', REPORT_CLEANUP_DAYS: '7',
      OPTIMIZATION_ENGINE: 'or-tools', OPTIMIZATION_TIMEOUT: '60000', OPTIMIZATION_MAX_ITERATIONS: '10',
      OPTIMIZATION_POPULATION_SIZE: '20', OPTIMIZATION_MUTATION_RATE: '0.2', OPTIMIZATION_CROSSOVER_RATE: '0.5',
      LOG_LEVEL: 'debug', LOG_FILE: '/tmp/l.log', LOG_MAX_SIZE: '5m', LOG_MAX_FILES: '2',
      BCRYPT_ROUNDS: '14', RATE_LIMIT_WINDOW_MS: '1000', RATE_LIMIT_MAX_REQUESTS: '50',
      CORS_ORIGIN: 'https://app.example.com',
      NOTIFICATIONS_ENABLED: 'true', EMAIL_NOTIFICATIONS_ENABLED: 'false', IN_APP_NOTIFICATIONS_ENABLED: 'false',
    });

    expect(config.server).toEqual({ port: 4000, env: 'staging' });
    expect(config.database).toMatchObject({ host: 'db', port: 3307, database: 'ss', user: 'u', password: 'p', connectionLimit: 5, queueLimit: 9 });
    expect(config.jwt).toMatchObject({ secret: 'real-secret', expiresIn: '15m', expiresInMs: 15 * 60_000 });
    expect(config.auth.permissionCacheTtlMs).toBe(5000);
    expect(config.email).toMatchObject({ host: 'mail', port: 2525, secure: true, auth: { user: 'mu', pass: 'mp' }, from: { name: 'Ops', address: 'ops@x.io' } });
    expect(config.upload).toEqual({ maxSize: 1024, allowedTypes: ['text/csv'] });
    expect(config.reports).toEqual({ storagePath: '/tmp/r', cleanupDays: 7 });
    expect(config.optimization).toMatchObject({ engine: 'or-tools', timeout: 60000, maxIterations: 10, populationSize: 20, mutationRate: 0.2, crossoverRate: 0.5 });
    expect(config.logging).toEqual({ level: 'debug', file: '/tmp/l.log', maxSize: '5m', maxFiles: 2 });
    expect(config.security).toEqual({ bcryptRounds: 14, rateLimitWindow: 1000, rateLimitMax: 50 });
    expect(config.cors.origin).toBe('https://app.example.com');
    expect(config.notifications).toEqual({ enabled: true, emailEnabled: false, inAppEnabled: false });
  });

  it('enforces the bcrypt cost floor of 10', () => {
    const config = loadConfig({ BCRYPT_ROUNDS: '4' });
    expect(config.security.bcryptRounds).toBe(10);
  });

  it('clamps a negative auth cache TTL to 0 (cache disabled)', () => {
    const config = loadConfig({ AUTH_PERMISSION_CACHE_TTL_MS: '-100' });
    expect(config.auth.permissionCacheTtlMs).toBe(0);
  });
});

describe('secret validation in production', () => {
  const prodEnv = { NODE_ENV: 'production', DB_PASSWORD: 'strong-db-password' };

  it('throws when JWT_SECRET is missing', () => {
    expect(() => loadConfig({ ...prodEnv })).toThrow(/JWT_SECRET must be explicitly set/);
  });

  it.each(['fallback-something', 'please-change-in-production', 'your-super-secret-key'])(
    'throws on the placeholder value %s',
    (placeholder) => {
      expect(() => loadConfig({ ...prodEnv, JWT_SECRET: placeholder })).toThrow(
        /JWT_SECRET must be explicitly set/
      );
    }
  );

  it('throws when DB_PASSWORD equals the insecure default', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'real-secret', DB_PASSWORD: 'scheduler_password' })
    ).toThrow(/DB_PASSWORD must be set to a non-default value/);
  });

  it('accepts real secrets in production', () => {
    const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'real-secret', DB_PASSWORD: 'strong' });
    expect(config.jwt.secret).toBe('real-secret');
    expect(config.database.password).toBe('strong');
  });
});

describe('parseDurationMs (via JWT_EXPIRES_IN)', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 15 * 60_000],
    ['24h', 24 * 3_600_000],
    ['7d', 7 * 86_400_000],
    ['3600', 3_600_000], // bare number: seconds
    ['90 M', 90 * 60_000], // whitespace and case tolerated
  ])('parses %s as %i ms', (value, ms) => {
    const config = loadConfig({ JWT_EXPIRES_IN: value });
    expect(config.jwt.expiresInMs).toBe(ms);
  });

  it('falls back to 15m for an unrecognized format, keeping cookie and JWT lifetimes aligned', () => {
    const config = loadConfig({ JWT_EXPIRES_IN: 'soon' });
    expect(config.jwt.expiresIn).toBe('soon'); // jsonwebtoken will reject it loudly
    expect(config.jwt.expiresInMs).toBe(15 * 60 * 1000);
  });
});
