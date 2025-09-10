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
 * - JWT and session management config
 * - Logging configuration
 * - Server and security settings
 * 
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'staff_scheduler',
    user: process.env.DB_USER || 'scheduler_user',
    password: process.env.DB_PASSWORD || 'scheduler_password',
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
  },
  session: {
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    name: process.env.SESSION_NAME || 'staff_scheduler_session',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      httpOnly: true,
      maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE || '86400000'), // 24 hours
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
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
    engine: process.env.OPTIMIZATION_ENGINE || 'javascript', // 'javascript' | 'or-tools' | 'pulp'
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
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
  notifications: {
    enabled: process.env.NOTIFICATIONS_ENABLED === 'true',
    emailEnabled: process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false',
    inAppEnabled: process.env.IN_APP_NOTIFICATIONS_ENABLED !== 'false',
  },
};

export default config;
