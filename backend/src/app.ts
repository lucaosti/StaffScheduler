/**
 * Express application factory.
 *
 * Builds the configured Express app given a mysql2 pool. Extracted from
 * `src/index.ts` to make the wiring easy to test in isolation without
 * starting an HTTP listener or a real database connection.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'mysql2/promise';
import { config } from './config';
import { logger } from './config/logger';

import { createAuthRouter } from './routes/auth';
import { createUsersRouter } from './routes/users';
import dashboardRoutes from './routes/dashboard';
import { createEmployeesRouter } from './routes/employees';
import { createShiftsRouter } from './routes/shifts';
import { createSchedulesRouter } from './routes/schedules';
import { createAssignmentsRouter } from './routes/assignments';
import { createSystemSettingsRouter } from './routes/settings';
import healthRoutes from './routes/health';
import { createDepartmentsRouter } from './routes/departments';
import { createSystemRouter } from './routes/system';
import { createTimeOffRouter } from './routes/timeOff';
import { createShiftSwapRouter } from './routes/shiftSwap';
import { createPreferencesRouter } from './routes/preferences';
import { createAuditLogsRouter } from './routes/auditLogs';
import { createCalendarRouter } from './routes/calendar';
import { createTwoFactorRouter } from './routes/twoFactor';
import { createOpenApiRouter } from './routes/openapi';
import { createOnCallRouter } from './routes/onCall';
import { createDirectoryRouter } from './routes/directory';
import { createSkillGapRouter } from './routes/skillGap';
import { createReportsRouter } from './routes/reports';
import { createNotificationsRouter } from './routes/notifications';
import { createBulkImportRouter } from './routes/bulkImport';
import { createEventsRouter } from './routes/events';
import { createOrgRouter } from './routes/org';
import { createPoliciesRouter } from './routes/policies';

interface BuildAppOptions {
  /** When true, skip rate limiting + morgan logging (useful for tests). */
  silent?: boolean;
}

export function buildApp(pool: Pool, options: BuildAppOptions = {}): express.Express {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.server.env === 'development' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          return callback(null, true);
        }
        if (origin === config.cors.origin) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  if (!options.silent) {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests from this IP, please try again later.',
    });
    app.use(limiter);

    app.use(
      morgan('combined', {
        stream: { write: (message) => logger.info(message.trim()) },
      })
    );
  }

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/api/health', healthRoutes);
  app.use('/api/system', createSystemRouter(pool));
  app.use('/api/auth', createAuthRouter(pool));
  app.use('/api/users', createUsersRouter(pool));
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/employees', createEmployeesRouter(pool));
  app.use('/api/departments', createDepartmentsRouter(pool));
  app.use('/api/shifts', createShiftsRouter(pool));
  app.use('/api/schedules', createSchedulesRouter(pool));
  app.use('/api/assignments', createAssignmentsRouter(pool));
  app.use('/api/settings', createSystemSettingsRouter(pool));
  app.use('/api/time-off', createTimeOffRouter(pool));
  app.use('/api/shift-swap', createShiftSwapRouter(pool));
  app.use('/api/preferences', createPreferencesRouter(pool));
  app.use('/api/audit-logs', createAuditLogsRouter(pool));
  app.use('/api/calendar', createCalendarRouter(pool));
  app.use('/api/auth/2fa', createTwoFactorRouter(pool));
  app.use('/api', createOpenApiRouter());
  app.use('/api/on-call', createOnCallRouter(pool));
  app.use('/api/directory', createDirectoryRouter(pool));
  app.use('/api/skill-gap', createSkillGapRouter(pool));
  app.use('/api/reports', createReportsRouter(pool));
  app.use('/api/notifications', createNotificationsRouter(pool));
  app.use('/api/import', createBulkImportRouter(pool));
  app.use('/api/events', createEventsRouter());
  app.use('/api/org', createOrgRouter(pool));
  app.use('/api/policies', createPoliciesRouter(pool));

  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Unhandled error:', err);
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message:
            process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
        },
      });
    }
  );

  app.use('*', (_req: express.Request, res: express.Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  return app;
}
