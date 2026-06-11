/**
 * Route coverage batch 5 — fills remaining route gaps:
 *   routes/employees.ts  — GET /:id service throws → 500 (line 63)
 *   routes/employees.ts  — POST /:id/skills missing skillId → 400 (line 178)
 *   routes/bulkImport.ts — POST /employees password < 8 chars → 400 (line 38)
 *   routes/rbac.ts       — POST /roles/users/:userId isNaN → 400 (line 127)
 *   routes/openapi.ts    — GET /openapi.json loadSpec error → fallback spec returned
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

jest.mock('../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: () => true,
}));

jest.mock('../services/EmployeeService');
jest.mock('../services/BulkImportService');
jest.mock('../services/RbacService');

import { EmployeeService } from '../services/EmployeeService';
import { createEmployeesRouter } from '../routes/employees';
import { createBulkImportRouter } from '../routes/bulkImport';
import { createRbacRouter } from '../routes/rbac';

const fakePool = {} as never;

const mount = (prefix: string, router: express.Router) => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

// ─── routes/employees.ts — GET /:id catch → 500 ──────────────────────────────

describe('employees route — GET /:id service throws returns 500', () => {
  it('returns 500 INTERNAL_ERROR when getEmployeeById throws', async () => {
    (EmployeeService.prototype.getEmployeeById as jest.Mock).mockRejectedValueOnce(
      new Error('db gone')
    );
    const app = mount('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app).get('/api/employees/1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── routes/employees.ts — POST /:id/skills missing skillId → 400 ────────────

describe('employees route — POST /:id/skills missing skillId returns 400', () => {
  it('returns 400 VALIDATION_ERROR when skillId is absent from body', async () => {
    const app = mount('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app)
      .post('/api/employees/1/skills')
      .send({ proficiencyLevel: 3 }); // no skillId
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when proficiencyLevel is absent from body', async () => {
    const app = mount('/api/employees', createEmployeesRouter(fakePool));
    const res = await request(app)
      .post('/api/employees/1/skills')
      .send({ skillId: 5 }); // no proficiencyLevel
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── routes/bulkImport.ts — password < 8 chars → 400 ────────────────────────

describe('bulkImport route — POST /employees password too short returns 400', () => {
  it('returns 400 VALIDATION_ERROR when defaultPassword is shorter than 8 characters', async () => {
    const app = mount('/api/import', createBulkImportRouter(fakePool));
    const res = await request(app)
      .post('/api/import/employees')
      .send({ csv: 'email,firstName,lastName,role\ntest@x.com,A,B,employee', defaultPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].message).toMatch(/at least 8 characters/);
  });
});

// ─── routes/rbac.ts — POST /roles/users/:userId isNaN → 400 ─────────────────

describe('rbac route — POST /roles/users/:userId with non-numeric userId returns 400', () => {
  it('returns 400 VALIDATION_ERROR when userId is not a positive integer', async () => {
    const { roles } = createRbacRouter(fakePool);
    const app = mount('/api/roles', roles);
    const res = await request(app)
      .post('/api/roles/users/abc')
      .send({ roleId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/userId must be a positive integer/);
  });

  it('returns 400 VALIDATION_ERROR when userId is 0', async () => {
    const { roles } = createRbacRouter(fakePool);
    const app = mount('/api/roles', roles);
    const res = await request(app)
      .post('/api/roles/users/0')
      .send({ roleId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── routes/openapi.ts — loadSpec error → fallback spec ──────────────────────

describe('openapi route — GET /openapi.json returns fallback when fs.readFileSync throws', () => {
  it('returns a fallback minimal spec when the spec file cannot be read', async () => {
    // jest.isolateModules gives us a fresh module with its own cachedSpec = null
    // and lets us inject a throwing fs mock only for this test.
    let result: any;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        readFileSync: jest.fn().mockImplementation(() => {
          throw new Error('ENOENT: no such file');
        }),
      }));
      const { createOpenApiRouter: freshRouter } = await import('../routes/openapi');
      const app = express();
      app.use(express.json());
      app.use('/api', freshRouter());
      result = await request(app).get('/api/openapi.json');
    });
    expect(result.status).toBe(200);
    // Fallback object has openapi field
    expect(result.body).toHaveProperty('openapi');
    expect(result.body.info.title).toBe('Staff Scheduler API');
  });
});
