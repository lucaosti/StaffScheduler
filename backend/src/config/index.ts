/**
 * Application Configuration Module
 * 
 * Centralizes all configuration settings for the Staff Scheduler backend.
 * Loads environment variables and provides typed configuration objects
 * for different application components.
 * 
 * Features:
 * - Environment variable loading with defaults
 * - Type-safe configuration objects
 * - Database connection settings
 * - JWT configuration
 * - Logging configuration
 * - Server and security settings
 * 
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function requireSecret(envVar: string, name: string): string {
  const value = process.env[envVar];
  if (isProduction && (!value || value.startsWith('fallback') || value.includes('change-in-production') || value.includes('your-super-secret'))) {
    throw new Error(`${name} must be explicitly set in production. Do not use placeholder values.`);
  }
  return value || `fallback-${name.toLowerCase().replace(/\s/g, '-')}`;
}

// requireProductionSecret: throws if value equals the insecure default in production.
// requireSecret: throws if value is absent or contains known placeholder substrings.
/**
 * Returns the environment variable value, but throws at startup when running in
 * production and the value matches the known insecure default.  In development
 * and test environments the default is returned as-is so that local setup
 * remains zero-configuration.
 */
function requireProductionSecret(envVar: string, insecureDefault: string): string {
  const value = process.env[envVar] ?? insecureDefault;
  if (isProduction && value === insecureDefault) {
    throw new Error(`[config] ${envVar} must be set to a non-default value in production`);
  }
  return value;
}

/**
 * Parses a jsonwebtoken-style duration string ("24h", "7d", "15m", "30s",
 * or a bare number of seconds) into milliseconds. Falls back to the given
 * default when the value is not in a recognized format, so the auth cookie
 * lifetime always stays in lockstep with the JWT expiry.
 */
function parseDurationMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 3_600_000 :
    86_400_000; // 'd'
  return amount * multiplier;
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001'),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'staff_scheduler',
    user: process.env.DB_USER || 'scheduler_user',
    password: requireProductionSecret('DB_PASSWORD', 'scheduler_password'),
    connectionLimit: parseInt(process.env.DB_POOL_LIMIT || '30'),
    queueLimit:      parseInt(process.env.DB_QUEUE_LIMIT || '100'),
    connectTimeout:  10_000,
  },
  jwt: {
    secret: requireSecret('JWT_SECRET', 'JWT_SECRET'),
    // Access token: short-lived by design. Longevity is now provided by the
    // rotating refresh token, so a leaked access token is only usable for a
    // few minutes. Default 15m; still overridable for special deployments.
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    expiresInMs: parseDurationMs(process.env.JWT_EXPIRES_IN || '15m', 15 * 60 * 1000),
    // Refresh token lifetime: the session's real length. 30 days by default;
    // rotation on every use means a token is short-lived in practice even
    // though the family can live this long.
    refreshExpiresInMs: parseDurationMs(
      process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      30 * 24 * 60 * 60 * 1000
    ),
  },
  auth: {
    // TTL (ms) for the per-user auth context cache in the authenticate
    // middleware. 0 (default) disables caching: permissions are resolved from
    // the database on every request, so grants/revocations apply immediately.
    // Setting a small TTL (e.g. 5000) trades that immediacy for a large cut
    // in per-request query load; revocations then take up to TTL to apply.
    permissionCacheTtlMs: Math.max(0, parseInt(process.env.AUTH_PERMISSION_CACHE_TTL_MS || '0')),
  },
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    from: {
      name: process.env.EMAIL_FROM_NAME || 'Staff Scheduler',
      address: process.env.EMAIL_FROM_ADDRESS || 'noreply@staffscheduler.com',
    },
  },
  upload: {
    maxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760'), // 10MB
    allowedTypes: (process.env.UPLOAD_ALLOWED_TYPES || 'image/jpeg,image/png,application/pdf').split(','),
  },
  reports: {
    storagePath: process.env.REPORT_STORAGE_PATH || './reports',
    cleanupDays: parseInt(process.env.REPORT_CLEANUP_DAYS || '30'),
  },
  optimization: {
    // Default to the most optimal engine. 'or-tools' attempts the Python CP-SAT
    // solver first and, if it is unavailable, degrades to greedy *visibly*
    // (engine/degraded surfaced in the result). 'greedy' (or legacy
    // 'javascript') selects the fast best-effort draft engine on purpose.
    engine: process.env.OPTIMIZATION_ENGINE || 'or-tools',
    timeout: parseInt(process.env.OPTIMIZATION_TIMEOUT || '300000'), // 5 minutes
    maxIterations: parseInt(process.env.OPTIMIZATION_MAX_ITERATIONS || '10000'),
    populationSize: parseInt(process.env.OPTIMIZATION_POPULATION_SIZE || '100'),
    mutationRate: parseFloat(process.env.OPTIMIZATION_MUTATION_RATE || '0.1'),
    crossoverRate: parseFloat(process.env.OPTIMIZATION_CROSSOVER_RATE || '0.8'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
  },
  security: {
    bcryptRounds: Math.max(10, parseInt(process.env.BCRYPT_ROUNDS || '12')),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200'),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
  redis: {
    // On by default: the shared caches (JTI blacklist, auth-context, module
    // state) use Redis whenever it is reachable, so a multi-instance
    // deployment is consistent out of the box without extra configuration.
    // `REDIS_URL` overrides the connection string (credentials/TLS/db-index
    // travel together in one URL); the localhost default matches the compose
    // service and a typical local Redis. Set REDIS_ENABLED=false to force the
    // legacy in-process behaviour for a deployment that genuinely cannot run
    // Redis — the caches fall back transparently either way, so this flag is
    // only about suppressing connection attempts, not correctness.
    enabled: process.env.REDIS_ENABLED !== 'false',
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  },
  notifications: {
    enabled: process.env.NOTIFICATIONS_ENABLED === 'true',
    emailEnabled: process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false',
    inAppEnabled: process.env.IN_APP_NOTIFICATIONS_ENABLED !== 'false',
  },
};
