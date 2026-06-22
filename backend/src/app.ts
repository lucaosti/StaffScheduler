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
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'mysql2/promise';
import { config } from './config';
import { logger } from './config/logger';
import { requestId } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';

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
import { createRbacRouter } from './routes/rbac';
import { createDelegationsRouter } from './routes/delegations';
import { createApprovalWorkflowsRouter } from './routes/approvalWorkflows';
import { createModulesRouter } from './routes/modules';
import { createChangeRequestsRouter } from './routes/changeRequests';
import { createResponsibilityRulesRouter } from './routes/responsibilityRules';
import { createPendingApprovalsRouter } from './routes/pendingApprovals';

interface BuildAppOptions {
  /** When true, skip rate limiting + morgan logging (useful for tests). */
  silent?: boolean;
}

export function buildApp(pool: Pool, options: BuildAppOptions = {}): express.Express {
  const app = express();

  // HTTPS redirect for production deployments behind a reverse proxy.
  if (config.server.env === 'production') {
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.headers['x-forwarded-proto'] === 'http') {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
      }
      next();
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Requests without an Origin header come from non-browser clients
        // (curl, container healthchecks, server-to-server). CORS only guards
        // browser cross-origin access, so these are always allowed.
        if (!origin) return callback(null, true);
        if (config.server.env === 'development' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          return callback(null, true);
        }
        if (origin === config.cors.origin) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(cookieParser());

  if (!options.silent) {
    const limiter = rateLimit({
      windowMs: config.security.rateLimitWindow,
      max: config.security.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
        });
      },
    });
    app.use(limiter);

    app.use(
      morgan('combined', {
        stream: { write: (message) => logger.info(message.trim()) },
      })
    );
  }

  app.use(requestId);
  app.use(requestLogger);
  app.use(compression());
  // Body parser: 10 MB ceiling is intentional — bulk import CSVs and schedule payloads
  // can be large, but we keep this well below the 50 MB nginx default to limit DoS surface.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount all routers under both the legacy /api prefix and the canonical /api/v1 prefix.
  // During the transition period both prefixes are active. A future PR will drop /api/* and
  // install 308 redirects once all clients have migrated to /api/v1/*.
  const rbacRouters = createRbacRouter(pool);
  const mountRoutes = (prefix: string) => {
    app.use(`${prefix}/health`, healthRoutes);
    app.use(`${prefix}/system`, createSystemRouter(pool));
    app.use(`${prefix}/auth/2fa`, createTwoFactorRouter(pool));
    app.use(`${prefix}/auth`, createAuthRouter(pool));
    app.use(`${prefix}/users`, createUsersRouter(pool));
    app.use(`${prefix}/dashboard`, dashboardRoutes);
    app.use(`${prefix}/employees`, createEmployeesRouter(pool));
    app.use(`${prefix}/departments`, createDepartmentsRouter(pool));
    app.use(`${prefix}/shifts`, createShiftsRouter(pool));
    app.use(`${prefix}/schedules`, createSchedulesRouter(pool));
    app.use(`${prefix}/assignments`, createAssignmentsRouter(pool));
    app.use(`${prefix}/settings`, createSystemSettingsRouter(pool));
    app.use(`${prefix}/time-off`, createTimeOffRouter(pool));
    app.use(`${prefix}/shift-swap`, createShiftSwapRouter(pool));
    app.use(`${prefix}/preferences`, createPreferencesRouter(pool));
    app.use(`${prefix}/audit-logs`, createAuditLogsRouter(pool));
    app.use(`${prefix}/calendar`, createCalendarRouter(pool));
    app.use(`${prefix}/on-call`, createOnCallRouter(pool));
    app.use(`${prefix}/directory`, createDirectoryRouter(pool));
    app.use(`${prefix}/skill-gap`, createSkillGapRouter(pool));
    app.use(`${prefix}/reports`, createReportsRouter(pool));
    app.use(`${prefix}/notifications`, createNotificationsRouter(pool));
    app.use(`${prefix}/import`, createBulkImportRouter(pool));
    app.use(`${prefix}/events`, createEventsRouter());
    app.use(`${prefix}/org`, createOrgRouter(pool));
    app.use(`${prefix}/policies`, createPoliciesRouter(pool));
    app.use(`${prefix}/roles`, rbacRouters.roles);
    app.use(`${prefix}/permissions`, rbacRouters.permissions);
    app.use(`${prefix}/delegations`, createDelegationsRouter(pool));
    app.use(`${prefix}/approval-workflows`, createApprovalWorkflowsRouter(pool));
    app.use(`${prefix}/modules`, createModulesRouter(pool));
    app.use(`${prefix}/responsibility-rules`, createResponsibilityRulesRouter(pool));
    app.use(`${prefix}/change-requests`, createChangeRequestsRouter(pool));
    app.use(`${prefix}/pending-approvals`, createPendingApprovalsRouter(pool));
  };
  mountRoutes('/api/v1');
  mountRoutes('/api');
  app.use('/api', createOpenApiRouter());

  app.use('*', (_req: express.Request, res: express.Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Unhandled error:', err);
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message:
            config.server.env === 'production' ? 'An internal error occurred' : err.message,
        },
      });
    }
  );

  return app;
}
