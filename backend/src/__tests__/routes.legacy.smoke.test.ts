/**
 * Smoke tests for the legacy routers (employees, schedules, shifts,
 * departments, assignments, settings, dashboard).
 *
 * Same goal as routes.auth.smoke.test: prove every public endpoint
 * rejects unauthenticated traffic with 401. This catches regressions
 * where someone forgets the authenticate middleware on a new method.
 */

import express from 'express';
import request from 'supertest';
import { createEmployeesRouter } from '../routes/employees';
import { createSchedulesRouter } from '../routes/schedules';
import { createShiftsRouter } from '../routes/shifts';
import { createDepartmentsRouter } from '../routes/departments';
import { createAssignmentsRouter } from '../routes/assignments';
import { createSystemSettingsRouter } from '../routes/settings';
import dashboardRouter from '../routes/dashboard';

interface Mount {
  prefix: string;
  router: () => express.Router;
  paths: Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete'; url: string }>;
}

const fakePool = {} as never;

const mounts: Mount[] = [
  {
    prefix: '/api/employees',
    router: () => createEmployeesRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
      { method: 'post', url: '/' },
      { method: 'put', url: '/1' },
      { method: 'delete', url: '/1' },
      { method: 'get', url: '/department/3' },
      { method: 'get', url: '/1/skills' },
      { method: 'post', url: '/1/skills' },
      { method: 'delete', url: '/1/skills/2' },
    ],
  },
  {
    prefix: '/api/schedules',
    router: () => createSchedulesRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
      { method: 'get', url: '/1/shifts' },
      { method: 'post', url: '/' },
      { method: 'put', url: '/1' },
      { method: 'delete', url: '/1' },
      { method: 'get', url: '/department/3' },
      { method: 'get', url: '/user/7' },
      { method: 'patch', url: '/1/publish' },
      { method: 'patch', url: '/1/archive' },
      { method: 'post', url: '/1/duplicate' },
      { method: 'post', url: '/1/generate' },
    ],
  },
  {
    prefix: '/api/shifts',
    router: () => createShiftsRouter(fakePool),
    paths: [
      { method: 'get', url: '/templates' },
      { method: 'get', url: '/templates/1' },
      { method: 'post', url: '/templates' },
      { method: 'put', url: '/templates/1' },
      { method: 'delete', url: '/templates/1' },
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
      { method: 'post', url: '/' },
      { method: 'put', url: '/1' },
      { method: 'delete', url: '/1' },
      { method: 'get', url: '/schedule/1' },
      { method: 'get', url: '/department/3' },
    ],
  },
  {
    prefix: '/api/departments',
    router: () => createDepartmentsRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
      { method: 'post', url: '/' },
      { method: 'put', url: '/1' },
      { method: 'delete', url: '/1' },
    ],
  },
  {
    prefix: '/api/assignments',
    router: () => createAssignmentsRouter(fakePool),
    paths: [
      { method: 'get', url: '/' },
      { method: 'get', url: '/1' },
      { method: 'post', url: '/' },
      { method: 'put', url: '/1' },
      { method: 'delete', url: '/1' },
      { method: 'get', url: '/user/7' },
      { method: 'get', url: '/shift/10' },
      { method: 'get', url: '/department/3' },
      { method: 'post', url: '/bulk' },
      { method: 'patch', url: '/1/confirm' },
      { method: 'patch', url: '/1/decline' },
      { method: 'patch', url: '/1/complete' },
      { method: 'get', url: '/shift/10/available-employees' },
    ],
  },
  {
    prefix: '/api/settings',
    router: () => createSystemSettingsRouter(fakePool),
    paths: [{ method: 'get', url: '/' }],
  },
  {
    prefix: '/api/dashboard',
    router: () => dashboardRouter,
    paths: [
      { method: 'get', url: '/stats' },
      { method: 'get', url: '/activities' },
      { method: 'get', url: '/upcoming-shifts' },
      { method: 'get', url: '/departments' },
    ],
  },
];

describe('Legacy protected routes reject unauthenticated requests with 401', () => {
  for (const mount of mounts) {
    describe(mount.prefix, () => {
      const app = express();
      app.use(express.json());
      app.use(mount.prefix, mount.router());

      for (const { method, url } of mount.paths) {
        it(`${method.toUpperCase()} ${url}`, async () => {
          const res = await (request(app) as any)[method](`${mount.prefix}${url}`);
          expect(res.status).toBe(401);
        });
      }
    });
  }
});
