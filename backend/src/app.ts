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
import type { Pool } from 'mysql2/promise';
import { config } from './config';
import { logger } from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';

import { createAuthRouter } from './routes/auth';
import { createUsersRouter } from './routes/users';
import { createDashboardRouter } from './routes/dashboard';
import { createEmployeesRouter } from './routes/employees';
import { createShiftsRouter } from './routes/shifts';
import { createSchedulesRouter } from './routes/schedules';
import { createAssignmentsRouter } from './routes/assignments';
import { createSystemSettingsRouter } from './routes/settings';
import { createEmployeeFieldPolicyRouter } from './routes/employeeFieldPolicies';
import healthRoutes from './routes/health';
import { createMetricsRouter } from './routes/metrics';
import { httpMetricsMiddleware, registerPoolMetrics } from './observability/metrics';
import { createDepartmentsRouter } from './routes/departments';
import { createSystemRouter } from './routes/system';
import { createTimeOffRouter } from './routes/timeOff';
import { createAttendanceRouter } from './routes/attendance';
import { createShiftSwapRouter } from './routes/shiftSwap';
import { createPreferencesRouter } from './routes/preferences';
import { createEmploymentContractsRouter } from './routes/employmentContracts';
import { createEmployeePairingsRouter } from './routes/employeePairings';
import { createTimelineRouter } from './routes/timeline';
import { createSkillsRouter } from './routes/skills';
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
import { createRateLimiter } from './middleware/rateLimit';

interface BuildAppOptions {
  /** When true, skip rate limiting + morgan logging (useful for tests). */
  silent?: boolean;
}

export function buildApp(pool: Pool, options: BuildAppOptions = {}): express.Express {
  const app = express();

  // Trust exactly N reverse-proxy hops for X-Forwarded-For/-Proto, so req.ip
  // reflects the real client rather than the load balancer's own address —
  // both IP-keyed rate limiting (middleware/rateLimit.ts) and the audit-log
  // IP (middleware/requestContext.ts) depend on this. 0 (the default) leaves
  // Express's own default of trusting nothing, which is what a directly
  // exposed instance (dev, or an unscaled deployment with no LB) needs: with
  // no proxy in front, "trust" a hop is trusting the client to set its own
  // X-Forwarded-For header.
  if (config.server.trustProxyHops > 0) {
    app.set('trust proxy', config.server.trustProxyHops);
  }

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
        if (config.server.env === 'development') {
          // Match on the parsed hostname, not a substring: "localhost.evil.com"
          // must not pass. Unparseable origins fall through to the exact match.
          try {
            const { hostname } = new URL(origin);
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
              return callback(null, true);
            }
          } catch {
            /* fall through to the exact-origin check */
          }
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
    // Keyed by organization where the caller is identifiable, and counted in
    // the shared store rather than per process — see middleware/rateLimit for
    // why both halves of the default configuration were wrong here.
    app.use(createRateLimiter(pool));

    // Credential-bearing query parameters must never reach the access log:
    // calendar feeds authenticate via ?token=... (calendar clients cannot set
    // headers), and the default 'combined' format logs the full request URL.
    morgan.token('url', (req) => {
      const original = (req as express.Request).originalUrl || req.url || '';
      return original.replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]');
    });
    app.use(
      morgan('combined', {
        stream: { write: (message) => logger.info(message.trim()) },
      })
    );
  }

  app.use(requestId);
  app.use(requestLogger);
  // Time every request under its matched route pattern. Placed after requestId
  // so a trace/log correlation id already exists, and before the routers so the
  // whole handler chain is inside the timer.
  app.use(httpMetricsMiddleware);
  app.use(compression());

  // Sample the DB pool at scrape time, and expose the Prometheus endpoint
  // outside the /api tree (a scraper is not an API user — see routes/metrics).
  registerPoolMetrics(pool);
  app.use('/metrics', createMetricsRouter());
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
    app.use(`${prefix}/dashboard`, createDashboardRouter(pool));
    app.use(`${prefix}/employees`, createEmployeesRouter(pool));
    app.use(`${prefix}/departments`, createDepartmentsRouter(pool));
    app.use(`${prefix}/shifts`, createShiftsRouter(pool));
    app.use(`${prefix}/schedules`, createSchedulesRouter(pool));
    app.use(`${prefix}/assignments`, createAssignmentsRouter(pool));
    app.use(`${prefix}/settings`, createSystemSettingsRouter(pool));
    app.use(`${prefix}/employee-field-policies`, createEmployeeFieldPolicyRouter(pool));
    app.use(`${prefix}/time-off`, createTimeOffRouter(pool));
    app.use(`${prefix}/attendance`, createAttendanceRouter(pool));
    app.use(`${prefix}/shift-swap`, createShiftSwapRouter(pool));
    app.use(`${prefix}/preferences`, createPreferencesRouter(pool));
    app.use(`${prefix}/employment-contracts`, createEmploymentContractsRouter(pool));
    app.use(`${prefix}/employee-pairings`, createEmployeePairingsRouter(pool));
    app.use(`${prefix}/timeline`, createTimelineRouter(pool));
    app.use(`${prefix}/skills`, createSkillsRouter(pool));
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
  app.use('/api', createOpenApiRouter());

  // Legacy prefix retirement (#319): `/api` is no longer a second, fully
  // duplicated mount of every router — that meant every route existed twice,
  // and the refresh cookie's path derivation (see `routes/auth.ts`) had to
  // stay correct for both simultaneously forever. A caller still on `/api`
  // gets a 308 (method- and body-preserving, unlike 301/302) to the
  // equivalent `/api/v1` path instead. `openapi.json`'s `servers` entry and
  // DOCUMENTATION.md record `/api/v1` as the only prefix to build against.
  //
  // Placed AFTER `createOpenApiRouter()` above so `/api/openapi.json`,
  // `/api/docs` and `/api/docs-assets/*` — documentation, not versioned API
  // surface — keep working unredirected; only requests that fall through
  // reach this middleware.
  app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.originalUrl === '/api/v1' || req.originalUrl.startsWith('/api/v1/') || req.originalUrl.startsWith('/api/v1?')) {
      next();
      return;
    }
    const target = `/api/v1${req.originalUrl.slice('/api'.length)}`;
    res.redirect(308, target);
  });

  // No path argument, not `'*'`: Express 5's router (path-to-regexp v8) no
  // longer accepts a bare wildcard as a path string — it requires a named
  // segment (`/*splat`). A path-less `app.use` middleware already matches
  // every request that reaches it, which is exactly the catch-all this is,
  // so there is no pattern to get wrong here at all.
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  app.use(errorHandler);

  return app;
}
