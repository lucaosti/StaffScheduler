/**
 * SSO provider administration routes (`routes/sso.ts`).
 */

import express from 'express';
import request from 'supertest';

let currentPermissions: string[] = ['settings.manage'];

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: 'admin@example', isActive: true, permissions: currentPermissions };
    next();
  },
  requirePermission: (code: string) => (req: any, res: any, next: any) =>
    req.user?.permissions?.includes(code)
      ? next()
      : res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }),
}));

jest.mock('../services/SsoProviderService');

import { SsoProviderService } from '../services/SsoProviderService';
import { createSsoRouter } from '../routes/sso';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/sso', createSsoRouter(fakePool));
  app.use(errorHandler);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentPermissions = ['settings.manage'];
});

describe('authorization', () => {
  it('refuses everything without settings.manage', async () => {
    currentPermissions = [];
    const res = await request(mountApp()).get('/api/sso/providers');
    expect(res.status).toBe(403);
  });
});

describe('GET /providers', () => {
  it('lists every configured provider, including the client secret', async () => {
    (SsoProviderService.prototype.list as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Test IdP', clientSecret: 'shh' }]);
    const res = await request(mountApp()).get('/api/sso/providers');
    expect(res.status).toBe(200);
    expect(res.body.data[0].clientSecret).toBe('shh');
  });
});

describe('GET /providers/:id', () => {
  it('404s for an unknown id', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/sso/providers/99');
    expect(res.status).toBe(404);
  });

  it('returns the provider when found', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, name: 'Test IdP' });
    const res = await request(mountApp()).get('/api/sso/providers/1');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Test IdP');
  });
});

describe('POST /providers', () => {
  const validBody = {
    name: 'Test IdP',
    issuer: 'https://idp.example.com',
    clientId: 'client-123',
    clientSecret: 'secret-abc',
    authorizationUrl: 'https://idp.example.com/authorize',
    tokenUrl: 'https://idp.example.com/token',
    jwksUrl: 'https://idp.example.com/jwks',
  };

  it('creates a provider', async () => {
    (SsoProviderService.prototype.create as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, ...validBody });
    const res = await request(mountApp()).post('/api/sso/providers').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  it('400s when a URL field is not a valid URL', async () => {
    const res = await request(mountApp())
      .post('/api/sso/providers')
      .send({ ...validBody, tokenUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(SsoProviderService.prototype.create).not.toHaveBeenCalled();
  });

  it('400s when a required field is missing', async () => {
    const { clientSecret: _clientSecret, ...incomplete } = validBody;
    const res = await request(mountApp()).post('/api/sso/providers').send(incomplete);
    expect(res.status).toBe(400);
  });
});

describe('PUT /providers/:id', () => {
  it('updates a provider', async () => {
    (SsoProviderService.prototype.update as jest.Mock) = jest.fn().mockResolvedValue({ id: 1, name: 'Renamed' });
    const res = await request(mountApp()).put('/api/sso/providers/1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });

  it('404s when the service reports the provider missing', async () => {
    (SsoProviderService.prototype.update as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new (require('../errors').NotFoundError)('SSO provider not found'));
    const res = await request(mountApp()).put('/api/sso/providers/99').send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /providers/:id', () => {
  it('deletes a provider', async () => {
    (SsoProviderService.prototype.remove as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/sso/providers/1');
    expect(res.status).toBe(200);
  });

  it('404s when the service reports the provider missing', async () => {
    (SsoProviderService.prototype.remove as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new (require('../errors').NotFoundError)('SSO provider not found'));
    const res = await request(mountApp()).delete('/api/sso/providers/99');
    expect(res.status).toBe(404);
  });
});
