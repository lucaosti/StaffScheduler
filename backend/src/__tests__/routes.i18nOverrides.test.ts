/**
 * Organization translation-override routes (`routes/i18nOverrides.ts`).
 *
 * The gating case that matters: `GET /overrides` needs only authentication —
 * it is what every signed-in user's own frontend calls, scoped to their own
 * organization — while every admin CRUD endpoint under `/overrides/admin`
 * needs `settings.manage` on top.
 */

import express from 'express';
import request from 'supertest';

let currentUser: { id: number; permissions: string[]; organizationName: string | null } = {
  id: 1,
  permissions: [],
  organizationName: 'Acme',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { email: 'admin@example', isActive: true, ...currentUser };
    next();
  },
  requirePermission: (code: string) => (req: any, res: any, next: any) =>
    req.user?.permissions?.includes(code)
      ? next()
      : res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }),
}));

jest.mock('../services/TranslationOverrideService');

import { TranslationOverrideService } from '../services/TranslationOverrideService';
import { createI18nOverridesRouter } from '../routes/i18nOverrides';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/i18n', createI18nOverridesRouter(fakePool));
  app.use(errorHandler);
  return app;
};

/** Build an app where `authenticate` always returns 401, as real middleware does with no token. */
const mountUnauthApp = (): express.Express => {
  const authModule = require('../middleware/auth');
  const saved = authModule.authenticate;
  authModule.authenticate = (_req: any, res: any, _next: any) =>
    res.status(401).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Authorization token is required' } });

  const app = express();
  app.use(express.json());
  app.use('/api/i18n', createI18nOverridesRouter(fakePool));

  authModule.authenticate = saved;
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, permissions: [], organizationName: 'Acme' };
});

describe('authentication', () => {
  it('401s every endpoint without a token, including the own-organization read', async () => {
    const res = await request(mountUnauthApp()).get('/api/i18n/overrides?locale=en');
    expect(res.status).toBe(401);
  });

  it('401s the admin listing without a token', async () => {
    const res = await request(mountUnauthApp()).get('/api/i18n/overrides/admin');
    expect(res.status).toBe(401);
  });
});

describe('GET /overrides', () => {
  it('does not require settings.manage — any authenticated user may read their own organization\'s overrides', async () => {
    currentUser.permissions = [];
    (TranslationOverrideService.prototype.resolveForOrganization as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ 'auth.signIn': 'Enter' });
    const res = await request(mountApp()).get('/api/i18n/overrides?locale=en');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ 'auth.signIn': 'Enter' });
  });

  it('scopes the lookup to the caller\'s own organization from req.user', async () => {
    const resolve = jest.fn().mockResolvedValue({});
    (TranslationOverrideService.prototype.resolveForOrganization as jest.Mock) = resolve;
    await request(mountApp()).get('/api/i18n/overrides?locale=it');
    expect(resolve).toHaveBeenCalledWith('Acme', 'it');
  });

  it('400s when locale is missing', async () => {
    const res = await request(mountApp()).get('/api/i18n/overrides');
    expect(res.status).toBe(400);
  });

  it('falls back to null when the caller has no organization', async () => {
    currentUser.organizationName = null;
    const resolve = jest.fn().mockResolvedValue({});
    (TranslationOverrideService.prototype.resolveForOrganization as jest.Mock) = resolve;
    await request(mountApp()).get('/api/i18n/overrides?locale=en');
    expect(resolve).toHaveBeenCalledWith(null, 'en');
  });
});

describe('GET /overrides/admin', () => {
  it('refuses without settings.manage', async () => {
    const res = await request(mountApp()).get('/api/i18n/overrides/admin');
    expect(res.status).toBe(403);
  });

  it('lists every override row when authorized', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.list as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, organizationName: null, locale: 'en', overrides: {} }]);
    const res = await request(mountApp()).get('/api/i18n/overrides/admin');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /overrides/admin/:id', () => {
  beforeEach(() => {
    currentUser.permissions = ['settings.manage'];
  });

  it('404s for an unknown id', async () => {
    (TranslationOverrideService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/i18n/overrides/admin/99');
    expect(res.status).toBe(404);
  });

  it('returns the row when found', async () => {
    (TranslationOverrideService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, organizationName: 'Acme', locale: 'en', overrides: { a: 'b' } });
    const res = await request(mountApp()).get('/api/i18n/overrides/admin/1');
    expect(res.status).toBe(200);
    expect(res.body.data.overrides).toEqual({ a: 'b' });
  });
});

describe('POST /overrides/admin', () => {
  const validBody = { organizationName: 'Acme', locale: 'en', overrides: { 'auth.signIn': 'Enter' } };

  it('refuses without settings.manage', async () => {
    const res = await request(mountApp()).post('/api/i18n/overrides/admin').send(validBody);
    expect(res.status).toBe(403);
    expect(TranslationOverrideService.prototype.create).not.toHaveBeenCalled();
  });

  it('creates an override row when authorized', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.create as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, ...validBody });
    const res = await request(mountApp()).post('/api/i18n/overrides/admin').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  it('400s when locale is missing', async () => {
    currentUser.permissions = ['settings.manage'];
    const { locale: _locale, ...incomplete } = validBody;
    const res = await request(mountApp()).post('/api/i18n/overrides/admin').send(incomplete);
    expect(res.status).toBe(400);
    expect(TranslationOverrideService.prototype.create).not.toHaveBeenCalled();
  });
});

describe('PUT /overrides/admin/:id', () => {
  it('refuses without settings.manage', async () => {
    const res = await request(mountApp())
      .put('/api/i18n/overrides/admin/1')
      .send({ overrides: { a: 'b' } });
    expect(res.status).toBe(403);
  });

  it('updates the override map when authorized', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.update as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 1, organizationName: 'Acme', locale: 'en', overrides: { a: 'b' } });
    const res = await request(mountApp())
      .put('/api/i18n/overrides/admin/1')
      .send({ overrides: { a: 'b' } });
    expect(res.status).toBe(200);
    expect(res.body.data.overrides).toEqual({ a: 'b' });
  });

  it('404s when the service reports the row missing', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.update as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new (require('../errors').NotFoundError)('Translation override not found'));
    const res = await request(mountApp())
      .put('/api/i18n/overrides/admin/99')
      .send({ overrides: {} });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /overrides/admin/:id', () => {
  it('refuses without settings.manage', async () => {
    const res = await request(mountApp()).delete('/api/i18n/overrides/admin/1');
    expect(res.status).toBe(403);
  });

  it('deletes the row when authorized', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.remove as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/i18n/overrides/admin/1');
    expect(res.status).toBe(200);
  });

  it('404s when the service reports the row missing', async () => {
    currentUser.permissions = ['settings.manage'];
    (TranslationOverrideService.prototype.remove as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new (require('../errors').NotFoundError)('Translation override not found'));
    const res = await request(mountApp()).delete('/api/i18n/overrides/admin/99');
    expect(res.status).toBe(404);
  });
});
