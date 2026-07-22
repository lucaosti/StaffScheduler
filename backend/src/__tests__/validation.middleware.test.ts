/**
 * Validation middleware tests (issue #96).
 *
 * Covers:
 *   - validateParams: non-numeric id → 400 VALIDATION_ERROR with details
 *   - validateParams: negative id → 400 VALIDATION_ERROR
 *   - validateBody: missing required fields → 400 VALIDATION_ERROR with field-level details
 *   - GET /api/v1/schedules/abc returns VALIDATION_ERROR
 *   - POST /api/v1/users with missing email returns VALIDATION_ERROR with details
 *   - POST /api/v1/users with missing required fields returns field-level errors
 */

import express from 'express';
import request from 'supertest';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { idParam, createUserBody, shiftListQuery, userListQuery } from '../schemas';

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for validateParams
// ──────────────────────────────────────────────────────────────────────────────

describe('validateParams', () => {
  const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.get('/:id', validateParams(idParam), (_req, res) => {
      res.json({ success: true, id: res.locals.params.id });
    });
    return app;
  };

  it('passes through a valid numeric id and coerces it to number', async () => {
    const res = await request(makeApp()).get('/42');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });

  it('returns 400 VALIDATION_ERROR for a non-numeric id', async () => {
    const res = await request(makeApp()).get('/abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details[0].field).toBe('id');
  });

  it('returns 400 VALIDATION_ERROR for a negative id', async () => {
    const res = await request(makeApp()).get('/-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for zero', async () => {
    const res = await request(makeApp()).get('/0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for validateBody
// ──────────────────────────────────────────────────────────────────────────────

describe('validateBody', () => {
  const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.post('/', validateBody(createUserBody), (_req, res) => {
      res.json({ success: true, data: res.locals.body });
    });
    return app;
  };

  it('passes a valid user body and exposes it on res.locals.body', async () => {
    const res = await request(makeApp()).post('/').send({
      email: 'test@example.com',
      password: 'secret123',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@example.com');
  });

  it('returns 400 VALIDATION_ERROR with field details when email is missing', async () => {
    const res = await request(makeApp()).post('/').send({
      password: 'secret',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const emailErr = res.body.error.details.find((d: any) => d.field === 'email');
    expect(emailErr).toBeDefined();
  });

  it('returns 400 VALIDATION_ERROR when email format is invalid', async () => {
    const res = await request(makeApp()).post('/').send({
      email: 'not-an-email',
      password: 'secret',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports multiple missing fields in details array', async () => {
    const res = await request(makeApp()).post('/').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests for validateQuery
// ──────────────────────────────────────────────────────────────────────────────

describe('validateQuery', () => {
  const makeApp = (schema: Parameters<typeof validateQuery>[0]) => {
    const app = express();
    app.get('/', validateQuery(schema), (_req, res) => {
      res.json({ success: true, data: res.locals.query });
    });
    return app;
  };

  it('coerces numeric and boolean strings, since every query value arrives as text', async () => {
    const res = await request(makeApp(userListQuery)).get('/?roleId=3&isActive=true&page=2');
    expect(res.status).toBe(200);
    expect(res.body.data.roleId).toBe(3);
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.page).toBe(2);
  });

  it('accepts isActive=false as the boolean false, not a truthy string', async () => {
    const res = await request(makeApp(userListQuery)).get('/?isActive=false');
    expect(res.body.data.isActive).toBe(false);
  });

  it('returns 400 VALIDATION_ERROR with field details for a malformed value', async () => {
    const res = await request(makeApp(userListQuery)).get('/?roleId=abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Invalid query parameters');
    expect(res.body.error.details[0].field).toBe('roleId');
  });

  it('strips unknown parameters rather than rejecting them', async () => {
    const res = await request(makeApp(userListQuery)).get('/?roleId=3&somethingElse=x');
    expect(res.status).toBe(200);
    expect(res.body.data.somethingElse).toBeUndefined();
  });

  it('enforces cross-field rules such as an inverted date range', async () => {
    const res = await request(makeApp(shiftListQuery)).get(
      '/?startDate=2026-05-31&endDate=2026-05-01'
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    const res = await request(makeApp(shiftListQuery)).get('/?date=31-05-2026');
    expect(res.status).toBe(400);
  });

  it('leaves omitted optional filters undefined rather than defaulting them', async () => {
    const res = await request(makeApp(shiftListQuery)).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration tests via buildApp
// ──────────────────────────────────────────────────────────────────────────────

jest.mock('../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: () => false,
  getModuleService: () => ({}),
}));
jest.mock('../services/ScheduleService');
jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { buildApp } from '../app';

describe('GET /api/v1/schedules/:id — param validation', () => {
  it('returns 400 VALIDATION_ERROR for non-numeric id', async () => {
    const app = buildApp({} as never, { silent: true });
    const res = await request(app).get('/api/v1/schedules/abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for negative id', async () => {
    const app = buildApp({} as never, { silent: true });
    const res = await request(app).get('/api/v1/schedules/-5');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/users — body validation', () => {
  it('returns 400 VALIDATION_ERROR with details when email is missing', async () => {
    const app = buildApp({} as never, { silent: true });
    const res = await request(app)
      .post('/api/v1/users')
      .send({ password: 'secret', firstName: 'Alice', lastName: 'Smith' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const emailErr = res.body.error.details.find((d: any) => d.field === 'email');
    expect(emailErr).toBeDefined();
    expect(typeof emailErr.message).toBe('string');
  });

  it('returns 400 VALIDATION_ERROR when password is missing', async () => {
    const app = buildApp({} as never, { silent: true });
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'user@example.com', firstName: 'Alice', lastName: 'Smith' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const pwdErr = res.body.error.details.find((d: any) => d.field === 'password');
    expect(pwdErr).toBeDefined();
  });

  it('returns 400 VALIDATION_ERROR when body is empty', async () => {
    const app = buildApp({} as never, { silent: true });
    const res = await request(app).post('/api/v1/users').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});
