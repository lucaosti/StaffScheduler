/**
 * Smoke tests: every protected route rejects unauthenticated requests
 * with a 401 Unauthorized.
 *
 * The point is to catch a mistake where someone forgets to mount the
 * `authenticate` middleware on a new router. Cheap to write, high signal:
 * if any of these starts returning 200/500 instead of 401, we've broken
 * the auth invariant.
 */

import express from 'express';
import request from 'supertest';
import { createTimeOffRouter } from '../routes/timeOff';
import { createShiftSwapRouter } from '../routes/shiftSwap';
import { createPreferencesRouter } from '../routes/preferences';
import { createAuditLogsRouter } from '../routes/auditLogs';
import { createTwoFactorRouter } from '../routes/twoFactor';
import { createSkillGapRouter } from '../routes/skillGap';
import { createReportsRouter } from '../routes/reports';
import { createNotificationsRouter } from '../routes/notifications';
import { createBulkImportRouter } from '../routes/bulkImport';
import { createEventsRouter } from '../routes/events';

interface Mount {
  prefix: string;
  factory: () => express.Router;
  paths: Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete'; url: string }>;
}

const fakePool = {} as never;

const mounts: Mount[] = [
  {
    prefix: '/api/time-off',
    factory: () => createTimeOffRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'post', url: '/' },
      { method: 'post', url: '/1/approve' },
    ],
  },
  {
    prefix: '/api/shift-swap',
    factory: () => createShiftSwapRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'post', url: '/' },
      { method: 'post', url: '/1/approve' },
    ],
  },
  {
    prefix: '/api/preferences',
    factory: () => createPreferencesRouter(fakePool),
    paths: [
      { method: 'get', url: '/me' },
      { method: 'put', url: '/me' },
    ],
  },
  {
    prefix: '/api/audit-logs',
    factory: () => createAuditLogsRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
    ],
  },
  {
    prefix: '/api/auth/2fa',
    factory: () => createTwoFactorRouter(fakePool),
    paths: [
      { method: 'post', url: '/setup' },
      { method: 'post', url: '/enable' },
      { method: 'post', url: '/disable' },
      { method: 'post', url: '/verify' },
    ],
  },
  {
    prefix: '/api/skill-gap',
    factory: () => createSkillGapRouter(fakePool),
    paths: [{ method: 'get', url: '/' }],
  },
  {
    prefix: '/api/reports',
    factory: () => createReportsRouter(fakePool),
    paths: [
      { method: 'get', url: '/hours-worked' },
      { method: 'get', url: '/cost-by-department' },
      { method: 'get', url: '/fairness/1' },
    ],
  },
  {
    prefix: '/api/notifications',
    factory: () => createNotificationsRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/unread-count' },
      { method: 'patch', url: '/1/read' },
      { method: 'patch', url: '/read-all' },
    ],
  },
  {
    prefix: '/api/bulk-import',
    factory: () => createBulkImportRouter(fakePool),
    paths: [
      { method: 'post', url: '/employees' },
      { method: 'post', url: '/shifts' },
    ],
  },
  {
    prefix: '/api/events',
    factory: () => createEventsRouter(),
    paths: [{ method: 'get', url: '/stream' }],
  },
];

describe('Protected routes reject unauthenticated requests with 401', () => {
  for (const mount of mounts) {
    describe(mount.prefix, () => {
      const app = express();
      app.use(express.json());
      app.use(mount.prefix, mount.factory());

      for (const { method, url } of mount.paths) {
        it(`${method.toUpperCase()} ${url}`, async () => {
          const res = await (request(app) as any)[method](`${mount.prefix}${url}`);
          expect(res.status).toBe(401);
        });
      }
    });
  }
});
