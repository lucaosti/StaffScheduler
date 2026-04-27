/**
 * Smoke tests: on-call (F21) and directory (F22) routes reject
 * unauthenticated requests with 401.
 */

import express from 'express';
import request from 'supertest';
import { createOnCallRouter } from '../routes/onCall';
import { createDirectoryRouter } from '../routes/directory';

const fakePool = {} as never;

interface Mount {
  prefix: string;
  router: () => express.Router;
  paths: Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete'; url: string }>;
}

const mounts: Mount[] = [
  {
    prefix: '/api/on-call',
    router: () => createOnCallRouter(fakePool),
    paths: [
      { method: 'get', url: '/me' },
      { method: 'get', url: '/periods' },
      { method: 'post', url: '/periods' },
      { method: 'get', url: '/periods/1' },
      { method: 'put', url: '/periods/1' },
      { method: 'delete', url: '/periods/1' },
      { method: 'get', url: '/periods/1/assignments' },
      { method: 'post', url: '/periods/1/assign' },
      { method: 'delete', url: '/periods/1/assign/2' },
    ],
  },
  {
    prefix: '/api/directory',
    router: () => createDirectoryRouter(fakePool),
    paths: [
      { method: 'get', url: '/me' },
      { method: 'get', url: '/users/1' },
      { method: 'put', url: '/users/1/fields' },
      { method: 'delete', url: '/users/1/fields/birthday' },
      { method: 'get', url: '/users/1/vcard' },
      { method: 'get', url: '/vcard.vcf?ids=1,2' },
      { method: 'post', url: '/import-vcard' },
    ],
  },
];

describe('F21 + F22 routes reject unauthenticated traffic', () => {
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
